import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe NextAuth config. Imported by `middleware.ts`, so it MUST NOT
 * reach for Node-only modules (`pg`, `bcryptjs`, `node:crypto`). The full
 * config — with the Credentials provider — lives in `auth.ts` and is used
 * by API routes + server components.
 *
 * Pattern per https://authjs.dev/guides/edge-compatibility.
 */
export const authConfig = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env['NEXTAUTH_SECRET'],
  trustHost: true,
  providers: [], // populated in auth.ts (Node runtime)
  callbacks: {
    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith('/dashboard')) return !!auth;
      return true;
    },
  },
  pages: { signIn: '/login' },
} satisfies NextAuthConfig;
