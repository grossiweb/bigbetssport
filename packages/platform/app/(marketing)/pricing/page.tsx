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
            <h3 className="font-semibold text-navy-800">How do rate limits work?</h3>
            <p className="mt-1">
              Two buckets: per-minute (sliding window) + per-day (UTC fixed window).
              Every response carries X-RateLimit-Remaining; 429 responses include
              a Retry-After header.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-navy-800">Can I downgrade or cancel anytime?</h3>
            <p className="mt-1">
              Yes — manage your plan from the dashboard or the Stripe Customer
              Portal. Downgrades take effect at the next billing cycle.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-navy-800">What counts as one request?</h3>
            <p className="mt-1">
              One HTTP request to any <code className="font-mono text-xs">/v1/*</code> endpoint.
              Fields inside a response don't count separately. Webhook deliveries
              do NOT count against your rate limit.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-navy-800">What if I exceed my plan?</h3>
            <p className="mt-1">
              The gateway returns 429. You can upgrade instantly — new limits
              apply immediately.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
