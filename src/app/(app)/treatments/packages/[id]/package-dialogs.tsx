"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { cancelPackageAction, updatePackageAction } from "../../actions";

type Opt = readonly (readonly [string, string])[];

export function EditPackageForm({
  values,
  doctors,
  therapists,
  canAdjust,
  completed,
}: {
  values: { id: string; name: string; bodyArea: string | null; doctorId: string | null; therapistId: string | null; notes: string | null; expiryDate: string; totalSessions: number };
  doctors: Opt;
  therapists: Opt;
  canAdjust: boolean;
  completed: number;
}) {
  const dialog = useDialog();
  return (
    <ActionForm action={updatePackageAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={values.id} />
          <Field label="Package name" required error={fe(s, "name")}>
            <Input name="name" defaultValue={values.name} required />
          </Field>
          <FormGrid>
            <Field label="Body area" error={fe(s, "bodyArea")}>
              <Input name="bodyArea" defaultValue={values.bodyArea ?? ""} />
            </Field>
            <div />
            <Field label="Doctor" error={fe(s, "doctorId")}>
              <Select name="doctorId" defaultValue={values.doctorId ?? ""} placeholder="—" options={doctors} />
            </Field>
            <Field label="Therapist" error={fe(s, "therapistId")}>
              <Select name="therapistId" defaultValue={values.therapistId ?? ""} placeholder="—" options={therapists} />
            </Field>
            <Field label="Total sessions" error={fe(s, "totalSessions")} hint={canAdjust ? `${completed} already completed` : "Only authorised staff can change this"}>
              <Input name="totalSessions" type="number" min={Math.max(1, completed)} defaultValue={values.totalSessions} readOnly={!canAdjust} />
            </Field>
            <Field label="Expiry date" error={fe(s, "expiryDate")} hint={canAdjust ? undefined : "Only authorised staff can change this"}>
              <Input name="expiryDate" type="date" defaultValue={values.expiryDate} readOnly={!canAdjust} />
            </Field>
          </FormGrid>
          {canAdjust && (
            <Field label="Reason (required if sessions or expiry change)" error={fe(s, "reason")}>
              <Input name="reason" placeholder="e.g. extension approved — patient was travelling" />
            </Field>
          )}
          <Field label="Treatment notes" error={fe(s, "notes")}>
            <Textarea name="notes" rows={3} defaultValue={values.notes ?? ""} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function CancelPackageForm({ id, remaining }: { id: string; remaining: number }) {
  const dialog = useDialog();
  return (
    <ActionForm action={cancelPackageAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {remaining} unused session{remaining === 1 ? "" : "s"} will be forfeited and any planned sessions/appointments cancelled. Refunds are issued separately from Billing.
          </p>
          <Field label="Reason" required error={fe(s, "reason")}>
            <Textarea name="reason" rows={2} placeholder="e.g. patient relocating — partial refund approved by owner" required />
          </Field>
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel package</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
