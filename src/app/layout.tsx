import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wroffy Rank',
  description: 'Track your Google keyword rankings.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
