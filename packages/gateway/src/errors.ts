/**
 * Gateway error codes. These are surfaced in `ApiError.code` on responses and
 * should be treated as part of the public API — don't rename without a version
 * bump.
 */
export const ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
