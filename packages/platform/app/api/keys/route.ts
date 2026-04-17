import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { ALL_SCOPES, createApiKey, listApiKeys } from '@/lib/api-keys';

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  environment: z.enum(['live', 'test']).default('live'),
  scopes: z
    .array(z.enum(ALL_SCOPES as unknown as [string, ...string[]]))
    .optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const keys = await listApiKeys(session.user.id);
  return NextResponse.json({ data: keys });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = await createApiKey({
    userId: session.user.id,
    name: parsed.data.name,
    plan: 'free',
    environment: parsed.data.environment,
    ...(parsed.data.scopes && parsed.data.scopes.length > 0
      ? { scopes: parsed.data.scopes as Parameters<typeof createApiKey>[0]['scopes'] }
      : {}),
    ...(session.user.email ? { ownerEmail: session.user.email } : {}),
  });
  return NextResponse.json({ data: result }, { status: 201 });
}
