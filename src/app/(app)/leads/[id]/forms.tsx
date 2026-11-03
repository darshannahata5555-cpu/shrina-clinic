"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { STATUS } from "@/lib/status";
import { assignLeadAction, changeStatusAction, convertLeadAction, logActivityAction } from "../actions";

export function ActivityForm({ id }: { id: string }) {
  return (
    <ActionForm action={logActivityAction} resetOnSuccess successMessage="Activity logged">
      {(s) => (
        <div className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
            <Field label="Type" error={fe(s, "type")}>
              <Select name="type" defaultValue="CALL" options={[["CALL", "Phone call"], ["WHATSAPP", "WhatsApp"], ["VISIT", "Clinic visit"], ["EMAIL", "Email"], ["NOTE", "Note"]]} />
            </Field>
            <Field label="What happened?" error={fe(s, "note")}>
              <Input name="note" placeholder="e.g. Shared price list, will confirm Saturday slot" required />
            </Field>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Next follow-up (optional)" error={fe(s, "followUpDate")}>
              <Input name="followUpDate" type="date" className="w-44" />
            </Field>
            <SubmitButton pendingText="Saving…">Log activity</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function StatusForm({ id, status }: { id: string; status: string }) {
  const [next, setNext] = useState(status);
  return (
    <ActionForm action={changeStatusAction} successMessage="Stage updated">
      {(s) => (
        <div className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <Field label="Stage" error={fe(s, "status")}>
            <Select name="status" value={next} onChange={(e) => setNext(e.target.value)} options={Object.entries(STATUS.lead).map(([k, v]) => [k, v[1]] as const)} />
          </Field>
          {next === "LOST" && (
            <Field label="Why was it lost?" required error={fe(s, "reason")}>
              <Select
                name="reason"
                placeholder="Choose a reason"
                options={[
                  ["Price too high", "Price too high"],
                  ["Chose another clinic", "Chose another clinic"],
                  ["Not reachable", "Not reachable"],
                  ["Timing not suitable", "Timing not suitable"],
                  ["Just enquiring", "Just enquiring"],
                  ["Not medically suitable", "Not medically suitable"],
                  ["Other", "Other"],
                ]}
              />
            </Field>
          )}
          <Field label="Note (optional)" error={fe(s, "note")}>
            <Input name="note" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton size="sm" variant={next === "LOST" ? "danger" : "primary"} pendingText="Saving…">
              {next === "LOST" ? "Mark as lost" : "Update stage"}
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function AssignForm({ id, assignedToId, followUpDate, users }: { id: string; assignedToId: string | null; followUpDate: string; users: { id: string; name: string }[] }) {
  return (
    <ActionForm action={assignLeadAction} successMessage="Saved">
      {(s) => (
        <div className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <Field label="Assigned to" error={fe(s, "assignedToId")}>
            <Select name="assignedToId" defaultValue={assignedToId ?? ""} placeholder="Unassigned" options={users.map((u) => [u.id, u.name] as const)} />
          </Field>
          <Field label="Next follow-up" error={fe(s, "followUpDate")}>
            <Input name="followUpDate" type="date" defaultValue={followUpDate} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton size="sm" variant="outline" pendingText="Saving…">
              Save
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function ConvertForm({
  id,
  branchId,
  branches,
  existing,
  canBook,
  canBill,
}: {
  id: string;
  branchId: string;
  branches: { id: string; name: string }[];
  existing: { code: string; fullName: string } | null;
  canBook: boolean;
  canBill: boolean;
}) {
  const dialog = useDialog();
  return (
    <ActionForm action={convertLeadAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
            {existing ? (
              <>
                A patient with this mobile already exists — <strong className="text-ink">{existing.fullName}</strong> ({existing.code}). The lead will be linked to that profile; no duplicate is created.
              </>
            ) : (
              <>A new patient profile will be registered with this lead&apos;s name, mobile, email and source.</>
            )}
          </p>
          {!existing && branches.length > 1 && (
            <Field label="Register at branch" error={fe(s, "branchId")}>
              <Select name="branchId" defaultValue={branchId} options={branches.map((b) => [b.id, b.name] as const)} />
            </Field>
          )}
          <Field label="Move lead to" error={fe(s, "status")}>
            <Select name="status" defaultValue="CONSULTATION_BOOKED" options={[["CONSULTATION_BOOKED", "Consultation booked"], ["TREATMENT_PURCHASED", "Treatment purchased"]]} />
          </Field>
          <Field label="Then" error={fe(s, "next")}>
            <Select
              name="next"
              defaultValue={canBook ? "appointment" : "patient"}
              options={[
                ...(canBook ? ([["appointment", "Book an appointment"]] as const) : []),
                ...(canBill ? ([["invoice", "Create an invoice"]] as const) : []),
                ["patient", "Open the patient profile"],
                ["stay", "Stay on this lead"],
              ]}
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Converting…">Convert to patient</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
