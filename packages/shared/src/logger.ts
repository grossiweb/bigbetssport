import { pino, type Logger } from 'pino';

/**
 * Shared pino logger. One singleton per process; children inherit bindings.
 *
 * Log levels:
 *   debug — cache hit/miss traces
 *   info  — successful upstream calls, MCP dispatches
 *   warn  — gap events, circuit-breaker state changes
 *   error — unhandled upstream failures
 *
 * Controlled by `LOG_LEVEL` env (default `info`).
 */
export const log: Logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: process.env['BBS_SERVICE_NAME'] ?? 'bbs' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Build a child logger bound to a fixed set of labels. */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return log.child(bindings);
}
