"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { setPinAction } from "../actions";

export function PinForm({ id }: { id: string }) {
  const dialog = useDialog();
  return (
    <ActionForm action={setPinAction} onSuccess={() => dialog?.close()} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <p className="text-[13px] text-muted">The employee enters their employee ID and this PIN at the attendance kiosk. Share it privately.</p>
          <Field label="New PIN (4–6 digits)" error={fe(s, "pin")} required>
            <Input name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required />
          </Field>
          <Field label="Confirm PIN" error={fe(s, "confirm")} required>
            <Input name="confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save PIN</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
