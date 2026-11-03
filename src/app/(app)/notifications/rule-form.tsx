"use client";

import { useRef, useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { saveRuleAction } from "./actions";

export type RuleFormValues = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  offsetMinutes: number;
  channels: string[];
  template: string;
};

function splitOffset(min: number) {
  const direction = min < 0 ? "before" : "after";
  const abs = Math.abs(min);
  if (abs === 0) return { amount: 0, unit: "hours", direction };
  if (abs % 1440 === 0) return { amount: abs / 1440, unit: "days", direction };
  if (abs % 60 === 0) return { amount: abs / 60, unit: "hours", direction };
  return { amount: abs, unit: "minutes", direction };
}

const EVENT_OF: Record<string, string> = {
  APPOINTMENT_24H: "the appointment time",
  APPOINTMENT_2H: "the appointment time",
  SESSION_UPCOMING: "the scheduled session",
  FOLLOW_UP: "10:00 AM on the follow-up date",
  PACKAGE_EXPIRY: "the package expiry date",
  POST_TREATMENT: "the completed treatment",
  PRODUCT_REORDER: "",
};

const CHANNELS = [
  ["WHATSAPP", "WhatsApp"],
  ["SMS", "SMS"],
  ["EMAIL", "Email"],
] as const;

export function RuleForm({
  rule,
  placeholders,
  sample,
}: {
  rule: RuleFormValues;
  placeholders: string[];
  sample: Record<string, string>;
}) {
  const init = splitOffset(rule.offsetMinutes);
  const [template, setTemplate] = useState(rule.template);
  const ta = useRef<HTMLTextAreaElement>(null);
  const preview = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => sample[k] ?? `{{${k}}}`);
  const unknown = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => !placeholders.includes(k));
  const isReorder = rule.key === "PRODUCT_REORDER";

  const insert = (k: string) => {
    const el = ta.current;
    const token = `{{${k}}}`;
    if (!el) return setTemplate((t) => t + token);
    const s = el.selectionStart ?? template.length;
    const e = el.selectionEnd ?? template.length;
    const next = template.slice(0, s) + token + template.slice(e);
    setTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };

  return (
    <ActionForm action={saveRuleAction} successMessage="Reminder saved">
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={rule.id} />
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Reminder name" error={fe(s, "name")}>
              <Input name="name" defaultValue={rule.name} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox name="enabled" defaultChecked={rule.enabled} label="Reminder is on" />
            </div>
          </div>

          {isReorder ? (
            <>
              <input type="hidden" name="amount" value="0" />
              <input type="hidden" name="unit" value="hours" />
              <input type="hidden" name="direction" value="after" />
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">
                Sent once a day to staff who manage inventory, for every product at or below its minimum stock level.
              </p>
            </>
          ) : (
            <Field label="When to send" error={fe(s, "amount")} hint={`Relative to ${EVENT_OF[rule.key] ?? "the event"}. Set 0 to send at that moment.`}>
              <div className="flex flex-wrap gap-2">
                <Input name="amount" type="number" min={0} defaultValue={init.amount} className="w-24" />
                <Select name="unit" defaultValue={init.unit} options={[["minutes", "minutes"], ["hours", "hours"], ["days", "days"]]} className="w-32" />
                <Select name="direction" defaultValue={init.direction} options={[["before", "before"], ["after", "after"]]} className="w-28" />
              </div>
            </Field>
          )}

          <Field label="Send via" hint="Patients receive WhatsApp/SMS on their registered mobile and email at their email address (if recorded).">
            <div className="flex flex-wrap gap-4 pt-1">
              {CHANNELS.map(([v, l]) => (
                <Checkbox key={v} name="channels" value={v} defaultChecked={rule.channels.includes(v)} label={l} />
              ))}
            </div>
          </Field>

          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Message" error={fe(s, "template") ?? (unknown.length ? `Unknown placeholder: ${unknown.map((u) => `{{${u}}}`).join(", ")}` : undefined)}>
              <Textarea ref={ta} name="template" rows={5} value={template} onChange={(e) => setTemplate(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {placeholders.map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => insert(p)}
                    className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                  >
                    {`{{${p}}}`}
                  </button>
                ))}
              </div>
            </Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Preview</p>
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="max-w-sm rounded-lg rounded-tl-none bg-surface px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink shadow-card">{preview}</div>
                <p className="mt-2 text-[11px] text-muted">{template.length} characters · sample data</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save reminder</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
