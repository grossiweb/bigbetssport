import { Badge } from '@/components/Badge';
import { PricingCards } from '@/components/marketing/PricingCards';
import { Callout } from '@/components/Callout';

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Billing</h1>
        <p className="mt-1 text-sm text-navy-500">
          Plan + payment settings. Paid plans will land once Stripe is wired up.
        </p>
      </div>

      <div className="card flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-navy-800">Current plan</h2>
            <Badge color="blue">free</Badge>
            <Badge color="green">early access</Badge>
          </div>
          <p className="mt-3 text-sm text-navy-500">
            Full <code className="rounded bg-navy-100 px-1 py-0.5">/v1/stored/*</code>{' '}
            read surface. No rate limits enforced during early access.
          </p>
        </div>
      </div>

      <Callout type="info">
        Stripe checkout + webhook handling are scaffolded in the codebase but
        not connected to live products yet. Once live, upgrading will activate
        higher throughput, API-key rotation analytics, and HMAC-signed webhooks.
      </Callout>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-navy-800">Planned tiers</h2>
        <PricingCards />
      </div>
    </div>
  );
}
