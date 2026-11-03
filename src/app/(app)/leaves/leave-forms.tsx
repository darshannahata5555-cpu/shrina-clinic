"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import { requestLeaveAction, reviewLeaveAction } from "./actions";

const TYPES = [
  ["CASUAL", "Casual leave"],
  ["SICK", "Sick leave"],
  ["PAID", "Paid / earned leave"],
  ["UNPAID", "Unpaid leave"],
] as const;

export function LeaveRequestForm({
  staff,
  selfId,
  today,
  balances,
}: {
  staff?: { id: string; label: string }[];
  selfId?: string | null;
  today: string;
  balances?: { type: string; remaining: number | null }[];
}) {
  const dialog = useDialog();
  const [dayType, setDayType] = useState("FULL");
  const [from, setFrom] = useState(today);
  return (
    <ActionForm action={requestLeaveAction} onSuccess={() => dialog?.close()} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          {staff && staff.length > 0 && (
            <Field label="Employee" error={fe(s, "staffId")} hint="Leave on behalf of a team member, or yourself.">
              <Select name="staffId" defaultValue={selfId ?? ""} options={staff.map((x) => [x.id, x.label] as const)} placeholder={selfId ? undefined : "Choose employee…"} required />
            </Field>
          )}
          <FormGrid>
            <Field label="Leave type" required error={fe(s, "type")}>
              <Select
                name="type"
                defaultValue="CASUAL"
                options={TYPES.map(([v, l]) => {
                  const b = balances?.find((x) => x.type === v);
                  return [v, b && b.remaining !== null ? `${l} (${b.remaining} left)` : l] as const;
                })}
              />
            </Field>
            <Field label="Duration" required error={fe(s, "dayType")}>
              <Select
                name="dayType"
                value={dayType}
                onChange={(e) => setDayType(e.target.value)}
                options={[
                  ["FULL", "Full day(s)"],
                  ["HALF", "Half day"],
                ]}
              />
            </Field>
            <Field label={dayType === "HALF" ? "Date" : "From"} required error={fe(s, "fromDate")}>
              <Input name="fromDate" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </Field>
            {dayType === "FULL" && (
              <Field label="To" error={fe(s, "toDate")} hint="Weekly offs & holidays aren't counted.">
                <Input name="toDate" type="date" min={from} defaultValue={from} key={from} />
              </Field>
            )}
          </FormGrid>
          <Field label="Reason" required error={fe(s, "reason")}>
            <Textarea name="reason" rows={2} placeholder="e.g. Fever, family function…" required />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Sending…">Send request</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function ReviewLeaveForm({ id }: { id: string }) {
  const dialog = useDialog();
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  return (
    <ActionForm action={reviewLeaveAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value={decision} />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={decision === "APPROVED" ? "primary" : "outline"} onClick={() => setDecision("APPROVED")}>
              Approve
            </Button>
            <Button type="button" variant={decision === "REJECTED" ? "danger" : "outline"} onClick={() => setDecision("REJECTED")}>
              Reject
            </Button>
          </div>
          <Field label={decision === "REJECTED" ? "Reason for rejecting" : "Note (optional)"} required={decision === "REJECTED"} error={fe(s, "note")}>
            <Textarea name="note" rows={2} />
          </Field>
          <p className="text-xs text-muted">
            {decision === "APPROVED" ? "Attendance for these dates will be marked as leave, and the employee is notified." : "The employee is notified with your reason."}
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…" variant={decision === "REJECTED" ? "danger" : "primary"}>
              {decision === "APPROVED" ? "Approve leave" : "Reject leave"}
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
