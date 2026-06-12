# RoastMe — Project Reference

## Package Versions (authoritative — check before using any API)

| Package | Version | Notes |
|---------|---------|-------|
| next | ^16.1.6 | App Router, Server Components |
| react / react-dom | ^19.0.0 | React 19 — new ref callback syntax |
| typescript | ^5 | strict mode on |
| three | ^0.175.0 | R3F peer |
| @react-three/fiber | ^9.1.2 | useFrame, Canvas |
| @react-three/drei | ^10.3.5 | useGLTF, etc. |
| @types/three | ^0.175.0 | must match three version |
| zustand | ^5.0.3 | `create<State>((set) => ...)` — NOT curried v4 form |
| @anthropic-ai/sdk | ^0.39.0 | Used by `llmClient.ts` for `claude-*` models |
| @google/genai | ^1.45.0 | `new GoogleGenAI({ apiKey })` → `ai.models.generateContent()` |
| elevenlabs | ^1.57.0 | installed but TTS uses raw fetch for streaming |
| @ricky0123/vad-web | ^0.0.30 | Silero VAD — fast end-of-speech detection in browser |
| simplex-noise | ^4.0.3 | Used by HeadMotionComponent (createNoise3D) |
| tailwindcss | ^3.4.19 | |
| autoprefixer | ^10.4.27 | PostCSS plugin |
| postcss | ^8.5.8 | |
| ws | ^8.20.0 | WebSocket client for ElevenLabs TTS streaming (elTtsStream.ts) |
| vitest | ^4.1.0 | Unit test runner |
| @playwright/test | ^1.58.2 | E2E test framework |
| @testing-library/react | ^16.3.2 | React component testing utilities |
| @testing-library/jest-dom | ^6.9.1 | Custom jest/vitest matchers |
| @testing-library/user-event | ^14.6.1 | User interaction simulation |
| @vitejs/plugin-react | ^6.0.1 | Vite/Vitest React plugin |
| @vitest/ui | ^4.1.0 | Vitest UI dashboard |
| @types/ws | ^8.18.1 | TypeScript types for ws |
| @vercel/blob | ^2.3.3 | Durable feedback storage (Vercel Blob) |
| jsdom | ^29.0.0 | DOM environment for Vitest |
| openai | ^6.34.0 | Used by `llmClient.ts` for `gpt-*` and `o*` models |
| googleapis | ^172.0.0 | OAuth + Drive v3 for auto-upload of finished roast MP4s |
| eslint | ^9 | Lint runner; `npm run lint` just aliases `typecheck` |
| eslint-config-next | ^16.1.6 | Next.js ESLint preset |
| @types/node | ^20 | Node typings |
| @types/react | ^19 | React typings (matches react ^19.0.0) |
| @types/react-dom | ^19 | React DOM typings |

## AI Models in Use

| Constant | Model ID | Used For |
|----------|----------|----------|
| `VISION_MODEL` | `gemini-3.5-flash` | Webcam frame analysis (`/api/vision`, `/api/analyze`) |
| `ROAST_MODEL` | `gemini-3.5-flash` | Default joke generation model (`/api/generate-joke`, `/api/generate-speak`, `/api/generate-question`, `/api/rephrase-question`) — Claude Sonnet 4.6, Claude Haiku 4.5, GPT-4o, and `gemini-3.1-flash-lite` also selectable via UI |
| `ELEVENLABS_VOICE_ID` | `EXAVITQu4vr4xnSDxMaL` | TTS default voice — Rachel (Roast). Picked per-experience by `voiceIdForExperience()` |
| `TOAST_VOICE_ID` | `vamKBH1qWYogA4WG6UPB` | TTS voice for the Toast experience (drunk-wedding-toast character). Override via `ELEVENLABS_TOAST_VOICE_ID` env |
| `LIVE_MODEL` | `gemini-2.5-flash-native-audio-preview-12-2025` | Live API STT/VAD only (`/api/live-token`) |
| `LIVE_VOICE_NAME` | `Kore` | Gemini native audio voice (used in session config) |

> Multi-provider generation is live via `src/lib/llmClient.ts` (`gemini-*`, `gpt-*`/`o*`, `claude-*`). Keep provider-specific SDK behavior inside that adapter so routes remain provider-agnostic.

Run `/package-versions` before touching any API usage.

