"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, LoaderCircle, TriangleAlert } from "lucide-react";
import { loginAction, verify2faAction } from "./actions";
import { Input, Label } from "@/components/ui/field";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-ink shadow-card transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

function Err({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {msg}
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, null);
  const [state2, action2] = useActionState(verify2faAction, null);
  const [restart, setRestart] = useState(0);
  const needs2fa = state?.ok && state.message === "2fa" && state2?.message !== "restart";

  if (needs2fa) {
    return (
      <form action={action2} className="space-y-4" key={`2fa-${restart}`}>
        <div className="flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-3 text-sm text-ink-2">
          <KeyRound className="h-5 w-5 text-accent" />
          Enter the 6-digit code from your authenticator app.
        </div>
        <Err msg={state2?.error} />
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <Label htmlFor="code">Verification code</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus placeholder="123 456" className="h-11 text-center text-lg tracking-[0.4em]" />
        </div>
        <Submit>Verify & sign in</Submit>
        <button type="button" onClick={() => (setRestart((r) => r + 1), location.reload())} className="w-full text-center text-[13px] text-muted hover:text-ink">
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Err msg={state && !state.ok ? state.error : state2?.message === "restart" ? state2.error : undefined} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus placeholder="you@shrina.in" className="h-11" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
      </div>
      <Submit>Sign in</Submit>
    </form>
  );
}
