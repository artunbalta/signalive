import {
  NATIVE_PROTOCOL_VERSION,
  isNativeErrorCode,
  isNativeMethod,
  nativeFailure,
  nativeResult,
  parseCall,
  validateParams,
  type NativeErrorInfo,
  type NativeFailure,
  type NativeMethod,
  type NativeParams,
  type NativeResult,
  type NativeResults,
} from "../shared";

/** One function per method, given params already checked and normalized. */
export type Handlers = {
  [M in NativeMethod]: (params: NativeParams[M]) => Promise<NativeResults[M]> | NativeResults[M];
};

/** A thrown value as the error the page gets: a bridge code when it carries one, "failed" otherwise. */
export function failureOf(e: unknown): NativeErrorInfo {
  const o = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; message?: unknown };
  const code = isNativeErrorCode(o.code) ? o.code : "failed";
  const message = typeof o.message === "string" && o.message ? o.message : typeof e === "string" ? e : "Something went wrong in the app";
  return { code, message: message.slice(0, 500) };
}

/**
 * One raw message from the page, answered. Anything that is not a call (not
 * a string, not JSON, another channel, no usable id) is ignored: null, and
 * nothing happens. A call is always answered: an unknown method, params that
 * do not validate or another bridge version get an error and run nothing;
 * otherwise the method's handler runs, and what it returns or throws is the
 * answer.
 */
export async function route(raw: unknown, handlers: Handlers): Promise<NativeResult | NativeFailure | null> {
  const call = parseCall(raw);
  if (!call) return null;
  if (call.v !== NATIVE_PROTOCOL_VERSION) {
    return nativeFailure(call.id, "unsupported", `The page speaks bridge version ${call.v}, this app ${NATIVE_PROTOCOL_VERSION}`);
  }
  if (!isNativeMethod(call.method)) return nativeFailure(call.id, "unknown_method", `This app has no method ${call.method}`);
  const params = validateParams(call.method, call.params);
  if (!params.ok) return nativeFailure(call.id, "bad_request", `${call.method}: ${params.error}`);
  try {
    const handler = handlers[call.method] as (p: unknown) => unknown;
    const value = await handler(params.value);
    return nativeResult(call.id, value);
  } catch (e) {
    const f = failureOf(e);
    return nativeFailure(call.id, f.code, f.message);
  }
}
