import { create } from "zustand";
import type { MotionState } from "@/lib/stateMachine";
import type { BurnIntensity } from "@/lib/prompts";
import { DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import type { BrainState } from "@/lib/stateMachine";
import {
  transition,
  SESSION_TRANSITIONS,
  type SessionPhase,
  type SessionTrigger,
} from "@/lib/stateMachine";

export type ContentMode = "clean" | "vulgar";

/**
 * Conversation flow style. "original" = current behavior (LLM-personalized
 * bank questions, vision_react interrupts, single-joke-per-cycle delivery).
 * "rapid_fire" = short Q&As with binary/short-answer questions, jokes fired
 * as 2-joke bursts about the gathered info, no vision_react interrupts.
 * Dev-only toggle for now — production users always get "original".
 */
export type FlowMode = "original" | "rapid_fire";

/**
 * Top-level experience the user picks on the landing screen — two side-by-side
 * buttons, "Roast Me" (orange) vs "Toast Me" (champagne). Toast is a parallel
 * experience to the standard roast: a drunk woman at a wedding mic giving a
 * toast to the user, who she's pretending she knows. Same brain state machine,
 * different question bank, prompts, scripted lines, voice, and puppet palette.
 *
 * In "toast": persona is ignored (one character), flowMode is ignored
 * (single flow — no Rapid Fire variant).
 */
export type ExperienceType = "roast" | "toast";

export type RoastModelId =
  | "gemini-3.5-flash"
  | "gemini-2.5-flash"
  | "gemini-3.1-flash-lite"
  | "gpt-4o"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

/**
 * Surfaced when a Gemini model returns 503 UNAVAILABLE ("high demand").
 * UI shows a prompt offering to swap to a healthy fallback and restart.
 */
export interface ModelUnavailableInfo {
  failedModel: string;
  suggestedFallback: string;
}

export interface VoiceSettings {
  stability: number;        // 0-1
  similarity_boost: number; // 0-1
  style: number;            // 0-1
  speed: number;            // 0.7-1.2 (turbo v2.5)
  use_speaker_boost: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.72,
  similarity_boost: 0.7,
  style: 1,
  speed: 1.0,
  use_speaker_boost: true,
};

/** Ambient context derived from geolocation — time-of-day, weather, city. */
export interface AmbientContext {
  city: string;
  region: string;
  timeOfDay: string; // "late night", "early morning", "morning", "afternoon", "evening", "night"
  localTime: string; // "2:30 AM", "11:15 PM" etc
  weather?: string;  // "clear skies", "raining", "overcast", etc
  tempF?: number;
  tempC?: number;
}

export type ConversationEventType = "user-start" | "user-end" | "ai-speech" | "ai-done" | "interrupted" | "listening" | "rotate" | "user-laugh";

export type TimelineRow = "user" | "gemini" | "tts" | "vision" | "session";

export const TIMELINE_ROW_COLORS: Record<TimelineRow, string> = {
  user: "#22d3ee",
  gemini: "#fb923c",
  tts: "#a78bfa",
  vision: "#60a5fa",
  session: "#94a3b8",
};

export interface TimelineSpan {
  id: string;
  row: TimelineRow;
  label: string;
  startTs: number;
  endTs: number | null;
  color: string;
}

export interface ConversationEvent {
  type: ConversationEventType;
  text?: string;
  ts: number;
}

// SessionPhase is now defined in @/lib/stateMachine/sessionPhase.ts
// Re-export for backwards compatibility
export type { SessionPhase } from "@/lib/stateMachine";

export type SessionMode = "monologue" | "conversation";

export interface RoastSentence {
  text: string;
  motion: MotionState;
  intensity: number;
}

interface SessionState {
  phase: SessionPhase;
  sessionMode: SessionMode;
  flowMode: FlowMode;
  experienceType: ExperienceType;
  burnIntensity: BurnIntensity;
  contentMode: ContentMode;
  roastModel: RoastModelId;
  /** Gemini model used for vision + greeting prefetch. Swapped together with
   *  roastModel when the fallback prompt is accepted, since both default to
   *  the same Gemini Flash tier. */
  visionModel: string;
  /** Non-null when a Gemini model returned 503 UNAVAILABLE. UI shows the
   *  fallback prompt; user accepts → swap models + restart session. */
  modelUnavailable: ModelUnavailableInfo | null;
  activePersona: PersonaId;
  isSpeaking: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  transcript: string;
  audioAmplitude: number; // 0-1 RMS from AnalyserNode
  activeMotionState: MotionState;
  motionIntensity: number; // 0-1
  lastSceneJson: string | null;
  recordedBlob: Blob | null;
  error: string | null;
  timingLog: string[];
  /** Legible LLM call/response log for the debug panel — "→" is what we asked the model,
   *  "←" is what came back (plain text, never JSON). */
  llmLog: { ts: number; dir: "→" | "←"; label: string; text: string }[];
  observations: string[];
  visionSetting: string | null; // best guess at user's location from background analysis
  locationConsent: boolean; // user opted in to share location
  ambientContext: AmbientContext | null; // time-of-day, weather, city from geolocation
  /** LLM blurbs local vibe/culture for roast fodder — filled async after geo resolves. */
  townFlavorBlurb: string | null;
  townFlavorRequested: boolean;
  conversationEvents: ConversationEvent[];
  timeToFirstSpeechMs: number | null;
  hasSpokenThisSession: boolean;
  puppetRevealed: boolean; // true once the first TTS audio chunk starts
  isEnding: boolean; // true while session is fading out — switches the puppet overlay to a fast fade-out duration
  lastVisionCallTs: number | null;

  // Comedian Brain state (conversation mode)
  brainState: BrainState | null;
  currentQuestion: string | null;
  userAnswer: string;
  voiceSettings: VoiceSettings;
  isUserLaughing: boolean; // vision-based: set when observations contain laugh keywords
  isUserSmiling: boolean;  // vision-based: set when observations contain smile keywords
  laughCount: number;       // total laugh detections this session
  smileFrames: number;      // vision frames where smile was detected
  totalVisionFrames: number; // total vision frames this session

  // Transcript history for debug panel.
  // groupId clusters jokes from the same delivery batch — UI renders them as one
  // paragraph while keeping per-joke ratings.
  transcriptHistory: { role: "user" | "puppet"; text: string; ts: number; groupId: string }[];
  jokeRatings: Record<number, "up" | "down">; // keyed by transcript entry ts

  // Session timer — set when phase enters "roasting"
  sessionStartTs: number | null;
  setSessionStartTs: (ts: number | null) => void;

  // Debug: type a response instead of speaking (consumed by LiveSessionController)
  pendingDebugTranscription: string | null;
  submitDebugTranscription: (text: string) => void;
  clearPendingDebugTranscription: () => void;

  // Dev voice notes: gesture-triggered recording
  pendingDevNoteResume: boolean;
  requestDevNoteResume: () => void;
  clearPendingDevNoteResume: () => void;
  devNoteCount: number;
  incrementDevNoteCount: () => void;

  // actions
  setPhase: (phase: SessionPhase, trigger: SessionTrigger) => void;
  setSessionMode: (mode: SessionMode) => void;
  setFlowMode: (mode: FlowMode) => void;
  setExperienceType: (type: ExperienceType) => void;
  setBurnIntensity: (intensity: BurnIntensity) => void;
  setContentMode: (mode: ContentMode) => void;
  setRoastModel: (model: RoastModelId) => void;
  setVisionModel: (model: string) => void;
  setModelUnavailable: (info: ModelUnavailableInfo | null) => void;
  /** Apply the suggested fallback to both roastModel and visionModel, then
   *  clear modelUnavailable. UI calls setPhase("idle") after to drop the
   *  user back to the landing screen for a clean restart. */
  acceptModelFallback: () => void;
  setActivePersona: (persona: PersonaId) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setIsUserSpeaking: (speaking: boolean) => void;
  setTranscript: (text: string) => void;
  setAudioAmplitude: (amplitude: number) => void;
  setActiveMotionState: (state: MotionState, intensity: number) => void;
  setLastSceneJson: (json: string) => void;
  setRecordedBlob: (blob: Blob) => void;
  setError: (error: string | null) => void;
  logTiming: (entry: string) => void;
  clearTimingLog: () => void;
  pushLlmLog: (dir: "→" | "←", label: string, text: string) => void;
  clearLlmLog: () => void;
  setObservations: (obs: string[]) => void;
  setVisionSetting: (setting: string | null) => void;
  setLocationConsent: (consent: boolean) => void;
  setAmbientContext: (ctx: AmbientContext | null) => void;
  setTownFlavorBlurb: (text: string | null) => void;
  setTownFlavorRequested: (requested: boolean) => void;
  addConversationEvent: (type: ConversationEvent["type"], text?: string) => void;
  clearConversationEvents: () => void;
  setTimeToFirstSpeechMs: (ms: number | null) => void;
  setHasSpokenThisSession: (spoken: boolean) => void;
  setPuppetRevealed: (revealed: boolean) => void;
  setIsEnding: (isEnding: boolean) => void;
  setLastVisionCallTs: (ts: number | null) => void;
  setBrainState: (state: BrainState | null) => void;
  setCurrentQuestion: (q: string | null) => void;
  setUserAnswer: (ans: string) => void;
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void;
  setIsUserLaughing: (laughing: boolean) => void;
  setIsUserSmiling: (smiling: boolean) => void;
  incrementLaughCount: () => void;
  recordVisionFrame: (smiling: boolean) => void;
  pushTranscriptEntry: (role: "user" | "puppet", text: string, opts?: { append?: boolean }) => void;
  timelineSpans: TimelineSpan[];
  beginSpan: (row: TimelineRow, label: string, color?: string) => string;
  endSpan: (id: string) => void;
  clearTimelineSpans: () => void;
  rateJoke: (ts: number, rating: "up" | "down") => void;
  clearTranscriptHistory: () => void;
  reset: () => void;
}

const initialState = {
  phase: "idle" as SessionPhase,
  sessionMode: "conversation" as SessionMode,
  flowMode: "original" as FlowMode,
  experienceType: "roast" as ExperienceType,
  burnIntensity: 5 as BurnIntensity,
  contentMode: "clean" as ContentMode,
  roastModel: "gemini-3.5-flash" as RoastModelId,
  visionModel: "gemini-3.5-flash",
  modelUnavailable: null as ModelUnavailableInfo | null,
  activePersona: DEFAULT_PERSONA,
  isSpeaking: false,
  isListening: false,
  isUserSpeaking: false,
  transcript: "",
  audioAmplitude: 0,
  activeMotionState: "idle" as MotionState,
  motionIntensity: 0.3,
  lastSceneJson: null,
  recordedBlob: null,
  error: null,
  timingLog: [] as string[],
  llmLog: [] as { ts: number; dir: "→" | "←"; label: string; text: string }[],
  observations: [] as string[],
  visionSetting: null as string | null,
  locationConsent: true,
  ambientContext: null as AmbientContext | null,
  townFlavorBlurb: null as string | null,
  townFlavorRequested: false,
  conversationEvents: [] as ConversationEvent[],
  timeToFirstSpeechMs: null as number | null,
  hasSpokenThisSession: false,
  puppetRevealed: false,
  isEnding: false,
  lastVisionCallTs: null as number | null,
  brainState: null as BrainState | null,
  currentQuestion: null as string | null,
  userAnswer: "",
  voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
  isUserLaughing: false,
  isUserSmiling: false,
  laughCount: 0,
  smileFrames: 0,
  totalVisionFrames: 0,
  transcriptHistory: [] as { role: "user" | "puppet"; text: string; ts: number; groupId: string }[],
  jokeRatings: {} as Record<number, "up" | "down">,
  timelineSpans: [] as TimelineSpan[],
  sessionStartTs: null as number | null,
  pendingDebugTranscription: null as string | null,
  pendingDevNoteResume: false,
  devNoteCount: 0,
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setPhase: (phase, trigger) => {
    const current = useSessionStore.getState().phase;
    const event = transition(current, phase, SESSION_TRANSITIONS, trigger);
    if (!event) return;
    set({ phase });
  },
  setSessionMode: (sessionMode) => set({ sessionMode }),
  setFlowMode: (flowMode) => set({ flowMode }),
  setExperienceType: (experienceType) => set({ experienceType }),
  setBurnIntensity: (burnIntensity) => set({ burnIntensity }),
  setContentMode: (contentMode) => set({ contentMode }),
  setRoastModel: (roastModel) => set({ roastModel }),
  setVisionModel: (visionModel) => set({ visionModel }),
  setModelUnavailable: (modelUnavailable) => set({ modelUnavailable }),
  acceptModelFallback: () => set((s) => {
    const info = s.modelUnavailable;
    if (!info) return {};
    const fallback = info.suggestedFallback;
    return {
      modelUnavailable: null,
      roastModel: fallback as RoastModelId,
      visionModel: fallback,
    };
  }),
  setActivePersona: (activePersona) => set({ activePersona }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  setIsListening: (isListening) => set({ isListening }),
  setIsUserSpeaking: (isUserSpeaking) => set({ isUserSpeaking }),
  setTranscript: (transcript) => set({ transcript }),
  setAudioAmplitude: (audioAmplitude) => set({ audioAmplitude }),
  setActiveMotionState: (activeMotionState, motionIntensity) =>
    set({ activeMotionState, motionIntensity }),
  setLastSceneJson: (lastSceneJson) => set({ lastSceneJson }),
  setRecordedBlob: (recordedBlob) => set({ recordedBlob }),
  setError: (error) => set({ error }),
  logTiming: (entry) =>
    set((s) => {
      const rel = s.sessionStartTs !== null
        ? `+${((Date.now() - s.sessionStartTs) / 1000).toFixed(2)}s`
        : "--";
      const line = `${rel} ${entry}`;
      const next = [...s.timingLog.slice(-499), line];
      try { localStorage.setItem("roastie-timing-log", JSON.stringify(next)); } catch { /* ignore */ }
      return { timingLog: next };
    }),
  clearTimingLog: () => set({ timingLog: [] }),
  pushLlmLog: (dir, label, text) =>
    set((s) => ({
      llmLog: [...s.llmLog.slice(-299), { ts: Date.now(), dir, label, text: text.trim() }],
    })),
  clearLlmLog: () => set({ llmLog: [] }),
  setObservations: (observations) => set({ observations }),
  setVisionSetting: (visionSetting) => set({ visionSetting }),
  setLocationConsent: (locationConsent) => set({ locationConsent }),
  setAmbientContext: (ambientContext) => set({ ambientContext }),
  setTownFlavorBlurb: (townFlavorBlurb) => set({ townFlavorBlurb }),
  setTownFlavorRequested: (townFlavorRequested) => set({ townFlavorRequested }),
  addConversationEvent: (type, text) =>
    set((s) => ({
      conversationEvents: [
        ...s.conversationEvents.slice(-29),
        { type, text, ts: Date.now() },
      ],
    })),
  clearConversationEvents: () => set({ conversationEvents: [] }),
  setTimeToFirstSpeechMs: (timeToFirstSpeechMs) => set({ timeToFirstSpeechMs }),
  setHasSpokenThisSession: (hasSpokenThisSession) => set({ hasSpokenThisSession }),
  setPuppetRevealed: (puppetRevealed) => set({ puppetRevealed }),
  setIsEnding: (isEnding) => set({ isEnding }),
  setLastVisionCallTs: (lastVisionCallTs) => set({ lastVisionCallTs }),
  setBrainState: (brainState) => set({ brainState }),
  setCurrentQuestion: (currentQuestion) => set({ currentQuestion }),
  setUserAnswer: (userAnswer) => set({ userAnswer }),
  setVoiceSettings: (partial) => set((s) => ({ voiceSettings: { ...s.voiceSettings, ...partial } })),
  setIsUserLaughing: (isUserLaughing) => set({ isUserLaughing }),
  setIsUserSmiling: (isUserSmiling) => set({ isUserSmiling }),
  incrementLaughCount: () => set((s) => ({ laughCount: s.laughCount + 1 })),
  recordVisionFrame: (smiling) => set((s) => ({
    totalVisionFrames: s.totalVisionFrames + 1,
    smileFrames: s.smileFrames + (smiling ? 1 : 0),
  })),
  pushTranscriptEntry: (role, text, opts) =>
    set((s) => {
      const last = s.transcriptHistory[s.transcriptHistory.length - 1];
      const ts = Date.now();
      const groupId =
        opts?.append && last && last.role === role
          ? last.groupId
          : `g-${ts}-${Math.random().toString(36).slice(2, 8)}`;
      const next = [...s.transcriptHistory.slice(-199), { role, text, ts, groupId }];
      try { localStorage.setItem("roastie-transcript", JSON.stringify(next)); } catch { /* ignore */ }
      return { transcriptHistory: next };
    }),
  beginSpan: (row, label, color) => {
    const id = `${row}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      timelineSpans: [
        ...s.timelineSpans.slice(-299),
        { id, row, label, startTs: Date.now(), endTs: null, color: color ?? TIMELINE_ROW_COLORS[row] },
      ],
    }));
    return id;
  },
  endSpan: (id) =>
    set((s) => ({
      timelineSpans: s.timelineSpans.map((span) =>
        span.id === id ? { ...span, endTs: Date.now() } : span
      ),
    })),
  clearTimelineSpans: () => set({ timelineSpans: [] }),
  rateJoke: (ts, rating) => {
    set((s) => ({ jokeRatings: { ...s.jokeRatings, [ts]: rating } }));
    // Find the joke text for this timestamp
    const entry = useSessionStore.getState().transcriptHistory.find(
      (e) => e.ts === ts && e.role === "puppet"
    );
    if (!entry) return;
    // Fire-and-forget save to feedback log
    fetch("/api/save-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "joke-rating",
        text: `${rating === "up" ? "👍" : "👎"} ${entry.text}`,
        persona: useSessionStore.getState().activePersona,
        lastJokeText: entry.text,
      }),
    }).catch(() => {});
  },
  clearTranscriptHistory: () => set({ transcriptHistory: [], jokeRatings: {} }),
  setSessionStartTs: (sessionStartTs) => set({ sessionStartTs }),
  submitDebugTranscription: (text) => set({ pendingDebugTranscription: text }),
  clearPendingDebugTranscription: () => set({ pendingDebugTranscription: null }),
  requestDevNoteResume: () => set({ pendingDevNoteResume: true }),
  clearPendingDevNoteResume: () => set({ pendingDevNoteResume: false }),
  incrementDevNoteCount: () => set((s) => ({ devNoteCount: s.devNoteCount + 1 })),
  reset: () => set(initialState),
}));
