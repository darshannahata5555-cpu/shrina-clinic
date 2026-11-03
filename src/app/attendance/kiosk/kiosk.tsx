"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Delete, LoaderCircle, Lock, LogIn, LogOut, ScanLine, X } from "lucide-react";
import { cn } from "@/lib/format";
import { kioskBadgeAction, kioskPunchAction, lockKioskAction, unlockKioskAction, type KioskState } from "./actions";

/* ───────────── Setup (manager registers the device) ───────────── */

export function KioskSetup({ branches }: { branches: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(unlockKioskAction, null as KioskState);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <label className="block text-[13px] font-medium text-ink-2">
        Branch for this device
        <select name="branchId" required className="mt-1.5 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">The device stays registered for a year. You can sign out afterwards — staff don&apos;t need to log in to use the kiosk.</p>
      <button disabled={pending} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-60">
        {pending && <LoaderCircle className="h-4 w-4 animate-spin" />} Start kiosk
      </button>
    </form>
  );
}

/* ───────────── Kiosk ───────────── */

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => (clearTimeout(first), clearInterval(t));
  }, []);
  const time = now ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(now) : "";
  const date = now ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(now) : "";
  return (
    <div>
      <p className="tabular text-6xl font-semibold tracking-tight text-ink sm:text-7xl" suppressHydrationWarning>
        {time.toUpperCase() || " "}
      </p>
      <p className="mt-2 text-lg text-muted" suppressHydrationWarning>
        {date || " "}
      </p>
    </div>
  );
}