## Session Modes

The app supports two session modes (controlled by `sessionMode` in the store):

- **`"monologue"`**: Original mode. Discrete cycle: capture frame → Gemini vision analysis → ElevenLabs TTS → play. No mic.
- **`"conversation"`** (default): **Comedian Brain** mode. Gemini Live API is used for STT/VAD only. All speech is controlled by `ComedianBrain` state machine via `/api/generate-joke` + ElevenLabs TTS. Structured show: greeting → vision jokes → Q&A cycles → vision interrupts.

## Personas & Experiences

The comedian's character is the **persona** — `activePersona: PersonaId` in the store (default `kvetch`, set via `setActivePersona`). Four personas ship: `kvetch` (old/grizzled/Rickles), `hype` (explosive arena energy), `sweetheart` (kill-shots disguised as kindness), `menace` (gleeful escalating savagery). The id selects the character block injected into every prompt build in `src/lib/prompts.ts` (`getPersona(id)`).

**Each comedian's character content lives in its own editable file**: `src/lib/comedians/{kvetch,hype,sweetheart,menace}.ts` (one `PersonaConfig` per file; field-by-field docs in `comedians/types.ts`). The Toast character is separate (`toastPrompts.ts`). View any fully-assembled session system prompt at `/api/debug-prompt?persona=<id>` (or `?experience=toast`).

Import split — **import the lightweight one from client/store code**:
- `src/lib/personaMetadata.ts` — client-safe: `PersonaId`, `PERSONA_IDS`, `DEFAULT_PERSONA`, `PERSONA_NAMES`, `PERSONA_GREETINGS`. No heavy prompt strings. `constants.ts`, `useSessionStore.ts`, and other client code import from here so the multi-KB persona prompt bodies don't get bundled into the client.
- `src/lib/personas.ts` — thin registry assembling the `src/lib/comedians/` configs into `PERSONAS`/`getPersona()`, used at prompt-build time. Re-exports the metadata symbols for convenience, but **don't import this from client code** — it pulls in all the prompt text.

Orthogonal to persona: the **experience** (Roast vs Toast). In the **Toast** experience the persona is ignored (one fixed drunk-wedding-toast character; see `toastPrompts.ts`) and `voiceIdForExperience()` picks the voice. (The old `flowMode` / Rapid Fire variant was removed June 2026.)

**Canned intro toggle** (`cannedIntro` in the store, **default ON** since June 2026 — mobile prod runs hit the "hazard pay" fallback when the greeting prefetch lost its 1.5s race; dev checkbox on the landing screen turns it off): when on (Roast only), the session opens with an instant canned video-call line ("Well, what am I looking at here? Who am I talking to?") instead of the LLM greeting — no LLM, no vision wait, TTFS ≈ the TTS round-trip. Scripted opening lines (canned intro + greeting fallbacks) speak in the persona's register via `_openerRegister()` (top `motionPreferences` entry at 0.6; Toast stays energetic 0.8) — a hardcoded energetic 0.8 read screechy-high on the style-maxed base voice. The line doubles as the name question, so the brain advances straight to `wait_answer` — every line MUST end with a who-are-you ask (test-enforced in `personas.test.ts`). Banks are **per-persona**, in each comedian's file (`src/lib/comedians/*.ts`, `cannedIntros: { clean, vulgar }`) — they replaced the old unused `greetings` arrays. Picked by `pickCannedIntro(intros, hour, vulgar)` in `comedians/types.ts`, time-of-day flavored (early 5-9h / late 22-4h buckets). The greeting LLM prefetch is skipped when the toggle is on.

## Session Startup / Prewarm (cold-start resilience)

The slow startup paths are kicked off as early as their inputs exist, so a cold first session doesn't stack latencies (one log hit ~28s time-to-first-speech):

