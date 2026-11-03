"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { sendTestAction } from "./actions";

export function TestMessageForm() {
  const dialog = useDialog();
  return (
    <ActionForm action={sendTestAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label="Channel" error={fe(s, "channel")}>
              <Select name="channel" defaultValue="WHATSAPP" options={[["WHATSAPP", "WhatsApp"], ["SMS", "SMS"], ["EMAIL", "Email"]]} />
            </Field>
            <Field label="Send to" error={fe(s, "recipient")} hint="Mobile number for WhatsApp/SMS, email address for email">
              <Input name="recipient" placeholder="98765 43210 or name@example.com" required />
            </Field>
          </div>
          <Field label="Message" error={fe(s, "body")}>
            <Textarea name="body" rows={3} defaultValue="Hello from SHRINA! This is a test message from the clinic system." />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Sending…">Send test</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
