import { PricingCards } from '@/components/marketing/PricingCards';

export default function PricingPage() {
  return (
    <div className="py-12">
      <div className="mx-auto mb-12 max-w-3xl px-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-navy-800 sm:text-5xl">
          Pricing
        </h1>
        <p className="mt-4 text-lg text-navy-500">
          Start free, scale as you grow. No credit card needed for the free plan.
        </p>
      </div>
      <PricingCards />

      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="mb-8 text-2xl font-semibold text-navy-800">Frequently asked</h2>
        <div className="space-y-6 text-sm text-navy-600">
          <div>
            <h3 className="font-semibold text-navy-800">What's actually live today?</h3>
            <p className="mt-1">
              Matches, odds, standings, team + player rosters, boxscores, and
              scoring plays across NBA / NFL / MLB / NHL / NCAAF and the top
              European soccer leagues. Read the coverage table on the home page
              for field-by-field status.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-navy-800">How do rate limits work?</h3>
            <p className="mt-1">
              The free plan is open during early access — no per-key rate
              limits enforced yet. We'll introduce per-minute + per-day buckets
              when paid plans go live; existing keys will be grandfathered.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-navy-800">When will paid plans ship?</h3>
            <p className="mt-1">
              We're wiring Stripe next. Once paid plans are live, you'll be able
              to upgrade from the dashboard and start using higher throughput +
              webhooks + (eventually) the WebSocket live feed.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-navy-800">Will existing keys stop working?</h3>
            <p className="mt-1">
              No. Free plan keeps the core <code className="font-mono text-xs">/v1/stored/*</code>{' '}
              read surface. Paid tiers add throughput, webhooks, and advanced
              endpoints, not a paywall on what already works.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
