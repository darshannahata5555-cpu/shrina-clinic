"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { transferPatientAction } from "../actions";

export function TransferForm({ patientId, currentBranch, branches }: { patientId: string; currentBranch: string; branches: { id: string; name: string }[] }) {
  const dialog = useDialog();
  return (
    <ActionForm action={transferPatientAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={patientId} />
          <p className="text-sm text-ink-2">
            Currently registered at <strong className="font-medium text-ink">{currentBranch}</strong>.
          </p>
          <Field label="Transfer to" required error={fe(s, "toBranchId")}>
            <Select name="toBranchId" required placeholder="Select branch" options={branches.map((b) => [b.id, b.name] as const)} />
          </Field>
          <Field label="Reason" error={fe(s, "reason")}>
            <Textarea name="reason" rows={2} placeholder="e.g. Patient moved closer to the City Centre branch" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Transferring…">Transfer patient</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
