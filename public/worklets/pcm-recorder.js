/**
 * AudioWorklet: converts mic Float32 frames (AudioContext runs at 16 kHz) into
 * 16-bit PCM chunks of ~40 ms, and reports RMS level for the UI meter and
 * client-side end-of-speech timing.
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(640); // 40 ms @ 16 kHz
    this.offset = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this.sumSquares += s * s;
      this.chunk[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.offset === this.chunk.length) {
        const rms = Math.sqrt(this.sumSquares / this.chunk.length);
        this.port.postMessage({ pcm: this.chunk.buffer, rms }, [this.chunk.buffer]);
        this.chunk = new Int16Array(640);
        this.offset = 0;
        this.sumSquares = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
