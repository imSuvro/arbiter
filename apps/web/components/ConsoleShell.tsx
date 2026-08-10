'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const navigation = [
  { href: '/console', label: 'Overview', icon: '◫' },
  { href: '/console/tasks', label: 'Task library', icon: '⌘' },
  { href: '/console/compare', label: 'Compare runs', icon: '≋' },
  { href: '/console/settings', label: 'Settings', icon: '◌' },
];

export function ConsoleShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [operator, setOperator] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void apiFetch<{ authenticated: boolean; operator?: { email: string } }>('/api/auth/session')
      .then((session) => {
        if (!session.authenticated) router.replace('/login');
        else setOperator(session.operator?.email ?? null);
      })
      .catch(() => router.replace('/login'))
      .finally(() => setChecking(false));
  }, [router]);

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' });
    router.replace('/login');
  }

  if (checking)
    return (
      <div className="route-loading">
        <span className="pulse-dot" /> Establishing operator session…
      </div>
    );

  return (
    <div className="console-frame">
      <aside className="sidebar">
        <Link className="brand brand--sidebar" href="/console">
          <span className="brand-mark">A</span>
          <span>Arbiter</span>
        </Link>
        <div className="sidebar__section-label">Workspace</div>
        <nav className="sidebar__nav" aria-label="Console navigation">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? 'nav-item nav-item--active' : 'nav-item'}
            >
              <span className="nav-item__icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="operator-chip">
            <span className="avatar">{operator?.[0]?.toUpperCase() ?? 'O'}</span>
            <span>
              <strong>Operator</strong>
              <small>{operator}</small>
            </span>
          </div>
          <button className="text-button" onClick={() => void signOut()}>
            Sign out <span aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>
      <main className="console-main">
        <header className="console-header">
          <div className="mobile-brand">
            <span className="brand-mark">A</span> Arbiter
          </div>
          <span className="environment-tag">
            <i /> Local evaluation environment
          </span>
        </header>
        {children}
      </main>
    </div>
  );
}
