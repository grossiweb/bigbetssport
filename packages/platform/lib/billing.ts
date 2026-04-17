import Stripe from 'stripe';
import { db } from './db.js';
import type { Plan } from './api-keys.js';

/**
 * Stripe billing integration. All plan changes round-trip through Stripe
 * Checkout → webhook → local subscriptions table → api_keys.plan update.
 */

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeClient) {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripeClient = new Stripe(key, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion });
  }
  return stripeClient;
}

export const STRIPE_PRICE_IDS: Readonly<Record<Plan, { monthly: string; yearly: string } | null>> = {
  free: null,
  starter: {
    monthly: process.env['STRIPE_PRICE_STARTER'] ?? '',
    yearly: process.env['STRIPE_PRICE_STARTER_YEARLY'] ?? '',
  },
  pro: {
    monthly: process.env['STRIPE_PRICE_PRO'] ?? '',
    yearly: process.env['STRIPE_PRICE_PRO_YEARLY'] ?? '',
  },
  enterprise: null,
};

export interface Subscription {
  readonly id: string;
  readonly userId: string;
  readonly ownerEmail: string;
  readonly plan: Plan;
  readonly stripeCustomerId: string | null;
  readonly stripeSubId: string | null;
  readonly status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  readonly currentPeriodEnd: Date | null;
}

interface SubRow {
  id: string;
  user_id: string | null;
  owner_email: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_sub_id: string | null;
  status: string;
  current_period_end: Date | null;
}

function rowToSub(r: SubRow): Subscription {
  return {
    id: r.id,
    userId: r.user_id ?? '',
    ownerEmail: r.owner_email,
    plan: (r.plan as Plan) ?? 'free',
    stripeCustomerId: r.stripe_customer_id,
    stripeSubId: r.stripe_sub_id,
    status: (r.status as Subscription['status']) ?? 'active',
    currentPeriodEnd: r.current_period_end,
  };
}

/**
 * Return the Stripe customer id for this user, creating one on first call.
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const existing = await db().query<SubRow>(
    `SELECT id, user_id, owner_email, plan, stripe_customer_id, stripe_sub_id, status, current_period_end
       FROM subscriptions WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = existing.rows[0];
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const customer = await stripe().customers.create({
    email,
    metadata: { userId },
  });

  if (row) {
    await db().query(
      `UPDATE subscriptions SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`,
      [customer.id, row.id],
    );
  } else {
    await db().query(
      `INSERT INTO subscriptions (user_id, owner_email, plan, stripe_customer_id)
         VALUES ($1, $2, 'free', $3)`,
      [userId, email, customer.id],
    );
  }
  return customer.id;
}

export async function getCurrentSubscription(userId: string): Promise<Subscription | null> {
  const result = await db().query<SubRow>(
    `SELECT id, user_id, owner_email, plan, stripe_customer_id, stripe_sub_id, status, current_period_end
       FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? rowToSub(result.rows[0]) : null;
}

/**
 * Sync a local subscription from a live Stripe subscription — pulled by the
 * webhook handler on checkout.session.completed and customer.subscription.*.
 */
export async function syncPlanFromStripe(stripeSubId: string): Promise<void> {
  const sub = await stripe().subscriptions.retrieve(stripeSubId);
  const priceId = sub.items.data[0]?.price.id;
  const plan = planFromPriceId(priceId);

  await db().query(
    `UPDATE subscriptions
        SET plan = $1,
            stripe_sub_id = $2,
            status = $3,
            current_period_start = to_timestamp($4),
            current_period_end = to_timestamp($5),
            updated_at = NOW()
      WHERE stripe_customer_id = $6`,
    [
      plan,
      sub.id,
      sub.status,
      sub.current_period_start,
      sub.current_period_end,
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    ],
  );

  // Cascade the plan onto every API key owned by the user so the gateway
  // picks it up immediately (next request after Stripe webhook).
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await db().query(
    `UPDATE api_keys
        SET plan = $1
      WHERE user_id = (SELECT user_id FROM subscriptions WHERE stripe_customer_id = $2 LIMIT 1)`,
    [plan, customerId],
  );
}

function planFromPriceId(priceId: string | undefined): Plan {
  if (!priceId) return 'free';
  if (priceId === STRIPE_PRICE_IDS.starter?.monthly || priceId === STRIPE_PRICE_IDS.starter?.yearly) {
    return 'starter';
  }
  if (priceId === STRIPE_PRICE_IDS.pro?.monthly || priceId === STRIPE_PRICE_IDS.pro?.yearly) {
    return 'pro';
  }
  return 'free';
}

/** Verify a Stripe webhook payload. Throws on bad signature. */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string,
): Stripe.Event {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
