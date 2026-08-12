/* global AudioWorkletProcessor, registerProcessor */

/**
 * Audio worklet that hands microphone samples to the main thread in batches.
 *
 * Emitted verbatim — Vite neither transpiles nor type-checks this file, and an
 * AudioWorkletGlobalScope has neither the DOM nor dependable static-import
 * support. Keep it plain, import-free JavaScript inside the syntax every browser
 * that ships AudioWorklet already understands.
 *
 * All this does is buffer and post. Correlating a recording against the
 * reference chirp is thousands of operations per sample, and the audio thread has
 * a hard deadline every render quantum: anything heavy in `process` is dropped
 * audio, so the analysis belongs on the main thread and stays there.
 *
 * Two properties are load-bearing for the measurement that consumes this.
 *
 * The frame counter runs from the moment the graph is built and is never reset,
 * not even by disarming. It is the phone's audio clock, and every arrival is
 * timed against it — a counter that restarted per recording would leave the
 * separate recordings with no common time base at all.
 *
 * A render quantum the input supplied nothing for still advances the counter and
 * still contributes its frames, as silence. The audio clock moved whether or not
 * the device delivered, so skipping those frames would shift every later arrival
 * earlier by however many were missed.
 */

/** Frames per message — about 85 ms at 48 kHz, so a few messages per chirp. */
const BATCH_FRAMES = 4096;

class ChirpCaptureProcessor extends AudioWorkletProcessor {
  frames = 0;
  armed = false;
  batch = null;
  filled = 0;
  batchStart = 0;
  dropouts = 0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      const armed = Boolean(event.data && event.data.armed);
      if (armed === this.armed) return;
      if (armed) this.arm();
      else this.disarm();
    };
  }

  process(inputs, outputs) {
    // Taken from the output because a missing input has no length to read, and
    // the counter has to advance by the quantum either way.
    const quantum = outputs[0][0].length;
    if (this.armed) this.append(inputs[0] && inputs[0][0], quantum);
    this.frames += quantum;
    return true;
  }

  arm() {
    this.armed = true;
    this.dropouts = 0;
    this.batch = new Float32Array(BATCH_FRAMES);
    this.filled = 0;
    this.batchStart = this.frames;
  }

  disarm() {
    this.flush();
    this.armed = false;
    this.batch = null;
  }

  /** Copy one quantum into the batch, posting whenever the batch fills. */
  append(channel, quantum) {
    if (!channel) this.dropouts += 1;

    let written = 0;
    while (written < quantum) {
      const take = Math.min(this.batch.length - this.filled, quantum - written);
      if (channel)
        this.batch.set(channel.subarray(written, written + take), this.filled);
      else this.batch.fill(0, this.filled, this.filled + take);

      this.filled += take;
      written += take;
      if (this.filled === this.batch.length) this.flush();
    }
  }

  flush() {
    if (!this.batch || this.filled === 0) return;

    const samples =
      this.filled === this.batch.length
        ? this.batch
        : this.batch.slice(0, this.filled);
    this.port.postMessage(
      {
        startFrame: this.batchStart,
        dropouts: this.dropouts,
        samples,
      },
      [samples.buffer],
    );

    this.batchStart += this.filled;
    this.filled = 0;
    // The posted buffer was transferred away, so it cannot be reused.
    this.batch = new Float32Array(BATCH_FRAMES);
  }
}

registerProcessor("sendspin-chirp-capture", ChirpCaptureProcessor);
