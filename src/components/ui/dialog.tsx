"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

const Ctx = createContext<{ close: () => void } | null>(null);

/** Call inside dialog content (e.g. ActionForm onSuccess) to close it. */
export function useDialog() {
  return useContext(Ctx);
}

/**
 * Modal built on native <dialog>. `trigger` is rendered as a button-like element that opens it.
 * Children may be a function receiving `close`.
 */
export function Dialog({
  trigger,
  title,
  description,
  children,
  size = "md",
}: {
  trigger: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const close = () => el?.close();
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return (
    <>
      <span onClick={() => el?.showModal()} className="contents">
        {trigger}
      </span>
      <dialog
        ref={setEl}
        className={cn(
          "m-auto max-h-[92dvh] w-[calc(100%-24px)] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-ink shadow-pop",
          widths[size],
        )}
        onClick={(e) => {
          if (e.target === el) close();
        }}
      >
        <Ctx.Provider value={{ close }}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h3 className="text-base font-semibold">{title}</h3>
              {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
            </div>
            <button type="button" onClick={close} className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="scroll-thin max-h-[calc(92dvh-70px)] overflow-y-auto px-5 py-5">
            {typeof children === "function" ? children(close) : children}
          </div>
        </Ctx.Provider>
      </dialog>
    </>
  );
}
