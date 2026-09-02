import Link from 'next/link';
import { LineChart } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LineChart className="h-5 w-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight">OurRankTracker</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
