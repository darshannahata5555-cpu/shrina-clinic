"use client";

import { ActionButton, ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input } from "@/components/ui/field";
import {
  cancel2faSetupAction, changePasswordAction, confirm2faAction, disable2faAction, start2faAction, updateProfileAction,
} from "./actions";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  return (
    <ActionForm action={updateProfileAction}>
      {(s) => (
        <div className="space-y-4">
          <FormGrid>
            <Field label="Name" error={fe(s, "name")}>
              <Input name="name" defaultValue={name} required />
            </Field>
            <Field label="Mobile" error={fe(s, "phone")}>
              <Input name="phone" defaultValue={phone ?? ""} />
            </Field>
          </FormGrid>
          <div className="flex justify-end">
            <SubmitButton variant="outline">Save profile</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          <Field label="Current password" error={fe(s, "current")}>
            <Input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <FormGrid>
            <Field label="New password" hint="8+ characters with a letter and a number" error={fe(s, "next")}>
              <Input name="next" type="password" autoComplete="new-password" required />
            </Field>
            <Field label="Confirm new password" error={fe(s, "confirm")}>
              <Input name="confirm" type="password" autoComplete="new-password" required />
            </Field>
          </FormGrid>
          <div className="flex justify-end">
            <SubmitButton pendingText="Updating…">Change password</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function TwoFactor({ enabled, pendingQr, secret }: { enabled: boolean; pendingQr: string | null; secret: string | null }) {
  if (enabled) {
    return (
      <ActionForm action={disable2faAction} resetOnSuccess>
        <p className="mb-3 text-[13px] text-ink-2">To turn it off, enter a current code from your authenticator app.</p>
        <div className="flex items-end gap-2">
          <Field label="Code" className="w-40">
            <Input name="code" inputMode="numeric" maxLength={7} placeholder="123456" required />
          </Field>
          <SubmitButton variant="outline">Turn off 2FA</SubmitButton>
        </div>
      </ActionForm>
    );
  }
  if (pendingQr) {
    return (
      <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pendingQr} alt="Scan with your authenticator app" width={220} height={220} className="rounded-xl border border-border bg-white p-2" />
        <div className="space-y-3 text-[13px] text-ink-2">
          <ol className="list-decimal space-y-1 pl-4">
            <li>Open Google Authenticator, Microsoft Authenticator or Authy.</li>
            <li>Scan this QR code (or enter the key below).</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          <p className="break-all rounded-md bg-surface-3 px-2 py-1.5 font-mono text-xs text-ink">{secret}</p>
          <ActionForm action={confirm2faAction}>
            <div className="flex items-end gap-2">
              <Field label="6-digit code" className="w-40">
                <Input name="code" inputMode="numeric" maxLength={7} placeholder="123456" autoFocus required />
              </Field>
              <SubmitButton>Verify & turn on</SubmitButton>
            </div>
          </ActionForm>
          <ActionButton action={cancel2faSetupAction} variant="ghost">
            Cancel setup
          </ActionButton>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-ink-2">Add a second step to sign-in using an authenticator app on your phone. Strongly recommended for owners, managers and accounts.</p>
      <ActionButton action={start2faAction} variant="primary" size="md">
        Set up 2FA
      </ActionButton>
    </div>
  );
}
