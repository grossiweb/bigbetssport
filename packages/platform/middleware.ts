import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

// Edge-runtime middleware: uses the stripped-down authConfig (no Node deps)
// so webpack doesn't try to bundle pg/bcryptjs/node:crypto into the Edge
// bundle. Full providers live in @/lib/auth (Node runtime only).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ['/dashboard/:path*', '/api/keys/:path*', '/api/billing/:path*'],
};
