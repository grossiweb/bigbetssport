import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { revokeApiKey } from '@/lib/api-keys';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  await revokeApiKey(params.id, session.user.id);
  return NextResponse.json({ data: { revoked: true } });
}
