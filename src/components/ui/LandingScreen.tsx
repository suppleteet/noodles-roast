"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSessionStore } from "@/store/useSessionStore";
import type { ContentMode, RoastModelId } from "@/store/useSessionStore";
import { formatUsd, type RoastPassProduct, type RoastPassSku } from "@/lib/monetizationCatalog";
import { useDevUnlock } from "@/lib/devUnlock";
import { preloadLiveExperienceModules } from "@/lib/preloadLiveExperience";
import { currentMediaCaptureBlockMessage } from "@/lib/mediaCaptureSupport";

const MODEL_OPTIONS: { id: RoastModelId; label: string }[] = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash — Recommended" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — Balanced" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — Fast" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash — Previous default" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — Speed baseline" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — Speed baseline" },
];

const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED === "true";

interface MonetizationStatus {
  enabled: boolean;
  configured: boolean;
  credits: number;
  products: RoastPassProduct[];
  pending: { id: string; checkoutUrl: string | null }[];
}

export default function LandingScreen() {
  const setPhase = useSessionStore((s) => s.setPhase);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);
  const contentMode = useSessionStore((s) => s.contentMode);
  const setContentMode = useSessionStore((s) => s.setContentMode);
  const roastModel = useSessionStore((s) => s.roastModel);
  const setRoastModel = useSessionStore((s) => s.setRoastModel);
  const cannedIntro = useSessionStore((s) => s.cannedIntro);
  const setCannedIntro = useSessionStore((s) => s.setCannedIntro);
  const llmQuestions = useSessionStore((s) => s.llmQuestions);
  const setLlmQuestions = useSessionStore((s) => s.setLlmQuestions);
  const setExperienceType = useSessionStore((s) => s.setExperienceType);
  const IS_DEV = useDevUnlock();
  const [hydrated, setHydrated] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<MonetizationStatus | null>(null);
  const [paymentBusy, setPaymentBusy] = useState<RoastPassSku | "redeem" | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<PuppetProfile["id"]>("roastie");
  const carouselRef = useRef<HTMLDivElement>(null);
  const profileRefs = useRef<Record<PuppetProfile["id"], HTMLButtonElement | null>>({
    roastie: null,
    toastie: null,
  });

  const selectedProfile =
    PUPPET_PROFILES.find((profile) => profile.id === selectedProfileId) ?? PUPPET_PROFILES[0];

  function selectProfile(profile: PuppetProfile, behavior: ScrollBehavior = "smooth"): void {
    setSelectedProfileId(profile.id);
    setExperienceType(profile.experienceType);
    const card = profileRefs.current[profile.id];
    if (typeof card?.scrollIntoView === "function") {
      card.scrollIntoView({
        behavior,
        block: "nearest",
        inline: "center",
      });
    }
  }

  function handleCarouselScroll(): void {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const center = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
    let nearest = selectedProfile;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const profile of PUPPET_PROFILES) {
      const card = profileRefs.current[profile.id];
      if (!card) continue;
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - center);
      if (distance < nearestDistance) {
        nearest = profile;
        nearestDistance = distance;
      }
    }
    if (nearest.id !== selectedProfileId) {
      setSelectedProfileId(nearest.id);
      setExperienceType(nearest.experienceType);
    }
  }

  async function refreshPaymentStatus(): Promise<MonetizationStatus | null> {
    if (!PAYMENTS_ENABLED) return null;
    const resp = await fetch("/api/monetization/status", { cache: "no-store" });
    const data = (await resp.json()) as MonetizationStatus;
    setPaymentStatus(data);
    return data;
  }

  // ── Cold-start prewarm ──────────────────────────────────────────────────────
  // Warm the slow startup paths WHILE the user is choosing a Puppet Line profile,
  // so the first session doesn't eat the latency (a cold first session
  // pushed time-to-first-speech to ~28s in one log). Fire-and-forget; each call
  // is harmless on its own and the post-permission warmup still runs as backstop.
  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Warm the EL synthesis path for the default Roast voice — a tiny real
    // synth (one word) so the model/voice cold-start is mostly paid before the
    // user even clicks Start. The post-permission prewarm in page.tsx warms the
    // exact experience voice again closer to use; this just gets a head start.
    fetch("/api/prewarm-tts", { method: "POST" }).catch(() => {});

    // In dev, first-hit route compilation is the dominant cold cost (the
    // live-token route alone took ~15s cold in the log). Ping the heaviest
    // routes so Next compiles them before the user clicks. Dev-only: in prod
    // these would mint a throwaway Gemini token / burn vision quota on every
    // landing impression (including bounces), which isn't worth it — prod
    // lambdas are cheap to warm and the token fetch is ~300ms there.
    if (process.env.NODE_ENV !== "production") {
      fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => preloadLiveExperienceModules(), { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }

    const id = setTimeout(() => preloadLiveExperienceModules(), 1200);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!PAYMENTS_ENABLED) return;
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    const returnedFromCheckout = params.get("checkout") === "success";
    if (returnedFromCheckout) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    void (async () => {
      for (let attempt = 0; attempt < (returnedFromCheckout ? 8 : 1); attempt++) {
        const status = await refreshPaymentStatus();
        if (cancelled || !returnedFromCheckout || (status?.credits ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  async function handleStart() {
    preloadLiveExperienceModules();
    setError(null);
    const captureBlockMessage = currentMediaCaptureBlockMessage();
    if (captureBlockMessage) {
      setError(captureBlockMessage);
      return;
    }
    if (PAYMENTS_ENABLED) {
      const status = paymentStatus ?? await refreshPaymentStatus();
      if (!status?.configured) {
        setError("Square checkout is not configured yet.");
        return;
      }
      if (status.credits <= 0) {
        setError("Buy a Roast Pass first.");
        return;
      }
      setPaymentBusy("redeem");
      const resp = await fetch("/api/monetization/redeem", { method: "POST" });
      const next = (await resp.json().catch(() => ({}))) as Partial<MonetizationStatus> & { error?: string };
      setPaymentBusy(null);
      if (!resp.ok) {
        setError(next.error ?? "Could not redeem Roast Pass.");
        await refreshPaymentStatus();
        return;
      }
      if (typeof next.credits === "number" && paymentStatus) {
        setPaymentStatus({ ...paymentStatus, credits: next.credits });
      }
    }
    setPhase("requesting-permissions", "START_CLICKED");
  }

  async function handleCheckout(sku: RoastPassSku) {
    setError(null);
    setPaymentBusy(sku);
    try {
      const resp = await fetch("/api/monetization/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      const data = (await resp.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!resp.ok || !data.url) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setPaymentBusy(null);
      setError((e as Error).message);
    }
  }

  const products = paymentStatus?.products ?? [];
  const featured = products.find((product) => product.featured) ?? products[0];

  return (
    <div className="landing-screen puppet-line-screen">
      <div className="pointer-events-none absolute inset-0 bg-black" />

      <main className="puppet-line-main">
        <h1 className="sr-only">Choose a puppet</h1>
        <section aria-label="Choose a puppet" className="puppet-picker">
          <div
            ref={carouselRef}
            data-testid="puppet-carousel"
            className="puppet-carousel"
            onScroll={handleCarouselScroll}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const index = PUPPET_PROFILES.findIndex((profile) => profile.id === selectedProfileId);
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const next = PUPPET_PROFILES[Math.max(0, Math.min(PUPPET_PROFILES.length - 1, index + delta))];
              selectProfile(next);
            }}
            tabIndex={0}
          >
            {PUPPET_PROFILES.map((profile) => {
              const selected = profile.id === selectedProfileId;
              return (
                <button
                  key={profile.id}
                  ref={(node) => { profileRefs.current[profile.id] = node; }}
                  type="button"
                  data-testid={`puppet-profile-${profile.id}`}
                  aria-label={`Select ${profile.name}`}
                  aria-pressed={selected}
                  className={`puppet-profile-card ${selected ? "is-selected" : ""}`}
                  onClick={() => selectProfile(profile)}
                >
                  <span className="puppet-profile-portrait">
                    <Image
                      src={profile.portraitSrc}
                      alt=""
                      width={420}
                      height={420}
                      priority
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="text-xl font-medium leading-none text-white">{profile.name}</span>
                </button>
              );
            })}
          </div>
          <div className="puppet-profile-dots" aria-label="Puppet selection">
            {PUPPET_PROFILES.map((profile) => (
              <button
                key={profile.id}
                type="button"
                aria-label={`Show ${profile.name}`}
                className={profile.id === selectedProfileId ? "is-selected" : ""}
                onClick={() => selectProfile(profile)}
              />
            ))}
          </div>
        </section>

        <section className="puppet-line-controls" aria-label="Call options">
          {error && (
            <div className="w-full rounded-xl border border-red-500/50 bg-red-950/70 px-4 py-2 text-sm text-red-100">
              {error}
            </div>
          )}

          {IS_DEV && (
            <div className="grid w-full gap-2">
              <select
                data-testid="roast-model-select"
                value={roastModel}
                onChange={(event) => setRoastModel(event.target.value as RoastModelId)}
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 font-mono text-xs text-white/80 outline-none"
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model.id} value={model.id} className="bg-gray-950 text-white">
                    {model.label}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-purple-200">
                <input
                  type="checkbox"
                  checked={cannedIntro}
                  onChange={(event) => setCannedIntro(event.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-purple-400"
                />
                Legacy canned intro
              </label>
              <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-purple-200">
                <input
                  type="checkbox"
                  checked={llmQuestions}
                  onChange={(event) => setLlmQuestions(event.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-purple-400"
                />
                LLM questions
              </label>
            </div>
          )}

          <div className="content-mode-control" role="group" aria-label="Content mode">
            <div className="grid grid-cols-2 rounded-full border border-white/10 bg-white/10 p-0.5">
              {(["clean", "vulgar"] as ContentMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setContentMode(mode)}
                  aria-pressed={contentMode === mode}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize transition-all ${
                    contentMode === mode
                      ? "bg-white text-black"
                      : "text-white/55 hover:text-white"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {PAYMENTS_ENABLED && (
            <div className="w-full rounded-2xl border border-white/10 bg-white/[0.045] p-3 text-left">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/65">Passes</span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70">
                  {paymentStatus?.credits ?? 0} credit{(paymentStatus?.credits ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
              {featured && (
                <button
                  type="button"
                  onClick={() => handleCheckout(featured.sku)}
                  disabled={paymentBusy !== null || paymentStatus?.configured === false}
                  className="mb-2 w-full rounded-xl bg-white px-4 py-3 text-left text-black disabled:opacity-50"
                >
                  <span className="block text-sm font-black">
                    {featured.name} · {featured.credits} for {formatUsd(featured.amountCents)}
                  </span>
                  <span className="text-xs text-black/60">{featured.description}</span>
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                {products.filter((product) => product.sku !== featured?.sku).slice(0, 2).map((product) => (
                  <button
                    key={product.sku}
                    type="button"
                    onClick={() => handleCheckout(product.sku)}
                    disabled={paymentBusy !== null || paymentStatus?.configured === false}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-xs text-white/70 disabled:opacity-50"
                  >
                    <span className="block font-bold text-white">{formatUsd(product.amountCents)}</span>
                    <span>{product.credits} credit{product.credits === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            data-testid="call-selected-puppet"
            aria-label={`Call ${selectedProfile.name}`}
            aria-busy={paymentBusy === "redeem"}
            onClick={() => {
              setExperienceType(selectedProfile.experienceType);
              void handleStart();
            }}
            disabled={!hydrated || paymentBusy !== null}
            className="puppet-call-button"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L7.96 9.72a16 16 0 0 0 6 6l1.26-1.26a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z" />
            </svg>
          </button>
        </section>
      </main>
    </div>
  );
}

interface PuppetProfile {
  id: string;
  name: string;
  experienceType: "roast" | "toast";
  portraitSrc: string;
}

const PUPPET_PROFILES: readonly PuppetProfile[] = [
  { id: "roastie", name: "Roastie", experienceType: "roast", portraitSrc: "/puppets/roastie.png" },
  { id: "toastie", name: "Toastie", experienceType: "toast", portraitSrc: "/puppets/toastie.png" },
];
