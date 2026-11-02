import "server-only";

/**
 * Streams pipeline events to the browser as newline delimited JSON. Reading
 * the response drives the pipeline; a browser that goes away aborts it.
 */
export function ndjsonResponse<E extends { t: string }>(
  events: AsyncGenerator<E>,
  controller: AbortController,
  onEvent?: (e: E) => void,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await events.next();
        if (done) return ctrl.close();
        onEvent?.(value);
        ctrl.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch {
        ctrl.enqueue(encoder.encode(`${JSON.stringify({ t: "error", code: "server_error" })}\n`));
        ctrl.close();
      }
    },
    cancel() {
      controller.abort();
      void events.return(undefined);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
