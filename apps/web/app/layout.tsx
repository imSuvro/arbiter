import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Arbiter — Agent evaluation, made observable.',
    template: '%s · Arbiter',
  },
  description:
    'Author, run, score, and compare agentic coding evaluations with deterministic evidence.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