- **Live token** — prefetched on `idle` (`page.tsx:ensureLiveTokenPrefetch`), overlapping the permission dialog.
- **Comedian chat session** — prefetched at **button press** (`requesting-permissions`, `page.tsx:ensureComedianSessionPrefetch`), passed into `LiveSessionController` as `prefetchedComedianSessionPromise`; the controller consumes it (or creates one itself as fallback). Its cold latency overlaps the camera/mic grant.
- **Warm spare token** — `LiveSessionController` keeps a pre-minted ephemeral token (`spareTokenRef`/`mintSpareToken`) off the critical path, consumed + refilled by `rotateSession`, so an unexpected-drop reconnect or scheduled rotation skips the `/api/live-token` round-trip (`openSession` falls back to `fetchToken` if the spare is missing/expired).
- **Landing-screen prewarm** — `LandingScreen` mount fires `/api/prewarm-tts` (always; warms EL DNS/TLS host-level for both voices) and `/api/live-token` (dev only — compiles the cold route; gated to avoid minting throwaway tokens for every prod visitor).
- **Greeting + vision** — run in parallel post-permission (they need the camera frame); greeting TTS is chained the instant the joke text lands. The prefetch lives in `src/lib/greetingPrefetch.ts` (direct-image joke + vision in parallel, with TTS chunks buffered via `TtsChunkBuffer`). `enterGreeting()` consumes the prefetch but races it against a 2s timeout (`comedianBrain.ts`) — if the prefetch is slow it generates a fast fallback, and if that fails too it falls back to a short canned line, so a slow prefetch cascades into worst-case TTFS.
- **Module preload** — `preloadLiveExperienceModules()` warms the heavy dynamic-import chunks (puppet scene, session controllers, share screen) from the landing/idle path. VAD runtime/model startup is deferred until after first speech so Silero assets cannot compete with TTFS.

## Comedian Brain Architecture (conversation mode)

```
Gemini Live API ──── mic audio ────→ inputTranscription → ComedianBrain.onInputTranscription()
                ──── webcam ────────→ VAD context only (Gemini output DISCARDED)

Silero VAD ─────── mic audio ────→ onSpeechEnd → ComedianBrain.onVadSpeechEnd()
                                   (fast ~200ms end-of-speech, primary detector)

ComedianBrain ──→ /api/generate-joke (Gemini Flash) → joke text + motion
             └──→ /api/tts (ElevenLabs) → gapless playback via usePcmPlayback

/api/comedian-session → creates multi-turn Gemini Chat (persona loaded once)
  └── generate-joke/generate-speak reuse the Chat via sessionId
      (falls back to stateless full-prompt if session missing/expired)

/api/analyze ────→ webcam observations → ComedianBrain.onVisionUpdate()
```

**Key rule**: Gemini Live output (outputTranscription, modelTurn) is DISCARDED. The brain controls all speech.

**Question selection**: All questions come from `QUESTION_BANK` (`src/lib/questionBank.ts`). The joke LLM is told NOT to emit follow-up questions — its job is jokes + tags + redirect/callback only. Personalization happens at delivery time via `/api/rephrase-question`, which gets `knownFacts` from the ledger and is told to use the user's name once if known (e.g., "Alright — what's your name?" → "So Tyler, what's your job?"). This makes the conversation feel responsive without letting the LLM go off-script and accidentally repeat topics.

**End-of-speech detection**: Silero VAD (`useVad`) is the primary detector (~300ms redemption). The brain's `answerSilenceMs` timer (300ms) is a fallback if VAD fails to load or misses. VAD end-of-speech defers to the length-aware silence timer (`_answerNeedsMoreStt`) whenever the transcript reads as unfinished, so breath pauses don't commit partial answers.

**Repeat guard**: every joke generation call (answer_roast, vision_react, hopper, pipeline) carries `jokesAlreadyDelivered` — the last 10 delivered joke texts from the ledger — as a hard do-not-repeat list. `conversationSoFar` only holds the last 6 ledger entries, so this is what keeps older angles from being reused. Canned fallback save-lines are also deduped per session (`usedFallbackLines`).

**Streaming-TTS sink rule**: when `generate-speak` streams with TTS, the brain only skips `queueSpeak` for a joke if a sink was actually opened (`joke-meta` arrived). If the server never opened the EL WS for that joke, the brain falls back to `queueSpeak` — otherwise the joke is silent and the show hangs in `delivering` (no drain edge ever fires).

## Brain State Machine

States (in order): `greeting` → `ask_question` → `wait_answer` → `pre_generate` → `confirm_answer` (if low confidence) → `generating` → `delivering` → `check_vision` → `vision_react` (or back to `ask_question`)

Note: `greeting` is LLM-generated (not canned strings) and includes the first vision joke. The old `vision_jokes` state is still defined but greeting now advances directly to `ask_question`.

