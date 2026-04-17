import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { syncPlanFromStripe, verifyStripeWebhook } from '@/lib/billing';
import { db } from '@/lib/db';

/**
 * Stripe webhook receiver.
 *
 *   POST /api/stripe/webhook
 *
 * Verifies the signature via `stripe.webhooks.constructEvent`, then routes
 * on event type. The handler is idempotent — replaying an event twice is
 * safe (all writes are upserts against the Stripe customer id).
 *
 * Configure in the Stripe dashboard with the events:
 *   checkout.session.completed
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 *   invoice.paid
 */

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing stripe-signature' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(rawBody, signature);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'bad signature';
    return NextResponse.json({ error: `webhook signature verification failed: ${msg}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription && typeof session.subscription === 'string') {
          await syncPlanFromStripe(session.subscription);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await syncPlanFromStripe(sub.id);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await db().query(
            `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
              WHERE stripe_customer_id = $1`,
            [invoice.customer],
          );
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await db().query(
            `UPDATE subscriptions SET status = 'active', updated_at = NOW()
              WHERE stripe_customer_id = $1`,
            [invoice.customer],
          );
        }
        break;
      }
      default:
        break;
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'handler error';
    console.error(`[stripe-webhook] ${event.type} failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
