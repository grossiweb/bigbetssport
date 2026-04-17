import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createUser } from '@/lib/auth';
import { db } from '@/lib/db';

const Body = z.object({
  name: z.string().trim().max(100).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { name, email, password } = parsed.data;

  // Cheap pre-check: reject duplicate email with a clear message instead
  // of relying on the UNIQUE constraint error.
  try {
    const existing = await db().query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email.toLowerCase().trim()],
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: 'Email is already registered.' }, { status: 409 });
    }
    await createUser({ email, password, ...(name ? { name } : {}) });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('database') || msg.toLowerCase().includes('connection')) {
      return NextResponse.json(
        {
          error:
            'Database not reachable. See packages/platform/README for setup.',
          detail: msg,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