Silence states: `prodding` (after answerWaitMs with no speech), `redirecting` (irrelevant answer).

Answer confirmation: `confirm_answer` gates answers with heuristic confidence scoring (`transcriptConfidence.ts`). Names always confirmed unless very confident; other questions only on low confidence. Canned templates (no LLM call). Handles yes/no/correction responses. Silence after prompt = implicit yes (3s).

State config lives in `src/lib/comedianBrainConfig.ts`. Timing in `src/lib/comedianConfig.ts`.

## Architecture

```
src/app/api/           Next.js API routes (analyze, ambient-context, comedian-session, debug-prompt, debug-usage, generate-joke, generate-question, generate-speak, list-feedback, live-token, monetization/{checkout,redeem,status,webhook}, name-video, open-videos-folder, prewarm-tts, rephrase-question, roast, save-feedback, save-log, save-transcript, save-video, save-voice-note, serve-video, town-flavor, tts, tts-ws, upload-to-drive, video-blob-upload, vision)
src/components/puppet/ Three.js puppet inside R3F Canvas
src/components/session/ SessionController (monologue), LiveSessionController (conversation)
src/components/audio/  AudioPlayer (monologue), useMicCapture + usePcmPlayback + useVad (conversation)
src/components/recording/ MediaRecorder + offscreen canvas compositor
src/components/ui/     Screen overlays (landing, consent, HUD, share, FeedbackBox, DebugTranscript)
src/lib/               Pure utilities, constants, prompts, personas + personaMetadata (client-safe split), preloadLiveExperience (module warmup), greetingPrefetch (greeting joke+TTS prefetch), audioUtils, motionInference, elTtsStream, chatSessionStore, voiceMotionPresets (motion → voice_settings deltas), ttsChunkBuffer, llmClient, scriptLines (all canned spoken lines), toastPrompts + toastQuestionBank (Toast experience), mediaRecorderSupport (recording mimeType/bitrates), liveConstants (MIC_SAMPLE_RATE 16k, OUTPUT_SAMPLE_RATE 24k)
src/lib/stateMachine/      State machine types, transitions, and configs (SessionPhase, BrainState, MotionState)
src/lib/comedianBrain.ts   State machine class (conversation mode)
src/lib/comedianBrainConfig.ts  Declarative STATE_CONFIG map
src/lib/comedianConfig.ts  All timing/threshold tuning parameters (window-injectable for tests)
src/lib/questionBank.ts    8 questions with prod lines + confirm templates (hot-swappable)
src/lib/transcriptConfidence.ts  Heuristic confidence scoring for STT transcriptions
src/lib/visionDiff.ts      Observation diff + interest scoring
src/lib/usageTracker.ts    In-memory LLM/TTS usage + cost tracking (surfaced at /api/debug-usage)
src/lib/devUnlock.ts       Prod dev-UI unlock: tap the build stamp 5x in 2.5s → localStorage flag; IS_DEV checks consult useDevUnlock()/getDevUnlocked()
src/store/             Zustand store (useSessionStore.ts)
public/worklets/       AudioWorklet processors (mic-capture-processor.js)

src/engine/            Self-contained skeletal rig component engine (no comedy/audio knowledge)
  types.ts             PropertyDef, ComponentTypeDef, ComponentInstance, RigConfig, TickContext
  registry.ts          Component type registry — registerComponentType(), createComponentInstance()
  secondary/           SecondaryMotion (scalar), Vec3, Quat wrappers
  simulation/          VerletChain — pure verlet math, Jakobsen constraints
  components/          ComponentRuntime interface + VerletChainComponent
  runtime/             RigRuntime (tick loop) + RigRuntimeBridge (R3F bridge, useFBX)
  gizmos/              GizmoLine/Sphere types, R3F renderer, skeleton/verlet builders
  store/               RigEditStore (Zustand v5), configPersistence (localStorage)
  ui/                  RigEditMode, ComponentList, ComponentInspector, PropertyField,
                       SecondaryMotionField, AnimationCurveEditor, BoneSelector, SignalPreview

src/puppet/            Paper-thin puppet-specific layer
  types.ts             PuppetConfig extends RigConfig
  components/          JawFlapComponent (audioAmplitude → jaw rotation)
                       HeadMotionComponent (audioAmplitude + simplex noise → head euler)
```

