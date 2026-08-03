/**
 * PCM audio format conversion utilities for Gemini Live API.
 *
 * Gemini Live expects:
 *   Input:  raw 16-bit PCM, 16kHz, little-endian, base64-encoded
 *   Output: raw 16-bit PCM, 24kHz, little-endian, base64-encoded
 */

/** Convert Float32Array (-1..1) to base64-encoded Int16 PCM bytes. */
export function float32ToBase64Pcm16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface MicrophoneLevelResult {
  pcm: Float32Array;
  rawRms: number;
  outputRms: number;
  peak: number;
  gain: number;
}

interface MicrophoneLevelOptions {
  previousGain?: number;
  targetRms?: number;
  maxGain?: number;
  peakLimit?: number;
}

/** Raise quiet speech without hard-clipping nearby speakers. */
export function levelMicrophonePcm(
  input: Float32Array,
  options: MicrophoneLevelOptions = {},
): MicrophoneLevelResult {
  const targetRms = options.targetRms ?? 0.08;
  const maxGain = options.maxGain ?? 5;
  const peakLimit = options.peakLimit ?? 0.95;
  let sumSquares = 0;
  let rawPeak = 0;
  for (let i = 0; i < input.length; i++) {
    const sample = input[i];
    sumSquares += sample * sample;
    rawPeak = Math.max(rawPeak, Math.abs(sample));
  }
  const rawRms = input.length > 0 ? Math.sqrt(sumSquares / input.length) : 0;
  const previousGain = Math.max(1, Math.min(maxGain, options.previousGain ?? maxGain));
  // Hold the last speech gain through digital silence / the residual room
  // floor so a quiet speaker's first syllable is not under-amplified.
  const desiredGain = rawRms >= 0.002
    ? Math.min(maxGain, Math.max(1, targetRms / rawRms))
    : previousGain;
  // Back gain off quickly for a close speaker; raise it slowly so room noise
  // cannot pump the level between adjacent 100 ms chunks.
  const smoothedGain = desiredGain < previousGain
    ? previousGain * 0.2 + desiredGain * 0.8
    : previousGain * 0.7 + desiredGain * 0.3;
  const peakSafeGain = rawPeak > 0 ? peakLimit / rawPeak : maxGain;
  const gain = Math.max(0, Math.min(maxGain, smoothedGain, peakSafeGain));

  const pcm = new Float32Array(input.length);
  let outputSquares = 0;
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    const sample = input[i] * gain;
    pcm[i] = sample;
    outputSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  return {
    pcm,
    rawRms,
    outputRms: input.length > 0 ? Math.sqrt(outputSquares / input.length) : 0,
    peak,
    gain,
  };
}

/** Convert base64-encoded Int16 PCM to Float32Array (-1..1). */
export function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/** Convert base64-encoded Int16 PCM to an AudioBuffer at the given sample rate. */
export function pcmToAudioBuffer(
  ctx: AudioContext,
  base64: string,
  sampleRate: number,
): AudioBuffer {
  const float32 = base64Pcm16ToFloat32(base64);
  const buffer = ctx.createBuffer(1, float32.length, sampleRate);
  buffer.getChannelData(0).set(float32);
  return buffer;
}
