import { nativeEvent, type NativeEventData, type NativeEventName } from "../shared";
import { isAppUrl } from "../shell/navigation";
import { Outbox, type OutboxOptions } from "./outbox";
import { route, type Handlers } from "./router";

export interface BridgeHostOptions {
  /** Runs JavaScript in the page: WebView.injectJavaScript. */
  inject: (js: string) => void;
  appOrigin: string;
  handlers: Handlers;
  outbox?: OutboxOptions;
}

/**
 * The shell's end of the bridge, without React Native in it: messages in
 * (from the app's own origin only), answers and events out through the
 * outbox. A page that goes (a reload, a navigation) takes its calls with it:
 * answers that come back after are dropped rather than handed to the next
 * page, whose call ids may well collide.
 */
export class BridgeHost {
  readonly outbox: Outbox;
  private page = 0;

  constructor(private readonly opts: BridgeHostOptions) {
    this.outbox = new Outbox(opts.inject, opts.outbox);
  }

  /** A message from the page, with the URL (or origin) of the frame that sent it, as the WebView reports it. */
  async receive(data: unknown, fromUrl: string | undefined): Promise<void> {
    if (!isAppUrl(fromUrl, this.opts.appOrigin)) return;
    const page = this.page;
    const answer = await route(data, this.opts.handlers);
    if (answer && page === this.page) this.outbox.push(answer);
  }

  emit<E extends NativeEventName>(event: E, data: NativeEventData[E]): void {
    this.outbox.push(nativeEvent(event, data));
  }

  /** A new document is loading in the WebView: forget everything sent to, or owed to, the old one. */
  pageChanged(): void {
    this.page++;
    this.outbox.clear();
  }
}
