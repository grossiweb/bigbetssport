export { auth as middleware } from '@/lib/auth';

export const config = {
  // Run on all dashboard paths + any platform API routes that need a session.
  matcher: ['/dashboard/:path*', '/api/keys/:path*', '/api/billing/:path*'],
};
