import { QueryProvider } from '../../components/QueryProvider';
import { ConsoleShell } from '../../components/ConsoleShell';

export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </QueryProvider>
  );
}
