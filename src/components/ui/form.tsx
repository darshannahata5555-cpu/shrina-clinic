"use client";

import { useActionState, useEffect, useRef, type ReactNode, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/format";
import { toast } from "./toast";

export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
} | null;

type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action via useActionState.
 * - Shows the error banner and per-field errors (via render-prop `children(state)`)
 * - On success: toasts `successMessage`/state.message, optionally resets, refreshes, or calls onSuccess.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
  onSuccess,
  refresh = true,
  id,
  encType,
}: {
  action: ServerAction;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
  refresh?: boolean;
  id?: string;
  encType?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const lastHandled = useRef<ActionState>(null);

  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) {
      const msg = state.message ?? successMessage;
      if (msg) toast(msg, "success");
      if (resetOnSuccess) ref.current?.reset();
      if (refresh) router.refresh();
      onSuccess?.(state);
    }
  }, [state, successMessage, resetOnSuccess, refresh, router, onSuccess]);

  return (
    <form ref={ref} action={formAction} className={className} id={id} encType={encType}>
      {state && !state.ok && state.error && <FormError message={state.error} />}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
  className,
  variant,
  size,
  ...p
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || p.disabled} className={cn(className)} variant={variant} size={size} {...p}>
      {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/**
 * One-click action button (e.g. "Approve", "Mark completed", "Delete") posting hidden fields
 * to a server action, with optional confirm() prompt.
 */
export function ActionButton({
  action,
  fields,
  children,
  confirm: confirmText,
  variant = "outline",
  size = "sm",
  className,
  successMessage,
  title,
}: {
  action: ServerAction;
  fields?: Record<string, string | number | null | undefined>;
  children: ReactNode;
  confirm?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  successMessage?: string;
  title?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const lastHandled = useRef<ActionState>(null);
  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) {
      const msg = state.message ?? successMessage;
      if (msg) toast(msg, "success");
      router.refresh();
    } else if (state.error) toast(state.error, "error");
  }, [state, successMessage, router]);

  return (
    <form
      action={formAction}
      className="inline"
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {fields &&
        Object.entries(fields).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
      <SubmitButton variant={variant} size={size} className={className} title={title}>
        {children}
      </SubmitButton>
    </form>
  );
}

/** Helper to read a field error from state. */
export function fe(state: ActionState, name: string) {
  return state?.fieldErrors?.[name];
}
