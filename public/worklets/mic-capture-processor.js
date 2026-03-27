/**
 * AudioWorkletProcessor that captures microphone PCM audio and posts
 * fixed-size 16kHz chunks to the main thread for streaming to Gemini Live API.
 *
 * Runs on the audio thread — no main-thread jank.
 *
 * Handles sample rate mismatch: if the AudioContext runs at a native rate
 * other than 16kHz (common on iOS Safari which ignores the sampleRate hint),
 * it downsamples to 16kHz using nearest-neighbour before posting.
 */
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const TARGET_RATE = 16000;
    const CHUNK_MS = 100;
    // `sampleRate` is a global in AudioWorkletGlobalScope — reflects the actual rate.
    this._ratio = sampleRate / TARGET_RATE;
    // How many native samples make up CHUNK_MS ms of audio at TARGET_RATE output.
    this._nativeChunkSize = Math.round(TARGET_RATE * (CHUNK_MS / 1000) * this._ratio);
    this._targetChunkSize = Math.round(TARGET_RATE * (CHUNK_MS / 1000)); // 1600
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    while (this._buffer.length >= this._nativeChunkSize) {
      const native = this._buffer.splice(0, this._nativeChunkSize);

      let chunk;
      if (this._ratio === 1) {
        // No resampling needed — fast path.
        chunk = new Float32Array(native);
      } else {
        // Downsample with linear interpolation for better speech clarity.
        // Nearest-neighbour at 3:1 (48→16kHz) discards 2/3 of samples;
        // linear interpolation blends between adjacent samples instead.
        chunk = new Float32Array(this._targetChunkSize);
        for (let i = 0; i < this._targetChunkSize; i++) {
          const srcIdx = i * this._ratio;
          const lo = Math.floor(srcIdx);
          const hi = Math.min(lo + 1, native.length - 1);
          const frac = srcIdx - lo;
          chunk[i] = native[lo] * (1 - frac) + native[hi] * frac;
        }
      }

      this.port.postMessage({ pcm: chunk }, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
