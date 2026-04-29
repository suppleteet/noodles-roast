"use client";
import { useEffect, useState } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import type { ContentMode, RoastModelId } from "@/store/useSessionStore";
import { formatUsd, type RoastPassProduct, type RoastPassSku } from "@/lib/monetizationCatalog";

const IS_DEV = process.env.NODE_ENV !== "production";

const MODEL_OPTIONS: { id: RoastModelId; label: string }[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
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
  const locationConsent = useSessionStore((s) => s.locationConsent);
  const setLocationConsent = useSessionStore((s) => s.setLocationConsent);
  const roastModel = useSessionStore((s) => s.roastModel);
  const setRoastModel = useSessionStore((s) => s.setRoastModel);
  const [paymentStatus, setPaymentStatus] = useState<MonetizationStatus | null>(null);
  const [paymentBusy, setPaymentBusy] = useState<RoastPassSku | "redeem" | null>(null);

  async function refreshPaymentStatus(): Promise<MonetizationStatus | null> {
    if (!PAYMENTS_ENABLED) return null;
    const resp = await fetch("/api/monetization/status", { cache: "no-store" });
    const data = (await resp.json()) as MonetizationStatus;
    setPaymentStatus(data);
    return data;
  }

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
    setError(null);
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
    <div className="relative flex h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#080301] px-4 text-center text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(248,113,22,0.24),transparent_30%),linear-gradient(150deg,#170604_0%,#050201_58%,#000_100%)]" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center rounded-[2rem] border border-white/10 bg-black/45 px-6 py-8 shadow-2xl shadow-orange-950/30 backdrop-blur-xl">
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/50 bg-red-950/70 px-5 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {IS_DEV && (
          <select
            value={roastModel}
            onChange={(e) => setRoastModel(e.target.value as RoastModelId)}
            className="mb-5 w-full rounded-xl border border-orange-300/25 bg-white/10 px-3 py-2 font-mono text-sm text-orange-200 outline-none transition-colors hover:border-orange-300/50"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id} className="bg-gray-950 text-white">
                {m.label}
              </option>
            ))}
          </select>
        )}

        <label className="mb-6 flex max-w-xs cursor-pointer select-none items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.07]">
          <input
            type="checkbox"
            checked={locationConsent}
            onChange={(e) => setLocationConsent(e.target.checked)}
            className="h-5 w-5 flex-shrink-0 cursor-pointer rounded accent-orange-500"
          />
          <span className="text-left text-sm text-white/62 transition-colors">
            Share my location (just for jokes)
          </span>
        </label>

        <div className="mb-8 grid w-full grid-cols-2 rounded-full border border-white/10 bg-white/10 p-1">
          {(["clean", "vulgar"] as ContentMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setContentMode(mode)}
              className={`rounded-full px-5 py-2 text-sm font-bold capitalize transition-all ${
                contentMode === mode
                  ? "bg-orange-100 text-black shadow"
                  : "text-white/50 hover:text-white/85"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {PAYMENTS_ENABLED && (
          <div className="mb-6 w-full rounded-2xl border border-orange-300/20 bg-orange-950/20 p-3 text-left">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-orange-200/70">
                Roast Passes
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70">
                {paymentStatus?.credits ?? 0} credit{(paymentStatus?.credits ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
            {featured && (
              <button
                type="button"
                onClick={() => handleCheckout(featured.sku)}
                disabled={paymentBusy !== null || paymentStatus?.configured === false}
                className="mb-2 w-full rounded-xl bg-orange-100 px-4 py-3 text-left text-black transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
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
                  className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="block font-bold text-white">{formatUsd(product.amountCents)}</span>
                  <span>{product.credits} credit{product.credits === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
            {paymentStatus?.configured === false && (
              <p className="mt-3 text-xs text-red-200/80">Square env vars are missing.</p>
            )}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={paymentBusy !== null}
          className="rounded-2xl bg-orange-600 px-10 py-5 text-2xl font-black text-white shadow-lg shadow-orange-950/50 transition-all hover:-translate-y-0.5 hover:bg-orange-500 active:translate-y-0"
        >
          {paymentBusy === "redeem" ? "Starting..." : "Roast Me"}
        </button>
      </div>
    </div>
  );
}
