import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';

export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy-800">Webhooks</h1>
          <p className="mt-1 text-sm text-navy-500">
            Receive real-time events at your own endpoints. HMAC-signed,
            retried on failure.
          </p>
        </div>
        <Button>+ Add endpoint</Button>
      </div>

      <div className="card text-center">
        <p className="text-sm text-navy-500">No webhook endpoints yet.</p>
        <p className="mt-1 text-xs text-navy-400">
          Add an endpoint to receive <code>match.score_update</code>, <code>match.goal</code>, and more.
        </p>
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-navy-800">Event types</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            'match.score_update',
            'match.goal',
            'match.card',
            'match.substitution',
            'match.start',
            'match.end',
            'match.odds_move',
            'lineup.confirmed',
            'injury.update',
            'quota.warning',
            'quota.exhausted',
            'source.circuit_open',
          ].map((e) => (
            <Badge key={e} color="grey">
              {e}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
