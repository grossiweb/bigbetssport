import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { PricingCards } from '@/components/marketing/PricingCards';

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Billing</h1>
        <p className="mt-1 text-sm text-navy-500">
          Manage your plan, payment method, and invoices.
        </p>
      </div>

      <div className="card flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-navy-800">Current plan</h2>
            <Badge color="blue">free</Badge>
            <Badge color="green">active</Badge>
          </div>
          <p className="mt-1 text-sm text-navy-500">
            1,000 requests/day · 100 requests/minute · REST + webhooks
          </p>
          <div className="mt-4 h-2 w-64 overflow-hidden rounded-full bg-navy-100">
            <div className="h-2 rounded-full bg-brand" style={{ width: '12%' }} />
          </div>
          <p className="mt-1 text-xs text-navy-500">
            120 / 1,000 requests used today (resets at 00:00 UTC)
          </p>
        </div>
        <form action="/api/billing/create-checkout" method="POST">
          <input type="hidden" name="plan" value="starter" />
          <Button type="submit">Upgrade plan</Button>
        </form>
      </div>

      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-navy-800">Payment method</h2>
        <p className="text-sm text-navy-500">
          Manage your card, change billing address, and view invoices in the
          Stripe Customer Portal.
        </p>
        <form action="/api/billing/portal" method="POST" className="mt-4">
          <Button type="submit" variant="secondary">Open billing portal</Button>
        </form>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-navy-800">Available plans</h2>
        <PricingCards />
      </div>
    </div>
  );
}
