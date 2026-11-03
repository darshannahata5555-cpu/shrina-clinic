"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { cn } from "@/lib/format";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };

const EVENT = "shrina:toast";

/** Show a toast from any client component. */
export function toast(message: string, tone: ToastTone = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent).detail as { message: string; tone: ToastTone };
      const id = ++n;
      setItems((xs) => [...xs.slice(-3), { id, message, tone }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "error" ? 6000 : message.length > 60 ? 15000 : 3500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3 text-sm text-ink shadow-pop",
          )}
        >
          {t.tone === "success" ? (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : t.tone === "error" ? (
            <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          )}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="text-muted hover:text-ink" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
