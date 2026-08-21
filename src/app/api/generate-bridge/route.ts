import { NextRequest } from "next/server";
import {
  getBridgeSystemPrompt,
  getSession,
  sendMessageStream,
  BRIDGE_MODEL,
} from "@/lib/chatSessionStore";
import { deterministicNameBridge, validateConversationBridge } from "@/lib/conversationBridge";
import { ApiRequestError, readLimitedJson } from "@/lib/apiRequest";
import { openElTtsStream, getElevenLabsModelId } from "@/lib/elTtsStream";
import { voiceIdForExperience } from "@/lib/constants";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "@/store/useSessionStore";
import { recordTtsUsage } from "@/lib/usageTracker";
import { generateTextStream } from "@/lib/llmClient";
import { DEFAULT_PERSONA, PERSONA_IDS, type PersonaId } from "@/lib/personas";

export interface GenerateBridgeRequest {
  turnId: string;
  bridgeSessionId: string;
  questionId?: string;
  question: string;
  answer: string;
  persona?: PersonaId;
  knownFacts?: string[];
  recentBridges?: string[];
  experienceType?: "roast" | "toast";
  previousText?: string;
  baseVoiceSettings?: Partial<VoiceSettings>;
}

export type BridgeStreamEvent =
  | {
      type: "bridge-meta";
      turnId: string;
      text: string;
      model: string;
      firstTokenMs: number;
      modelMs: number;
    }
  | { type: "audio"; turnId: string; chunk: string }
  | { type: "bridge"; turnId: string; text: string }
  | { type: "audio-end"; turnId: string; failed?: boolean }
  | { type: "error"; turnId: string; error: string }
  | { type: "done"; turnId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const strings = value.map((item) => boundedString(item, maxItemLength, true));
  return strings.every((item): item is string => item !== undefined) ? strings : undefined;
}

function safeVoiceSettings(value: unknown): Partial<VoiceSettings> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const result: Partial<VoiceSettings> = {};
  const ranges: Array<["stability" | "similarity_boost" | "style" | "speed", number, number]> = [
    ["stability", 0, 1],
    ["similarity_boost", 0, 1],
    ["style", 0, 1],
    ["speed", 0.7, 1.2],
  ];
  for (const [key, min, max] of ranges) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < min || candidate > max) {
      return undefined;
    }
    result[key] = candidate;
  }
  if (value.use_speaker_boost !== undefined) {
    if (typeof value.use_speaker_boost !== "boolean") return undefined;
    result.use_speaker_boost = value.use_speaker_boost;
  }
  return result;
}

function parseBridgeRequest(value: unknown): GenerateBridgeRequest | null {
  if (!isRecord(value)) return null;
  const turnId = boundedString(value.turnId, 128, true);
  const bridgeSessionId = boundedString(value.bridgeSessionId, 256, true);
  const questionId = boundedString(value.questionId, 100);
  const question = boundedString(value.question, 1_000, true);
  const answer = boundedString(value.answer, 2_000, true);
  if (!turnId || !bridgeSessionId || !question || !answer) return null;
  if (value.questionId !== undefined && questionId === undefined) return null;

  const knownFacts = boundedStringArray(value.knownFacts, 16, 500);
  const recentBridges = boundedStringArray(value.recentBridges, 8, 200);
  const baseVoiceSettings = safeVoiceSettings(value.baseVoiceSettings);
  if (
    (value.knownFacts !== undefined && knownFacts === undefined) ||
    (value.recentBridges !== undefined && recentBridges === undefined) ||
    (value.baseVoiceSettings !== undefined && baseVoiceSettings === undefined)
  ) return null;
  if (value.experienceType !== undefined && value.experienceType !== "roast" && value.experienceType !== "toast") {
    return null;
  }
  if (value.persona !== undefined && !PERSONA_IDS.includes(value.persona as PersonaId)) return null;
  const previousText = boundedString(value.previousText, 1_000);
  if (value.previousText !== undefined && previousText === undefined) return null;

  return {
    turnId,
    bridgeSessionId,
    ...(questionId ? { questionId } : {}),
    question,
    answer,
    ...(value.persona !== undefined ? { persona: value.persona as PersonaId } : {}),
    ...(knownFacts ? { knownFacts } : {}),
    ...(recentBridges ? { recentBridges } : {}),
    ...(value.experienceType ? { experienceType: value.experienceType as "roast" | "toast" } : {}),
    ...(previousText ? { previousText } : {}),
    ...(baseVoiceSettings ? { baseVoiceSettings } : {}),
  };
}

