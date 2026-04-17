import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { STRIPE_PRICE_IDS, getOrCreateStripeCustomer, stripe } from '@/lib/billing';
import type { Plan } from '@/lib/api-keys';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const plan = (form?.get('plan') as Plan | null) ?? 'starter';
  const interval = (form?.get('interval') as string | null) ?? 'monthly';
  const priceGroup = STRIPE_PRICE_IDS[plan];
  if (!priceGroup) {
    return NextResponse.json({ error: `plan ${plan} has no paid price` }, { status: 400 });
  }
  const priceId = interval === 'yearly' ? priceGroup.yearly : priceGroup.monthly;
  if (!priceId) {
    return NextResponse.json({ error: 'price id not configured' }, { status: 500 });
  }

  const customerId = await getOrCreateStripeCustomer(session.user.id, session.user.email);

  const origin = req.headers.get('origin') ?? process.env['NEXTAUTH_URL'] ?? 'http://localhost:3001';
  const checkout = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/billing?upgraded=true`,
    cancel_url: `${origin}/dashboard/billing`,
    metadata: { userId: session.user.id, plan },
  });

  if (!checkout.url) {
    return NextResponse.json({ error: 'stripe did not return a checkout url' }, { status: 500 });
  }
  return NextResponse.redirect(checkout.url, 303);
}
