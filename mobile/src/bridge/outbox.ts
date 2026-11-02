import { NATIVE_GLOBAL, nativeBatch, type NativeOutgoing } from "../shared";

/** U+2028 and U+2029, escaped for engines that do not take them raw in a string literal. */
const LINE_SEPARATORS = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
export function escapeSeparators(json: string): string {
  return LINE_SEPARATORS.reduce((s, c) => s.split(c).join("\\u" + c.charCodeAt(0).toString(16)), json);
}

/**
 * The JavaScript that hands messages to the page: one message, or several as
 * a batch, passed to SignaliveNative.__receive as an object literal. JSON is
 * a JavaScript literal, so nothing in it (a device's advertised name, say)
 * can break out of it; U+2028 and U+2029 are escaped for engines that predate
 * that rule. A page without the bridge (still loading, or not the app's)
 * ignores it.
 */
export function toInjection(messages: NativeOutgoing[]): string {
  const payload = messages.length === 1 ? messages[0] : nativeBatch(messages);
  const json = escapeSeparators(JSON.stringify(payload));
  return `(function(){var n=window.${NATIVE_GLOBAL};if(n&&typeof n.__receive==="function")n.__receive(${json});})();true;`;
}

export interface OutboxOptions {
  /** How long an event may wait for company, ms. Default 16, about a frame. */
  delayMs?: number;
  /** Most messages held at once; the oldest go first past it (a page that has stopped listening). Default 2048. */
  maxQueue?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Messages to the page, batched. Two earbuds notify about 80 times a second
 * between them, and each injection is a call across into the WebView, so
 * events wait up to delayMs and go together; an answer to a call goes at
 * once, with whatever was waiting before it, so order is kept.
 */
export class Outbox {
  private queue: NativeOutgoing[] = [];
  private timer: unknown = null;
  private readonly delayMs: number;
  private readonly maxQueue: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(
    private readonly inject: (js: string) => void,
    opts: OutboxOptions = {},
  ) {
    this.delayMs = opts.delayMs ?? 16;
    this.maxQueue = opts.maxQueue ?? 2048;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get size(): number {
    return this.queue.length;
  }

  push(message: NativeOutgoing): void {
    if (this.queue.length >= this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue + 1);
    this.queue.push(message);
    if (message.kind === "result") this.flush();
    else if (this.timer === null) this.timer = this.schedule(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.inject(toInjection(batch));
  }

  /** Drops what is waiting: the page it was for has gone. */
  clear(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.queue = [];
  }
}
