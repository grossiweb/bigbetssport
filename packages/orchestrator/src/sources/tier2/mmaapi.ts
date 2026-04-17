import type { FieldKey, FetchParams } from '@bbs/shared';
import type { SourceAdapter } from '../adapter.js';

/**
 * MMA API adapter — community-maintained, UNRELIABLE. Not currently wired
 * into FIELD_REGISTRY; MMA routing should primarily rely on TheRundown and
 * MCP scrapers.
 */
const mmaApiAdapter: SourceAdapter = {
  sourceId: 'mmaapi',
  confidence: 0.6,
  buildRequest(_field: FieldKey, _params: FetchParams): Request | null {
    return null;
  },
  extractField(_field: FieldKey, _data: unknown): unknown | null {
    return null;
  },
};

export default mmaApiAdapter;