function sse(event: BridgeStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function buildBridgeTurn(body: GenerateBridgeRequest): string {
  const lines = [
    `QUESTION: ${body.question.trim() || "(none)"}`,
    `FINAL REPAIRED ANSWER: ${body.answer.trim()}`,
  ];
  if (body.knownFacts?.length) lines.push(`ESTABLISHED FACTS: ${body.knownFacts.slice(-8).join("; ")}`);
  if (body.recentBridges?.length) {
    lines.push(`RECENT BRIDGES TO AVOID REPEATING: ${body.recentBridges.slice(-4).join(" | ")}`);
  }
  lines.push("Return only the 2-to-9-word bridge phrase.");
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await readLimitedJson<unknown>(req, 60_000);
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400;
    return new Response("Invalid request", { status });
  }
  const body = parseBridgeRequest(rawBody);
  if (!body) return new Response("Invalid bridge request", { status: 400 });

  const session = getSession(body.bridgeSessionId);
  if (session && session.purpose !== "bridge") {
    return new Response("Wrong session purpose", { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let ttsController: ReturnType<typeof openElTtsStream> | null = null;
      const enqueue = (event: BridgeStreamEvent) => {
        if (closed) return;
        try { controller.enqueue(sse(event)); } catch { closed = true; }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* client disconnected */ }
      };

      try {
        const modelStartedAt = Date.now();
        let firstTokenMs: number | null = null;
        let generated = "";
        let bridge = body.questionId === "name"
          ? deterministicNameBridge(body.answer)
          : null;
        let bridgeModel = bridge ? "deterministic-name-echo" : (session?.model || BRIDGE_MODEL);

        // A failed name extraction is uncertainty, not permission to let an
        // LLM guess what the caller meant. Fail closed so the coordinator keeps
        // the already-playable neutral acknowledgement.
        if (body.questionId === "name" && !bridge) {
          enqueue({ type: "error", turnId: body.turnId, error: "invalid_bridge" });
          enqueue({ type: "done", turnId: body.turnId });
          return close();
        }

        if (!bridge) {
          const userParts = [{ text: buildBridgeTurn(body) }];
          const persona = PERSONA_IDS.includes(body.persona as PersonaId)
            ? (body.persona as PersonaId)
            : DEFAULT_PERSONA;
          const textStream = session
            ? sendMessageStream(body.bridgeSessionId, userParts, req.signal)
            : generateTextStream({
                model: BRIDGE_MODEL,
                systemPrompt: getBridgeSystemPrompt(
                  persona,
                  body.experienceType === "toast" ? "toast" : "roast",
                ),
                userParts,
                maxOutputTokens: 24,
                reasoningProfile: "realtime-utility",
                usageRoute: "generateBridge:stateless",
                signal: req.signal,
              });
          for await (const chunk of textStream) {
            if (req.signal.aborted) return close();
            if (firstTokenMs === null && chunk) firstTokenMs = Date.now() - modelStartedAt;
            generated += chunk;
          }
          if (req.signal.aborted) return close();
          bridge = validateConversationBridge(generated ?? "", {
            answer: body.answer,
            knownFacts: body.knownFacts,
          });
          bridgeModel = session?.model || BRIDGE_MODEL;
        }
        if (!bridge) {
          console.warn(
            `[generate-bridge] rejected candidate model=${session?.model ?? BRIDGE_MODEL} text=${JSON.stringify(generated.slice(0, 160))}`,
          );
          enqueue({ type: "error", turnId: body.turnId, error: "invalid_bridge" });
          enqueue({ type: "done", turnId: body.turnId });
          return close();
        }

        const modelMs = Date.now() - modelStartedAt;
        enqueue({
          type: "bridge-meta",
          turnId: body.turnId,
          text: bridge,
          model: bridgeModel,
          firstTokenMs: firstTokenMs ?? 0,
          modelMs,
        });

        let settled = false;
        const settle = (failed: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          enqueue({ type: "audio-end", turnId: body.turnId, ...(failed ? { failed: true } : {}) });
          if (!failed) {
            recordTtsUsage({
              route: "generate-bridge-stream",
              model: getElevenLabsModelId(),
              characters: bridge.length,
            });
          }
          enqueue({ type: "done", turnId: body.turnId });
          close();
        };
        const watchdog = setTimeout(() => {
          ttsController?.close();
          settle(true);
        }, 7_000);

        const voiceSettings: VoiceSettings = {
          ...DEFAULT_VOICE_SETTINGS,
          ...(body.baseVoiceSettings ?? {}),
        };
        ttsController = openElTtsStream({
          voiceId: voiceIdForExperience(
            session?.experienceType ?? body.experienceType,
          ),
          voiceSettings,
          previousText: body.previousText,
          onAudioChunk: (chunk) => enqueue({ type: "audio", turnId: body.turnId, chunk }),
          onDone: () => settle(false),
          onError: (error) => {
            console.error("[generate-bridge] ElevenLabs stream failed:", error.message);
            settle(true);
          },
        });
        enqueue({ type: "bridge", turnId: body.turnId, text: bridge });
        ttsController.sendText(bridge);
        ttsController.end();

        req.signal.addEventListener("abort", () => {
          ttsController?.close();
          clearTimeout(watchdog);
          close();
        }, { once: true });
      } catch (error) {
        if (!req.signal.aborted) {
          console.error("[generate-bridge]", error);
          enqueue({ type: "error", turnId: body.turnId, error: "bridge_failed" });
          enqueue({ type: "done", turnId: body.turnId });
        }
        close();
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