## Key Invariants — Do Not Violate

1. **useFrame + store**: Inside `useFrame`, ALWAYS use `useSessionStore.getState()`, never `useSessionStore(selector)`. React hooks cannot run inside rAF callbacks.
2. **Routes call `llmClient.ts`, not provider SDKs directly**: All joke/question generation flows through the multi-provider adapter (`src/lib/llmClient.ts`). Routes choose a model id (`gemini-*`, `gpt-*`/`o*`, `claude-*`); SDK plumbing for each provider lives inside `llmClient.ts`.
3. **ElevenLabs uses raw fetch/WebSocket**: `/api/tts` uses `fetch()` (REST), `/api/tts-ws` uses `ws` (WebSocket streaming via `elTtsStream.ts`). `/api/generate-speak` streams joke text only (no TTS). Do not refactor to the ElevenLabs SDK without testing streaming.
4. **Zustand v5**: `create<SessionState>((set) => ...)` — no curried form.
5. **No `any`**: strict mode is on. Comment-justify any type assertion.
6. **LiveSessionController uses getState()**: All store access in WebSocket callbacks and long-lived closures must use `useSessionStore.getState()` to avoid stale closures. Only `phase` is subscribed via selector (for lifecycle).
7. **ComedianBrain controls all speech**: In conversation mode, DO NOT route Gemini output to TTS. The brain calls `queueSpeak()` directly. Gemini Live is STT/VAD only.
8. **Mic gating**: `useMicCapture` callback checks `brain.isAudioActive()` before sending audio. Mic is `"passive"` (keeps Gemini VAD warm) in most states; only `"off"` during `greeting` and `vision_jokes`. `"listening"` in `wait_answer`, `prodding`, `pre_generate`.
9. **TTS drain detection**: LiveSessionController uses `playback.isQueueEmpty()` in a rAF loop to detect when speech finishes, then calls `brain.onTtsQueueDrained()`.
10. **LLM-generated greetings**: `enterGreeting()` fires `_generateJoke({ context: "greeting" })` immediately with the webcam frame — no vision wait. Always LLM-generated, never canned strings. The `.then()` callback guards against stale state with `if (this.state !== "greeting") return`. `_maybeAdvanceFromGreeting` requires both `greetingSpeechQueued` and `greetingTtsDrained` before advancing to `ask_question`.
11. **Engine signals abstraction**: Rig components (JawFlap, HeadMotion) NEVER read from `useSessionStore` directly. They read from `TickContext.signals: Record<string, number>`. In session mode the consumer populates this from the store; in edit mode it comes from `RigEditStore.previewSignals`. Component signal declarations (`SignalDef[]`) auto-generate the preview sliders.
12. **No per-frame allocations in engine**: Inside `tick()` callbacks, NEVER use `new THREE.Vector3()` / `new THREE.Quaternion()` / `new THREE.Matrix4()`. All scratch objects must be pre-allocated as class fields and mutated via `.set()` / `.copy()`.

## Monetization (Square Roast Passes)

Feature-flagged by `NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED` (off → all monetization UI/routes are inert). Flow:

- **Catalog** — `src/lib/monetizationCatalog.ts` defines the SKUs (`solo-roast` 1 credit / `party-pack` 6 / `event-pack` 40) and `paymentsEnabled()`.
- **Buyer identity** — anonymous `roastie_buyer_id` httpOnly cookie (1 year), minted by `monetizationCookies.ts`. No accounts.
- **Checkout** — `POST /api/monetization/checkout` creates a pending ledger entry and a Square Payment Link (`squareCheckout.ts`; needs `SQUARE_ACCESS_TOKEN` + `SQUARE_LOCATION_ID`, env picked by `SQUARE_ENVIRONMENT`).
- **Payment confirmation** — two paths: the Square webhook (`/api/monetization/webhook`, HMAC-verified when `SQUARE_WEBHOOK_SIGNATURE_KEY` is set, idempotent via `processedWebhookEvents`) AND a polling fallback — `GET /api/monetization/status` calls `monetizationSync.ts` to reconcile pending checkouts against the Square Payments API, so credits land even if the webhook never fires (e.g., local dev).
- **Ledger** — `entitlementLedger.ts`: buyers/checkouts/credits in a JSON file (path override `ROASTIE_LEDGER_PATH`). `POST /api/monetization/redeem` consumes one credit to start a session.

