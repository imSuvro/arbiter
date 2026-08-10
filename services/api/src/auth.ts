import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  randomUUID,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from '@arbiter/storage';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'arbiter_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(':');
  if (!salt || !expectedHex) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(store: Store, operatorId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await store.createSession({
    id: randomUUID(),
    tokenHash: tokenHash(token),
    operatorId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return token;
}

export function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/' });
}

export async function requireAuth(
  store: Store,
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    response.status(401).json({
      type: 'https://arbiter.dev/problems/unauthorized',
      title: 'Authentication required',
      status: 401,
    });
    return;
  }
  const session = await store.findSession(tokenHash(token));
  if (!session) {
    response.status(401).json({
      type: 'https://arbiter.dev/problems/unauthorized',
      title: 'Session expired',
      status: 401,
    });
    return;
  }
  response.locals.operatorId = session.operatorId;
  next();
}

export { SESSION_COOKIE };
