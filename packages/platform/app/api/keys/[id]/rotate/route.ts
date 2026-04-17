import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rotateApiKey } from '@/lib/api-keys';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await rotateApiKey(params.id, session.user.id);
    return NextResponse.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'rotate failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
