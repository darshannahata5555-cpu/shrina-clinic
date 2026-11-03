"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import {
  adjustSessionAction,
  completeSessionAction,
  markSessionAction,
  updateSessionNotesAction,
  walkInSessionAction,
} from "./actions";

type Opt = readonly (readonly [string, string])[];

export function CompleteSessionForm({
  sessionId,
  doctorId,
  therapistId,
  doctors,
  therapists,
  nowLocal,
}: {
  sessionId: string;
  doctorId?: string | null;
  therapistId?: string | null;
  doctors: Opt;
  therapists: Opt;
  nowLocal: string;
}) {
  const dialog = useDialog();
  return (
    <ActionForm action={completeSessionAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <FormGrid>
            <Field label="Done on" error={fe(s, "performedAt")} hint="Leave as is if it was just now">
              <Input type="datetime-local" name="performedAt" defaultValue={nowLocal} max={nowLocal} />
            </Field>
            <div />
            <Field label="Doctor" error={fe(s, "doctorId")}>
              <Select name="doctorId" defaultValue={doctorId ?? ""} placeholder="—" options={doctors} />
            </Field>
            <Field label="Therapist" error={fe(s, "therapistId")}>
              <Select name="therapistId" defaultValue={therapistId ?? ""} placeholder="—" options={therapists} />
            </Field>
          </FormGrid>
          <Field label="Treatment notes">
            <Textarea name="notes" rows={2} placeholder="Settings / fluence, areas treated…" />
          </Field>
          <Field label="Observations">
            <Textarea name="observations" rows={2} placeholder="Skin response, patient feedback…" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Mark session done</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function MarkSessionForm({ sessionId, status }: { sessionId: string; status: "MISSED" | "CANCELLED" }) {
  const dialog = useDialog();
  return (
    <ActionForm action={markSessionAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="status" value={status} />
          <Field label="Reason" error={fe(s, "reason")}>
            <Input name="reason" placeholder={status === "MISSED" ? "e.g. not reachable, didn't come" : "e.g. patient unwell, skin irritation — postponed"} />
          </Field>
          <p className="text-[13px] text-muted">This does not use up a session from the package.</p>
          <div className="flex justify-end">
            <SubmitButton variant={status === "CANCELLED" ? "danger" : "primary"} pendingText="Saving…">
              {status === "MISSED" ? "Mark missed" : "Cancel session"}
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function SessionNotesForm({ sessionId, notes, observations }: { sessionId: string; notes: string | null; observations: string | null }) {
  const dialog = useDialog();
  return (
    <ActionForm action={updateSessionNotesAction} onSuccess={() => dialog?.close()}>
      <div className="space-y-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <Field label="Treatment notes">
          <Textarea name="notes" rows={3} defaultValue={notes ?? ""} />
        </Field>
        <Field label="Observations">
          <Textarea name="observations" rows={3} defaultValue={observations ?? ""} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingText="Saving…">Save notes</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function AdjustSessionForm({ sessionId, current }: { sessionId: string; current: string }) {
  const dialog = useDialog();
  const options = (
    [
      ["COMPLETED", "Completed (counts as a used session)"],
      ["CANCELLED", "Cancelled (session not used)"],
      ["MISSED", "Missed (session not used)"],
    ] as const
  ).filter(([k]) => k !== current);
  return (
    <ActionForm action={adjustSessionAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <Field label="Correct status to" required error={fe(s, "status")}>
            <Select name="status" options={options} placeholder="Choose" required />
          </Field>
          <Field label="Reason for adjustment" required error={fe(s, "reason")} hint="Recorded permanently in the session history and activity log.">
            <Textarea name="reason" rows={2} placeholder="e.g. marked done by mistake — patient left before treatment" required />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save adjustment</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function WalkInSessionForm({
  packageId,
  doctorId,
  therapistId,
  doctors,
  therapists,
  nowLocal,
}: {
  packageId: string;
  doctorId?: string | null;
  therapistId?: string | null;
  doctors: Opt;
  therapists: Opt;
  nowLocal: string;
}) {
  const dialog = useDialog();
  return (
    <ActionForm action={walkInSessionAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="packageId" value={packageId} />
          <Field label="Done on" required error={fe(s, "performedAt")}>
            <Input type="datetime-local" name="performedAt" defaultValue={nowLocal} max={nowLocal} required />
          </Field>
          <FormGrid>
            <Field label="Doctor" error={fe(s, "doctorId")}>
              <Select name="doctorId" defaultValue={doctorId ?? ""} placeholder="—" options={doctors} />
            </Field>
            <Field label="Therapist" error={fe(s, "therapistId")}>
              <Select name="therapistId" defaultValue={therapistId ?? ""} placeholder="—" options={therapists} />
            </Field>
          </FormGrid>
          <Field label="Treatment notes">
            <Textarea name="notes" rows={2} />
          </Field>
          <Field label="Observations">
            <Textarea name="observations" rows={2} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Record session</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
