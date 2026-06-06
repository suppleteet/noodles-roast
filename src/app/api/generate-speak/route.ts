import { NextRequest } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { getJokePrompt } from "@/lib/prompts";
import { getToastieBasePrompt, getToastieContextInstructions } from "@/lib/toastiePrompts";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import type { BurnIntensity } from "@/lib/prompts";
import type { JokeContext, JokeResponse } from "@/app/api/generate-joke/route";
import { getSession, getContextInstructions, sendMessageStream, compactStableContext } from "@/lib/chatSessionStore";
import { generateTextStream, QuotaError, type UserPart } from "@/lib/llmClient";
import { trimObservations } from "@/lib/visionDiff";
import { createStreamingJokeParser } from "@/lib/partialJokeParser";
import { openElTtsStream, type ElTtsStreamController } from "@/lib/elTtsStream";
import { voiceSettingsForMotion } from "@/lib/voiceMotionPresets";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "@/store/useSessionStore";
import type { MotionState } from "@/lib/motionStates";
import { recordTtsUsage } from "@/lib/usageTracker";
import { getElevenLabsModelId } from "@/lib/elTtsStream";
import { voiceIdForExperience } from "@/lib/constants";

type StreamEvent =
  | { type: "joke"; index?: number; text: string; motion: string; intensity: number; score: number }
  | { type: "joke-meta"; index: number; motion: string; intensity: number }
  | { type: "audio"; index: number; chunk: string }
  /** Fired when ElevenLabs has finished producing audio for a given joke
   *  index — the brain uses this to close the per-joke audio buffer so the
   *  playback chain can advance. */
  | { type: "audio-end"; index: number }
  | {
      type: "meta";
      relevant: boolean;
      redirect?: string;
      tags?: string[];
      callback?: { text: string; motion: string; intensity: number };
    }
  | { type: "done" };

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface GenerateSpeakRequest {
  context: JokeContext;
  sessionId?: string;
  model?: string;
  persona?: PersonaId;
  burnIntensity?: BurnIntensity;
  contentMode?: "clean" | "vulgar";
  /** "roast" (default) routes through persona prompts; "toastie" uses the
   *  drunk-toaster character prompt set. */
  experienceType?: "roast" | "toastie";
  question?: string;
  userAnswer?: string;
  fillerAlreadySaid?: string;
  jokesAlreadyDelivered?: string[];
  observations?: string[];
  previousObservations?: string[];
  conversationSoFar?: string[];
  knownFacts?: string[];
  maxJokes?: number;
  imageBase64?: string;
  setting?: string | null;
  ambientContext?: {
    city: string;
    region: string;
    timeOfDay: string;
    localTime: string;
    weather?: string;
    tempF?: number;
    tempC?: number;
  };
  ambientAntiRepeatNote?: string;
  townFlavor?: string;
  /** Enable streaming TTS: server opens EL WS and pipes audio back as SSE events. */
  streamingTts?: boolean;
  /** Base voice settings (used when streamingTts=true). Falls back to defaults. */
  baseVoiceSettings?: Partial<VoiceSettings>;
}

/** Build user message parts from the request body. */
function buildUserParts(
  body: GenerateSpeakRequest,
  taskPreamble?: string,
): UserPart[] {
  const parts: UserPart[] = [];
  const contextLines: string[] = [];

  if (taskPreamble) contextLines.push(taskPreamble);
  if (body.question) contextLines.push(`QUESTION ASKED: "${body.question}"`);
  if (body.userAnswer) contextLines.push(`USER'S ANSWER: "${body.userAnswer}"`);
  if (body.fillerAlreadySaid) {
    contextLines.push(
      `FILLER_ALREADY_SAID: "${body.fillerAlreadySaid}" — do NOT open by repeating that filler, the user's answer, or the same first phrase. Start with the roast angle, consequence, or comparison instead.`,
    );
  }
  if (body.jokesAlreadyDelivered?.length)
    contextLines.push(`JOKES ALREADY DELIVERED THIS CYCLE:\n${body.jokesAlreadyDelivered.map((j, i) => `${i + 1}. "${j}"`).join("\n")}`);
  if (body.observations?.length)
    contextLines.push(`CURRENT OBSERVATIONS: ${trimObservations(body.observations, body.setting).join("; ")}`);
  if (body.setting)
    contextLines.push(`SETTING: The person appears to be in their ${body.setting}.`);
  if (body.previousObservations?.length)
    contextLines.push(`PREVIOUS OBSERVATIONS: ${body.previousObservations.join("; ")}`);
  if (body.conversationSoFar?.length)
    contextLines.push(`CONVERSATION SO FAR:\n${body.conversationSoFar.slice(-6).join("\n")}`);
  if (body.knownFacts?.length)
    contextLines.push(`KNOWN FACTS: ${body.knownFacts.join(", ")}`);
  if (body.townFlavor?.trim()) {
    contextLines.push(
      `LOCAL PLACE VIBE (background texture only — do NOT lean on this): ${body.townFlavor.trim()}\nUSE IT SPARINGLY: name the town/location in AT MOST one joke, and NOT in back-to-back jokes. Most jokes should not mention the location at all — roast the person and their answers first. If you've already nodded to the place once this session, skip it.`,
    );
  }
  if (body.ambientAntiRepeatNote) {
    contextLines.push(body.ambientAntiRepeatNote);
  } else if (body.ambientContext) {
    const ac = body.ambientContext;
    const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
    contextLines.push(`AMBIENT (use sparingly): They're in ${ac.city} on a ${dayName} ${ac.timeOfDay}.${ac.weather ? ` Weather: ${ac.weather}.` : ""} NEVER say the exact time or location details.`);
  }
  if (body.maxJokes)
    contextLines.push(`Generate exactly ${body.maxJokes} joke(s).`);

  parts.push({ text: contextLines.length > 0 ? contextLines.join("\n\n") : "Generate jokes." });

  if (body.imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: body.imageBase64 } });
  }

  return parts;
}