## Test Config Injection

Tests inject fast timing via `window.__COMEDIAN_CONFIG__`:
```typescript
await page.addInitScript(() => {
  (window as unknown as Record<string, unknown>).__COMEDIAN_CONFIG__ = {
    answerWaitMs: 80, answerSilenceMs: 30, maxProds: 1,
    visionIntervalMs: 200, greetingVisionTimeoutMs: 300,
  };
  // Prevent session rotation from firing during long tests (default 90s):
  (window as unknown as Record<string, unknown>).__SESSION_ROTATE_MS__ = 600_000;
});
```
`ComedianBrainDriver` in `e2e/helpers/comedianBrainDriver.ts` does this automatically.

`__SESSION_ROTATE_MS__` overrides the 90-second Gemini Live session rotation timeout in `LiveSessionController.tsx`. Set to 600_000 (10 min) in the roast-run test to prevent mid-test session rotation.

## Commands

```bash
npm run dev           # Next.js dev server (webpack, not turbopack)
npm run build         # next build --webpack
npm run typecheck     # tsc --noEmit
npm run lint          # alias for typecheck (no separate ESLint pass)
npm test              # vitest run (single pass)
npm run test:watch    # vitest watch mode
npm run test:coverage
npm run test:e2e      # Playwright (requires dev server on :3000)
npm run test:e2e:ui   # Playwright UI mode

# Single test file / single test:
npx vitest run src/__tests__/lib/comedianBrain.test.ts
npx vitest run -t "name of test"
npx playwright test e2e/comedian-brain.spec.ts

# Opt-in: integration roast-run that hits real LLM APIs (costs $).
# Catches prompt-rule violations and repeat-question / flow bugs that mocks miss.
RUN_INTEGRATION_TEST=1 npx playwright test e2e/integration-roast-run.spec.ts
```

## Debugging Sessions

`.debug/last-session.json` holds the timing log + transcript of the most recent local session — check it first when debugging TTFS, turn-taking, or flow issues. Lines like `brain: TTFS 18097ms`, `tts: first audio 6813ms`, and `brain: greeting prefetch slow — generating fast fallback` pinpoint where startup time went.

**Test environments**: Tyler develops on **Windows** (desktop Chrome against `localhost:3000`) and tests mobile on **Android** (Chrome, against the Vercel deploy or LAN dev server). He does NOT test on iOS/Safari — when diagnosing audio/browser bugs from his session reports, the platform is Windows or Android, never iOS. Browser-quirk comments in the audio code citing iOS are documented WebKit behaviors kept for safety, but any glitch Tyler actually *hears* happened on Chrome (Windows/Android), so don't attribute his repros to iOS-only behavior.

## Path Alias

`@/*` maps to `./src/*`. Always use `@/lib/spring` not relative paths.

## Env Vars Required

```
GEMINI_API_KEY
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID   (optional, defaults to Rachel)
BLOB_READ_WRITE_TOKEN (Vercel Blob — feedback persistence)

# Optional — multi-provider joke generation (llmClient.ts). Only needed if the
# corresponding model family is selected in the UI; Gemini-only works without these.
OPENAI_API_KEY
ANTHROPIC_API_KEY

# Optional — ElevenLabs tuning overrides (defaults live in code)
ELEVENLABS_TOAST_VOICE_ID
ELEVENLABS_MODEL_ID
ELEVENLABS_API_HOST
ELEVENLABS_AUTO_MODE
ELEVENLABS_CHUNK_SCHEDULE

# Optional — Square monetization (see Monetization section).
# NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED off → everything below is unused.
NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED
SQUARE_ACCESS_TOKEN
SQUARE_LOCATION_ID
SQUARE_ENVIRONMENT              (sandbox | production)
SQUARE_WEBHOOK_SIGNATURE_KEY
SQUARE_WEBHOOK_NOTIFICATION_URL
ROASTIE_LEDGER_PATH             (override ledger JSON location)

# Optional — enables auto-upload of saved MP4s to Google Drive.
# Missing any one of these silently skips the upload (local save still works).
# Mint the refresh token via: node scripts/google-drive-auth.mjs
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
```
