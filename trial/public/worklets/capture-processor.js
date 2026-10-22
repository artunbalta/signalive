/*
 * Capture worklet. Downmixes the microphone to mono and posts it to the main
 * thread in fixed size chunks at the context's sample rate. It does nothing
 * else on purpose: resampling, voice detection and analysis happen on the
 * main thread, where they can be tested and swapped.
 *
 * Plain JavaScript because AudioWorklet modules are loaded by URL, outside
 * the bundler.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunk = opts.chunkSize || 1024;
    this.buf = new Float32Array(this.chunk);
    this.fill = 0;
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data === "stop") this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channels = input.length;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let s = input[0][i];
      if (channels > 1) {
        for (let c = 1; c < channels; c++) s += input[c][i];
        s /= channels;
      }
      this.buf[this.fill++] = s;
      if (this.fill === this.chunk) {
        // Transfer, then start a fresh buffer: the transferred one is gone.
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(this.chunk);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("signalive-capture", CaptureProcessor);