export async function POST(req: NextRequest) {
  let body: GenerateSpeakRequest;
  try {
    body = (await req.json()) as GenerateSpeakRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const model = body.model ?? ROAST_MODEL;
  const encoder = new TextEncoder();

  // Try to use an existing chat session (multi-turn — persona already loaded)
  const session = body.sessionId ? getSession(body.sessionId) : null;

  // Strip stable blocks (townFlavor, setting, ambient, conversationSoFar) the
  // session has already seen, so per-turn prompts stay compact and Gemini's
  // implicit prefix cache keeps hitting.
  if (session && body.sessionId) compactStableContext(body.sessionId, body);

  const baseVoice: VoiceSettings = {
    ...DEFAULT_VOICE_SETTINGS,
    ...(body.baseVoiceSettings ?? {}),
  };
  const useStreamingTts = body.streamingTts === true;
  // Experience: session value wins (locked in at createSession), body value
  // is the fallback. Default "roast". Available throughout the request handler.
  const experienceType =
    session?.experienceType ??
    (body.experienceType === "toastie" ? "toastie" : "roast");

  const stream = new ReadableStream({
    async start(controller) {
      let accumulated = "";
      const parser = createStreamingJokeParser();
      /** EL WS controller per joke index. */
      const ttsControllers: Map<number, ElTtsStreamController> = new Map();
      /** Promises that resolve when each EL WS reports done/error. */
      const ttsDonePromises: Promise<void>[] = [];
      /** Characters sent to EL per joke (for usage tracking). */
      const ttsCharCount: Map<number, number> = new Map();
      const elModelId = useStreamingTts ? getElevenLabsModelId() : "";

      const safeEnqueue = (ev: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(ev)));
        } catch {
          // controller closed — ignore
        }
      };

      /** Hard ceiling per EL WS stream — if neither onDone nor onError fires within this
       *  window, force-close so the SSE response isn't pinned open by a stuck connection.
       *  30s is long enough for a normal 20-word joke (~3-5s of audio) plus tail; well
       *  past anything a real stream should take. */
      const EL_STREAM_TIMEOUT_MS = 30_000;

      const openTtsForJoke = (index: number, motion: string, intensity: number) => {
        if (!useStreamingTts) return;
        const motionState = motion as MotionState;
        const mergedVoice = voiceSettingsForMotion(baseVoice, motionState, intensity);
        let resolveDone: () => void = () => {};
        let settled = false;
        const done = new Promise<void>((res) => {
          resolveDone = res;
        });
        ttsDonePromises.push(done);

        /** Single-shot finalize used by onDone, onError, and the watchdog so a hang on
         *  any side still drains the per-joke audio buffer in the client and unblocks
         *  the outer Promise.all. */
        const finalize = (reason: "done" | "error" | "timeout") => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          if (reason === "done") {
            const chars = ttsCharCount.get(index) ?? 0;
            if (chars > 0) {
              recordTtsUsage({
                route: "generate-speak-stream",
                model: elModelId,
                characters: chars,
              });
            }
          }
          if (reason === "timeout") {
            console.warn(`[generate-speak] EL WS timed out (index=${index}); forcing audio-end`);
            try {
              ttsControllers.get(index)?.close();
            } catch {
              // ignore — close is best-effort
            }
          }
          // Tell the brain it can close the per-joke audio buffer — all
          // chunks for this joke have been delivered (or we gave up).
          safeEnqueue({ type: "audio-end", index });
          resolveDone();
        };

        const watchdog = setTimeout(() => finalize("timeout"), EL_STREAM_TIMEOUT_MS);

        const ctl = openElTtsStream({
          voiceSettings: mergedVoice,
          voiceId: voiceIdForExperience(experienceType),
          onAudioChunk: (b64) => {
            safeEnqueue({ type: "audio", index, chunk: b64 });
          },
          onDone: () => finalize("done"),
          onError: (err) => {
            console.error("[generate-speak] EL WS error:", err);
            finalize("error");
          },
        });
        ttsControllers.set(index, ctl);
      };

      const sendTtsDelta = (index: number, delta: string) => {
        if (!useStreamingTts) return;
        const ctl = ttsControllers.get(index);
        if (!ctl) return;
        ctl.sendText(delta);
        ttsCharCount.set(index, (ttsCharCount.get(index) ?? 0) + delta.length);
      };

      const endTtsForJoke = (index: number) => {
        if (!useStreamingTts) return;
        const ctl = ttsControllers.get(index);
        if (!ctl) return;
        ctl.end();
      };

      try {
        let textStream: AsyncIterable<string>;

        // experienceType is resolved once at request start (above). Used here
        // by getContextInstructions and the stateless system-prompt fallback.

        if (session) {
          // ── Multi-turn path: persona is in the session's system prompt ──
          const taskPreamble = getContextInstructions(
            body.context ?? "answer_roast",
            session.contentMode,
            session.experienceType,
          );
          const userParts = buildUserParts(body, taskPreamble);
          textStream = sendMessageStream(body.sessionId!, userParts);
        } else {
          // ── Stateless fallback: full system prompt on every request ──
          const personaId: PersonaId = PERSONA_IDS.includes(body.persona as PersonaId)
            ? (body.persona as PersonaId)
            : DEFAULT_PERSONA;
          const burnIntensity: BurnIntensity = ([1, 2, 3, 4, 5] as const).includes(
            body.burnIntensity as BurnIntensity,
          )
            ? (body.burnIntensity as BurnIntensity)
            : 3;
          const contentMode = body.contentMode === "vulgar" ? "vulgar" : "clean";
          const systemPrompt =
            experienceType === "toastie"
              ? `${getToastieBasePrompt(burnIntensity, contentMode)}\n\n${getToastieContextInstructions(
                  body.context ?? "answer_roast",
                  contentMode,
                )}`
              : getJokePrompt(body.context ?? "answer_roast", personaId, burnIntensity, contentMode);
          const userParts = buildUserParts(body);

          textStream = generateTextStream({
            model,
            systemPrompt,
            userParts,
            forceJsonObject: true,
          });
        }

        for await (const chunkText of textStream) {
          if (!chunkText) continue;
          accumulated += chunkText;

          for (const ev of parser.feed(chunkText)) {
            if (ev.type === "joke-start") {
              if (useStreamingTts) {
                openTtsForJoke(ev.index, ev.motion, ev.intensity);
                safeEnqueue({
                  type: "joke-meta",
                  index: ev.index,
                  motion: ev.motion,
                  intensity: ev.intensity,
                });
              }
            } else if (ev.type === "joke-text-delta") {
              sendTtsDelta(ev.index, ev.delta);
            } else if (ev.type === "joke-end") {
              endTtsForJoke(ev.index);
              safeEnqueue({
                type: "joke",
                index: ev.index,
                text: ev.text,
                motion: ev.motion,
                intensity: ev.intensity,
                score: ev.score,
              });
            }
          }
        }

        // Flush any pending events from the parser at end-of-stream.
        for (const ev of parser.finish()) {
          if (ev.type === "joke-start") {
            if (useStreamingTts) {
              openTtsForJoke(ev.index, ev.motion, ev.intensity);
              safeEnqueue({
                type: "joke-meta",
                index: ev.index,
                motion: ev.motion,
                intensity: ev.intensity,
              });
            }
          } else if (ev.type === "joke-text-delta") {
            sendTtsDelta(ev.index, ev.delta);
          } else if (ev.type === "joke-end") {
            endTtsForJoke(ev.index);
            safeEnqueue({
              type: "joke",
              index: ev.index,
              text: ev.text,
              motion: ev.motion,
              intensity: ev.intensity,
              score: ev.score,
            });
          }
        }

        // Parse full response for meta fields (followUp/redirect/callback/tags).
        const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const full = JSON.parse(jsonMatch[0]) as JokeResponse;
            safeEnqueue({
              type: "meta",
              relevant: full.relevant ?? true,
              redirect: full.redirect,
              tags: full.tags,
              callback: full.callback,
            });
          } catch {
            safeEnqueue({ type: "meta", relevant: true });
          }
        } else {
          safeEnqueue({ type: "meta", relevant: true });
        }
      } catch (e) {
        if (e instanceof QuotaError) {
          console.error("[generate-speak] QUOTA:", e.message);
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", error: "quota_exceeded", provider: e.provider, detail: e.message })}\n\n`,
              ),
            );
          } catch {
            // ignore
          }
        } else {
          console.error("[generate-speak]", e);
          safeEnqueue({ type: "meta", relevant: true });
        }
      }

      // Wait for all EL WS streams to finish producing audio so we don't
      // close the SSE before the last audio chunks arrive.
      if (useStreamingTts && ttsDonePromises.length > 0) {
        try {
          await Promise.all(ttsDonePromises);
        } catch {
          // ignore — individual onError already logged
        }
      }

      safeEnqueue({ type: "done" });
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
