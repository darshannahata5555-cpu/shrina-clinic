"use client";

import { TriangleAlert } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { cancelAppointmentAction, completeAppointmentAction, rescheduleAppointmentAction } from "../actions";

export function CancelAppointmentForm({ id }: { id: string }) {
  const dialog = useDialog();
  return (
    <ActionForm action={cancelAppointmentAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Field label="Reason for cancellation" required error={fe(s, "reason")}>
            <Select
              name="reason"
              placeholder="Choose a reason"
              required
              options={[
                ["Patient requested", "Patient requested"],
                ["Patient unwell", "Patient unwell"],
                ["Clinic rescheduling / doctor unavailable", "Clinic rescheduling / doctor unavailable"],
                ["Booked by mistake", "Booked by mistake"],
                ["Other", "Other"],
              ]}
            />
          </Field>
          <p className="text-[13px] text-muted">A linked package session is recorded as cancelled — it does not use up a session.</p>
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel appointment</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function CompleteAppointmentForm({ id, hasPackage }: { id: string; hasPackage: boolean }) {
  const dialog = useDialog();
  return (
    <ActionForm action={completeAppointmentAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
            {hasPackage
              ? "This uses one session of the patient's package. Remaining sessions and product stock update automatically."
              : "A completed treatment session is added to the patient's history and product usage is deducted from stock."}
          </p>
          <Field label="Treatment notes" error={fe(s, "notes")}>
            <Textarea name="notes" rows={2} placeholder="Settings used, areas treated…" />
          </Field>
          <Field label="Observations" error={fe(s, "observations")}>
            <Textarea name="observations" rows={2} placeholder="Skin response, patient feedback, next-session advice…" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Mark completed</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RescheduleForm({
  id,
  date,
  time,
  doctorId,
  therapistId,
  doctors,
  therapists,
}: {
  id: string;
  date: string;
  time: string;
  doctorId: string | null;
  therapistId: string | null;
  doctors: readonly (readonly [string, string])[];
  therapists: readonly (readonly [string, string])[];
}) {
  return (
    <ActionForm action={rescheduleAppointmentAction}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <FormGrid>
            <Field label="New date" required error={fe(s, "date")}>
              <Input type="date" name="date" defaultValue={date} required />
            </Field>
            <Field label="New time" required error={fe(s, "time")}>
              <Input type="time" name="time" step={900} defaultValue={time} required />
            </Field>
            <Field label="Doctor" error={fe(s, "doctorId")}>
              <Select name="doctorId" defaultValue={doctorId ?? ""} placeholder="No doctor" options={doctors} />
            </Field>
            <Field label="Therapist" error={fe(s, "therapistId")}>
              <Select name="therapistId" defaultValue={therapistId ?? ""} placeholder="No therapist" options={therapists} />
            </Field>
          </FormGrid>
          <Field label="Reason" error={fe(s, "reason")}>
            <Input name="reason" placeholder="e.g. patient travelling, asked for evening slot" />
          </Field>
          {fe(s, "_warn") && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-3 text-sm text-warning">
              <p className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {fe(s, "_warn")}
              </p>
              <Checkbox name="override" label="I've checked — reschedule anyway" className="mt-2.5 text-ink-2" />
            </div>
          )}
          <p className="text-[13px] text-muted">The current slot is kept in history as “Rescheduled” and a new appointment is created.</p>
          <div className="flex justify-end">
            <SubmitButton pendingText="Rescheduling…">Reschedule</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
