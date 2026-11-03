"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { addHolidayAction, saveAttendanceAction } from "./actions";

export type ManualValues = {
  staffId?: string;
  date: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  notes?: string | null;
};

const STATUS_OPTIONS = [
  ["PRESENT", "Present"],
  ["HALF_DAY", "Half day"],
  ["ABSENT", "Absent"],
  ["LEAVE", "On leave"],
  ["WEEK_OFF", "Week off"],
  ["HOLIDAY", "Holiday"],
] as const;

export function ManualAttendanceForm({
  values,
  staff,
  maxDate,
}: {
  values: ManualValues;
  staff?: { id: string; fullName: string; code: string }[];
  maxDate: string;
}) {
  const dialog = useDialog();
  const [status, setStatus] = useState(values.status ?? "PRESENT");
  const worked = status === "PRESENT" || status === "HALF_DAY";
  return (
    <ActionForm action={saveAttendanceAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          {staff ? (
            <Field label="Employee" required error={fe(s, "staffId")}>
              <Select name="staffId" defaultValue={values.staffId ?? ""} placeholder="Choose employee…" options={staff.map((x) => [x.id, `${x.fullName} (${x.code})`] as const)} required />
            </Field>
          ) : (
            <input type="hidden" name="staffId" value={values.staffId} />
          )}
          <FormGrid>
            <Field label="Date" required error={fe(s, "date")}>
              <Input name="date" type="date" defaultValue={values.date} max={maxDate} required />
            </Field>
            <Field label="Status" required error={fe(s, "status")}>
              <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
            </Field>
            {worked && (
              <>
                <Field label="Check-in time" error={fe(s, "checkIn")} hint="Late marks are calculated from the shift.">
                  <Input name="checkIn" type="time" defaultValue={values.checkIn ?? ""} />
                </Field>
                <Field label="Check-out time" error={fe(s, "checkOut")}>
                  <Input name="checkOut" type="time" defaultValue={values.checkOut ?? ""} />
                </Field>
              </>
            )}
          </FormGrid>
          <Field label="Reason / note" error={fe(s, "notes")} hint="Recorded in the activity log, e.g. “Forgot to punch — confirmed by manager”.">
            <Textarea name="notes" rows={2} defaultValue={values.notes ?? ""} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save attendance</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function HolidayForm({ branches, allowAll }: { branches: { id: string; name: string }[]; allowAll: boolean }) {
  return (
    <ActionForm action={addHolidayAction} resetOnSuccess>
      {(s) => (
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[150px_1fr_200px_auto]">
          <Field label="Date" error={fe(s, "date")}>
            <Input name="date" type="date" required />
          </Field>
          <Field label="Holiday name" error={fe(s, "name")}>
            <Input name="name" placeholder="e.g. Diwali" required />
          </Field>
          <Field label="Applies to" error={fe(s, "branchId")}>
            <Select name="branchId" options={branches.map((b) => [b.id, b.name] as const)} placeholder={allowAll ? "All branches" : undefined} defaultValue={allowAll ? "" : branches[0]?.id} />
          </Field>
          <SubmitButton pendingText="Adding…">Add holiday</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
