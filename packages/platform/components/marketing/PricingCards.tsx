import Link from 'next/link';
import clsx from 'clsx';
import { Button } from '../Button';

interface Plan {
  readonly name: string;
  readonly price: string;
  readonly billed: string;
  readonly features: readonly string[];
  readonly cta: string;
  readonly ctaHref: string;
  readonly highlight?: boolean;
}

const PLANS: readonly Plan[] = [
  {
    name: 'Free',
    price: '$0',
    billed: 'forever',
    cta: 'Start free',
    ctaHref: '/signup',
    features: [
      'Full /v1/stored/* REST surface',
      'Matches, odds, standings, rosters, stats',
      'Team logos + player headshots',
      'Dashboard with search + filters',
      'Email support',
    ],
  },
  {
    name: 'Starter',
    price: '$49',
    billed: 'per month',
    cta: 'Coming soon',
    ctaHref: '#',
    features: [
      'Free plan, plus:',
      'Higher request throughput',
      'API key rotation via dashboard',
      'Usage analytics charts',
      'Priority email support',
    ],
  },
  {
    name: 'Pro',
    price: '$149',
    billed: 'per month',
    cta: 'Coming soon',
    ctaHref: '#',
    highlight: true,
    features: [
      'Starter plan, plus:',
      'HMAC-signed webhooks (planned)',
      'WebSocket live feed (planned)',
      'Historical backfill',
      '99.9% uptime target',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    billed: 'contact sales',
    cta: 'Talk to us',
    ctaHref: 'mailto:sales@bigballsports.io',
    features: [
      'Volume pricing',
      'Dedicated infrastructure',
      'Custom ingest sources',
      'Dedicated support channel',
      'MSA + DPA',
    ],
  },
];

export function PricingCards() {
  return (
    <section id="pricing" className="border-y border-navy-100 bg-navy-50 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-navy-800 sm:text-4xl">
            Free during early access
          </h2>
          <p className="mt-3 text-navy-500">
            Paid tiers go live when Stripe is wired in. Prices below are
            placeholders — final amounts may shift before launch.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={clsx(
                'card flex flex-col',
                p.highlight && 'ring-2 ring-brand shadow-elevated',
              )}
            >
              {p.highlight && (
                <span className="mb-2 inline-flex self-start rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-navy-800">{p.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-semibold text-navy-800">{p.price}</span>
                <span className="text-sm text-navy-500">/ {p.billed}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-2 text-sm text-navy-600">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-0.5 text-emerald-500">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={p.ctaHref} className="mt-6 block">
                <Button
                  variant={p.highlight ? 'primary' : 'secondary'}
                  className="w-full"
                >
                  {p.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