function PhoneQr() {
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/attendance/kiosk", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (!alive) return;
        setQr(j.dataUrl);
        setErr(false);
        timer = setTimeout(load, (j.refreshInSeconds ?? 60) * 1000);
      } catch {
        if (!alive) return;
        setErr(true);
        timer = setTimeout(load, 15000);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
      <div className="grid h-32 w-32 shrink-0 place-items-center rounded-lg bg-white p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr ? <img src={qr} alt="Scan to check in with your phone" className="h-full w-full" /> : <LoaderCircle className="h-6 w-6 animate-spin text-muted" />}
      </div>
      <div className="text-sm text-ink-2">
        <p className="font-semibold text-ink">Check in with your phone</p>
        <p className="mt-1 text-[13px] text-muted">Scan with your phone camera while signed in to SHRINA. The code changes every minute.</p>
        {err && <p className="mt-1 text-xs text-danger">Couldn&apos;t refresh the code — retrying…</p>}
      </div>
    </div>
  );
}

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function BadgeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const hit = codes.find((c) => c.rawValue.startsWith("SHRINA-ATT:"));
            if (hit) return onCode(hit.rawValue);
          } catch {}
          raf = window.setTimeout(tick, 300) as unknown as number;
        };
        tick();
      } catch {
        setError("Camera not available. Use your employee ID and PIN instead.");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-semibold">Hold your ID badge up to the camera</p>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-3" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {error ? <p className="rounded-lg bg-danger-soft p-4 text-danger">{error}</p> : <video ref={video} playsInline muted className="aspect-video w-full rounded-xl bg-black object-cover" />}
      </div>
    </div>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export function Kiosk({ branchName, pinEnabled, qrEnabled, canLock }: { branchName: string; pinEnabled: boolean; qrEnabled: boolean; canLock: boolean }) {
  const [step, setStep] = useState<"code" | "pin">("code");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [state, punchAction, punching] = useActionState(kioskPunchAction, null as KioskState);
  const [badgeState, badgeAction, badging] = useActionState(kioskBadgeAction, null as KioskState);
  const [source, setSource] = useState<"pin" | "badge">("pin");
  const [dismissed, setDismissed] = useState<KioskState>(null);
  const [scanning, setScanning] = useState(false);
  const [badgeSupported, setBadgeSupported] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const busy = punching || badging;

  useEffect(() => {
    const t = setTimeout(() => setBadgeSupported("BarcodeDetector" in window && !!navigator.mediaDevices), 0);
    return () => clearTimeout(t);
  }, []);

  // The result screen shows the latest response until it is dismissed (button or 5–6 s timeout).
  const latest = source === "badge" ? badgeState : state;
  const shown = latest && latest !== dismissed && !busy ? latest : null;

  /** After success start over; after an error keep the employee ID and ask for the PIN again. */
  const reset = useCallback(() => {
    setDismissed(latest);
    if (!latest || latest.ok || source === "badge") {
      setStep("code");
      setCode("");
    } else setStep("pin");
    setPin("");
  }, [latest, source]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(reset, shown.ok ? 5000 : 6000);
    return () => clearTimeout(t);
  }, [shown, reset]);

  const submit = useCallback(() => {
    const fd = new FormData();
    fd.set("code", code);
    fd.set("pin", pin);
    fd.set("mode", "auto");
    setSource("pin");
    setPin("");
    start(() => punchAction(fd));
  }, [code, pin, punchAction]);

  const press = useCallback(
    (k: string) => {
      if (k === "clear") return step === "code" ? setCode("") : setPin("");
      if (k === "back") return step === "code" ? setCode((c) => c.slice(0, -1)) : pin ? setPin((p) => p.slice(0, -1)) : setStep("code");
      if (step === "code") setCode((c) => (c.length < 4 ? c + k : c));
      else setPin((p) => (p.length < 6 ? p + k : p));
    },
    [step, pin],
  );

  // Physical keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (scanning || busy) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Escape") reset();
      else if (e.key === "Enter") {
        if (step === "code" && code) setStep("pin");
        else if (step === "pin" && pin.length >= 4) submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, reset, submit, step, code, pin, scanning, busy]);

  const onBadge = useCallback(
    (raw: string) => {
      setScanning(false);
      setSource("badge");
      const fd = new FormData();
      fd.set("badge", raw);
      start(() => badgeAction(fd));
    },
    [badgeAction],
  );

  const r = shown?.ok ? shown.result : null;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto grid min-h-dvh max-w-6xl gap-8 px-5 py-6 sm:px-8 md:grid-cols-[1.1fr_1fr] md:items-center md:py-10">
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-base font-bold text-accent-ink">S</span>
            <div>
              <p className="text-sm font-semibold tracking-[0.25em]">SHRINA</p>
              <p className="text-[13px] text-muted">{branchName} · Attendance</p>
            </div>
          </div>
          <Clock />
          {qrEnabled && <PhoneQr />}
          {qrEnabled && badgeSupported && (
            <button onClick={() => setScanning(true)} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-border-strong bg-surface text-base font-medium hover:bg-surface-2">
              <ScanLine className="h-5 w-5" /> Scan ID badge
            </button>
          )}
          {canLock && (
            <button
              onClick={() =>
                start(async () => {
                  if (!confirm("Remove this device as the attendance kiosk?")) return;
                  await lockKioskAction();
                  router.refresh();
                })
              }
              className="inline-flex w-fit items-center gap-1.5 text-xs text-muted hover:text-ink"
            >
              <Lock className="h-3.5 w-3.5" /> Remove kiosk from this device
            </button>
          )}
        </section>

        <section className="relative rounded-3xl border border-border bg-surface p-5 shadow-pop sm:p-7">
          {shown ? (
            <div className="flex min-h-[460px] flex-col items-center justify-center text-center">
              {shown.ok && r ? (
                <>
                  <span className={cn("grid h-20 w-20 place-items-center rounded-full", r.kind === "out" ? "bg-info-soft text-info" : "bg-success-soft text-success")}>
                    {r.kind === "out" ? <LogOut className="h-10 w-10" /> : <LogIn className="h-10 w-10" />}
                  </span>
                  <p className="mt-5 text-2xl font-semibold">
                    {r.kind === "out" ? "Goodbye" : "Welcome"}, {r.name.replace(/^Dr\.\s*/, "Dr. ").split(" ").slice(0, 2).join(" ")}
                  </p>
                  <p className="mt-2 text-lg text-ink-2">
                    {r.kind === "in" && `Checked in at ${r.time}`}
                    {r.kind === "already-in" && `You checked in earlier at ${r.time}`}
                    {r.kind === "out" && `Checked out at ${r.time} · ${Math.floor(r.workMinutes / 60)}h ${r.workMinutes % 60}m today`}
                  </p>
                  {r.kind === "in" && r.lateMinutes > 0 && <p className="mt-3 rounded-full bg-warning-soft px-4 py-1.5 text-sm font-medium text-warning">{r.lateMinutes} minutes late today</p>}
                  {r.kind === "already-in" && <p className="mt-3 text-sm text-muted">Enter your PIN again later to check out.</p>}
                </>
              ) : (
                <>
                  <span className="grid h-20 w-20 place-items-center rounded-full bg-danger-soft text-danger">
                    <CircleX className="h-10 w-10" />
                  </span>
                  <p className="mt-5 max-w-sm text-lg font-medium text-ink">{shown.error}</p>
                </>
              )}
              <button onClick={reset} className="mt-8 h-12 rounded-xl border border-border-strong px-6 text-base font-medium hover:bg-surface-2">
                {shown.ok ? "Done" : "Try again"}
              </button>
            </div>
          ) : !pinEnabled ? (
            <div className="flex min-h-[460px] flex-col items-center justify-center text-center text-ink-2">
              <CircleCheck className="h-10 w-10 text-muted" />
              <p className="mt-4 text-lg">PIN check-in is turned off.</p>
              <p className="mt-1 text-sm text-muted">Use the QR code or your ID badge.</p>
            </div>
          ) : (
            <div>
              <p className="text-center text-sm font-medium text-muted">{step === "code" ? "Step 1 of 2" : "Step 2 of 2"}</p>
              <p className="mt-1 text-center text-xl font-semibold">{step === "code" ? "Enter your employee ID" : "Enter your PIN"}</p>
              <div className="mx-auto mt-5 flex h-16 max-w-xs items-center justify-center rounded-2xl bg-surface-2 text-3xl font-semibold tracking-[0.2em]">
                {step === "code" ? (
                  <span className="tabular">
                    <span className="text-muted">EMP-</span>
                    {code || <span className="text-muted/50">___</span>}
                  </span>
                ) : (
                  <span className="flex gap-3">
                    {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                      <span key={i} className={cn("h-4 w-4 rounded-full", i < pin.length ? "bg-ink" : "bg-border-strong")} />
                    ))}
                  </span>
                )}
              </div>
              <div className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-3">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    disabled={busy}
                    onClick={() => press(k)}
                    className={cn(
                      "grid h-16 place-items-center rounded-2xl text-2xl font-semibold transition-colors active:scale-[0.97] disabled:opacity-50",
                      k === "clear" || k === "back" ? "bg-surface-3 text-base text-ink-2 hover:bg-border" : "bg-surface-2 text-ink hover:bg-surface-3",
                    )}
                    aria-label={k === "back" ? "Backspace" : k === "clear" ? "Clear" : k}
                  >
                    {k === "back" ? <Delete className="h-6 w-6" /> : k === "clear" ? "Clear" : k}
                  </button>
                ))}
              </div>
              <div className="mx-auto mt-5 max-w-xs">
                {step === "code" ? (
                  <button disabled={!code || busy} onClick={() => setStep("pin")} className="h-14 w-full rounded-2xl bg-ink text-lg font-semibold text-bg disabled:opacity-40">
                    Next
                  </button>
                ) : (
                  <div className="grid grid-cols-[auto_1fr] gap-3">
                    <button onClick={() => (setStep("code"), setPin(""))} className="h-14 rounded-2xl border border-border-strong px-4 text-base font-medium hover:bg-surface-2">
                      Back
                    </button>
                    <button disabled={pin.length < 4 || busy} onClick={submit} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-accent text-lg font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40">
                      {busy && <LoaderCircle className="h-5 w-5 animate-spin" />} Check in / out
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      {scanning && <BadgeScanner onCode={onBadge} onClose={() => setScanning(false)} />}
    </main>
  );
}
