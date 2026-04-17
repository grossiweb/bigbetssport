import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { authConfig as edgeConfig } from './auth.config.js';
import { db } from './db.js';

/**
 * NextAuth v5 config.
 *
 * Scope of this turn:
 *   - Email + password (Credentials provider, bcrypt 12 rounds)
 *   - JWT session strategy (edge-compatible)
 *
 * Deferred to a follow-up prompt:
 *   - GitHub / Google OAuth (providers commented below)
 *   - Magic link email provider
 *   - Session / user table persistence (we use JWT-only for now)
 */

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      email: string;
      name: string | null;
    } & DefaultSession['user'];
  }
}

const BCRYPT_ROUNDS = 12;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await db().query<UserRow>(
    `SELECT id, email, name, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase().trim()],
  );
  return result.rows[0] ?? null;
}

export async function createUser(params: {
  email: string;
  password: string;
  name?: string;
}): Promise<UserRow> {
  const email = params.email.toLowerCase().trim();
  const passwordHash = await hash(params.password, BCRYPT_ROUNDS);
  const id = randomUUID();
  await db().query(
    `INSERT INTO users (id, email, name, password_hash, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
    [id, email, params.name ?? null, passwordHash],
  );
  return {
    id,
    email,
    name: params.name ?? null,
    password_hash: passwordHash,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...edgeConfig,
  providers: [
    Credentials({
      name: 'Email + password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (raw) => {
        const email = typeof raw?.['email'] === 'string' ? (raw['email'] as string) : '';
        const password = typeof raw?.['password'] === 'string' ? (raw['password'] as string) : '';
        if (!email || !password) return null;
        const user = await findUserByEmail(email);
        if (!user || !user.password_hash) return null;
        const ok = await compare(password, user.password_hash);
        if (!ok) return null;
        await db()
          .query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id])
          .catch(() => undefined);
        return { id: user.id, email: user.email, name: user.name ?? email };
      },
    }),
    // TODO(P-12+): wire GitHub + Google + Resend magic-link providers.
  ],
  callbacks: {
    ...edgeConfig.callbacks,
    jwt: async ({ token, user }) => {
      if (user && 'id' in user) token['uid'] = (user as { id: string }).id;
      return token;
    },
    session: async ({ session, token }) => {
      if (token['uid'] && session.user) {
        (session.user as { id: string }).id = token['uid'] as string;
      }
      return session;
    },
  },
});
