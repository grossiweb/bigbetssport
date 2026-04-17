import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';

/**
 * iSports adapter — tier-2. Not currently in FIELD_REGISTRY so the router
 * will never call it. Scaffolded for a follow-up when iSports is promoted
 * into a field's source list.
 */
const isportsAdapter: SourceAdapter = {
  sourceId: 'isports',
  confidence: 0.75,
  buildRequest(_field: FieldKey, _params: FetchParams): Request | null {
    return null;
  },
  extractField(_field: FieldKey, _data: unknown): unknown | null {
    return null;
  },
};

export default isportsAdapter;
