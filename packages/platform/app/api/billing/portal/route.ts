import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrCreateStripeCustomer, stripe } from '@/lib/billing';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const customerId = await getOrCreateStripeCustomer(session.user.id, session.user.email);
  const origin = req.headers.get('origin') ?? process.env['NEXTAUTH_URL'] ?? 'http://localhost:3001';
  const portal = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard/billing`,
  });
  return NextResponse.redirect(portal.url, 303);
}
