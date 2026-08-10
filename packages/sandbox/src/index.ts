import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import type { TaskSpec } from '@arbiter/contracts';

const execFileAsync = promisify(execFile);

export type ExecuteFile = (
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    maxBuffer?: number;
    timeout?: number;
    windowsHide?: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecuteFile: ExecuteFile = (file, args, options) =>
  execFileAsync(file, args, options) as Promise<{ stdout: string; stderr: string }>;

export type SandboxRole = 'candidate' | 'verifier';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxSession {
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  listFiles(): Promise<string[]>;
  runCommand(command: string, role?: SandboxRole, timeoutMs?: number): Promise<CommandResult>;
  destroy(): Promise<void>;
}

export interface SandboxRunner {
  create(spec: TaskSpec): Promise<SandboxSession>;
}

export interface SandboxOptions {
  backend: 'docker' | 'local';
  baseDir?: string;
  executeFile?: ExecuteFile;
}

export function isSafeWorkspacePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\0')) return false;
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized === '.arbiter-verifier' || normalized.startsWith('.arbiter-verifier/'))
    return false;
  const segments = normalized.split('/');
  return !segments.some((segment) => segment === '..' || segment === '');
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  if (!isSafeWorkspacePath(relativePath)) {
    throw new Error(`Unsafe workspace path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`Workspace path escaped root: ${relativePath}`);
  return resolved;
}

async function writeFileMap(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = resolveWorkspacePath(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, fullPath)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath).replaceAll('\\', '/'));
    }
  }
  return files.sort();
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  return `${value.slice(0, Math.max(0, maxBytes - 64))}\n...[output truncated]`;
}

class FilesystemSandboxSession implements SandboxSession {
  public constructor(
    private readonly root: string,
    private readonly verifierRoot: string,
    private readonly spec: TaskSpec,
    private readonly options: SandboxOptions,
  ) {}

  public async readFile(relativePath: string): Promise<string> {
    return readFile(resolveWorkspacePath(this.root, relativePath), 'utf8');
  }

  public async writeFile(relativePath: string, content: string): Promise<void> {
    const target = resolveWorkspacePath(this.root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  public async listFiles(): Promise<string[]> {
    return collectFiles(this.root);
  }

  public async runCommand(
    command: string,
    role: SandboxRole = 'candidate',
    timeoutMs = this.spec.limits.maxRuntimeMs,
  ): Promise<CommandResult> {
    const startedAt = Date.now();
    if (this.options.backend === 'docker') {
      return this.runDockerCommand(command, role, timeoutMs, startedAt);
    }
    return this.runLocalCommand(command, role, timeoutMs, startedAt);
  }

  public async destroy(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await rm(this.verifierRoot, { recursive: true, force: true });
  }

  private async runDockerCommand(
    command: string,
    role: SandboxRole,
    timeoutMs: number,
    startedAt: number,
  ): Promise<CommandResult> {
    const normalizedRoot = this.root.replaceAll('\\', '/');
    const normalizedVerifier = this.verifierRoot.replaceAll('\\', '/');
    const args = [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--pids-limit',
      String(this.spec.limits.pids),
      '--memory',
      `${this.spec.limits.memoryMb}m`,
      '--cpus',
      '1',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--mount',
      `type=bind,source=${normalizedRoot},target=/workspace`,
      '--mount',
      `type=bind,source=${normalizedVerifier},target=/verifier,readonly`,
      '--workdir',
      '/workspace',
      '--env',
      'HOME=/tmp',
      '--env',
      `ARBITER_WORKSPACE=/workspace`,
      '--env',
      `ARBITER_VERIFIER_DIR=/verifier`,
      this.spec.toolchain.image,
      'sh',
      '-lc',
      command,
    ];
    try {
      const result = await (this.options.executeFile ?? defaultExecuteFile)('docker', args, {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: this.spec.limits.outputBytes,
      });
      return {
        exitCode: 0,
        stdout: truncate(result.stdout, this.spec.limits.outputBytes),
        stderr: truncate(result.stderr, this.spec.limits.outputBytes),
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } catch (error) {
      const typed = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        killed?: boolean;
      };
      return {
        exitCode: typeof typed.code === 'number' ? typed.code : 1,
        stdout: truncate(typed.stdout ?? '', this.spec.limits.outputBytes),
        stderr: truncate(
          typed.stderr ?? typed.message ?? 'Docker command failed.',
          this.spec.limits.outputBytes,
        ),
        durationMs: Date.now() - startedAt,
        timedOut: typed.killed === true || typed.code === 'ETIMEDOUT',
      };
    }
  }

  private async runLocalCommand(
    command: string,
    role: SandboxRole,
    timeoutMs: number,
    startedAt: number,
  ): Promise<CommandResult> {
    const localCommand =
      role === 'verifier'
        ? command.replaceAll('/verifier/', './').replaceAll('/verifier', '.')
        : command;
    const workingDirectory = role === 'verifier' ? this.verifierRoot : this.root;
    try {
      const result = await (this.options.executeFile ?? defaultExecuteFile)(
        process.platform === 'win32' ? 'cmd.exe' : 'sh',
        process.platform === 'win32' ? ['/d', '/s', '/c', localCommand] : ['-lc', localCommand],
        {
          cwd: workingDirectory,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: this.spec.limits.outputBytes,
          env: {
            ...process.env,
            ARBITER_WORKSPACE: this.root,
            ARBITER_VERIFIER_DIR: this.verifierRoot,
            ARBITER_SANDBOX_ROLE: role,
          },
        },
      );
      return {
        exitCode: 0,
        stdout: truncate(result.stdout, this.spec.limits.outputBytes),
        stderr: truncate(result.stderr, this.spec.limits.outputBytes),
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } catch (error) {
      const typed = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        killed?: boolean;
      };
      return {
        exitCode: typeof typed.code === 'number' ? typed.code : 1,
        stdout: truncate(typed.stdout ?? '', this.spec.limits.outputBytes),
        stderr: truncate(
          typed.stderr ?? typed.message ?? 'Local command failed.',
          this.spec.limits.outputBytes,
        ),
        durationMs: Date.now() - startedAt,
        timedOut: typed.killed === true || typed.code === 'ETIMEDOUT',
      };
    }
  }
}

export class FilesystemSandboxRunner implements SandboxRunner {
  public constructor(private readonly options: SandboxOptions = { backend: 'docker' }) {}

  public async create(spec: TaskSpec): Promise<SandboxSession> {
    const baseDir = path.resolve(
      this.options.baseDir ?? path.resolve(process.cwd(), 'data', 'sandboxes'),
    );
    await mkdir(baseDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const root = path.join(baseDir, id, 'workspace');
    const verifierRoot = path.join(baseDir, id, 'verifier');
    await mkdir(root, { recursive: true });
    await mkdir(verifierRoot, { recursive: true });
    await writeFileMap(root, spec.starterFiles);
    await writeFileMap(verifierRoot, spec.verifierFiles);
    return new FilesystemSandboxSession(root, verifierRoot, spec, this.options);
  }
}
