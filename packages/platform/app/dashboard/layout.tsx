import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Badge } from '@/components/Badge';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen bg-navy-50">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-navy-100 bg-white px-6 py-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-navy-500">
              Developer dashboard
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Badge color="blue">free plan</Badge>
            <div className="flex items-center gap-2 text-sm">
              <div className="h-7 w-7 rounded-full bg-navy-200" />
              <span className="font-medium text-navy-800">
                {session.user.name ?? session.user.email}
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
