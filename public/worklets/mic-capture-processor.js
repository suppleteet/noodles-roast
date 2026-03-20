/**
 * AudioWorkletProcessor that captures microphone PCM audio and posts
 * fixed-size chunks to the main thread for streaming to Gemini Live API.
 *
 * Runs on the audio thread — no main-thread jank.
 */
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    // 1600 samples = 100ms at 16kHz
    this._chunkSize = 1600;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    while (this._buffer.length >= this._chunkSize) {
      const chunk = new Float32Array(this._buffer.splice(0, this._chunkSize));
      this.port.postMessage({ pcm: chunk }, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
