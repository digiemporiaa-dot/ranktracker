import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { ToastProvider } from '@/components/ui/toast';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar userName={user.name} userEmail={user.email} />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
