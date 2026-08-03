import {
  EndSensitivity,
  StartSensitivity,
  type RealtimeInputConfig,
} from "@google/genai";

/**
 * Shared Gemini Live endpointing policy. It must be present in both the
 * ephemeral-token constraints and the browser connect config; token-bound
 * sessions ignore client additions that are absent from the constraints.
 */
export const LIVE_REALTIME_INPUT_CONFIG: RealtimeInputConfig = {
  automaticActivityDetection: {
    disabled: false,
    // Catch quiet/short answers and retain the onset that server VAD needs to
    // distinguish names and clipped first syllables.
    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
    prefixPaddingMs: 200,
    // Google's recommended conversational range is 500-800ms. Low end
    // sensitivity plus a 500ms window balances natural pauses with a prompt
    // final transcription; local Silero still guards/resumes the UI endpoint.
    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
    silenceDurationMs: 500,
  },
};
