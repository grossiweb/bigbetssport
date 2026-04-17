/**
 * JSON-RPC 2.0 shapes used by every MCP scraper server.
 */

export interface RpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly method: string;
  readonly params?: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
  };
}

export interface RpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result: {
    readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  };
}

export interface RpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type RpcResponse = RpcSuccess | RpcFailure;

/** JSON-RPC 2.0 canonical error codes. */
export const RPC_ERROR = {
  PARSE: -32_700,
  INVALID_REQUEST: -32_600,
  METHOD_NOT_FOUND: -32_601,
  INVALID_PARAMS: -32_602,
  INTERNAL: -32_603,
  RATE_LIMITED: -32_000,
} as const;

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export function isRpcFailure(r: RpcResponse): r is RpcFailure {
  return 'error' in r;
}
