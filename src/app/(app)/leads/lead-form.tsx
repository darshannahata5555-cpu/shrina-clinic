"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { LEAD_SOURCES, STATUS } from "@/lib/status";
import { istDateKey } from "@/lib/format";
import { moveLeadAction, saveLeadAction } from "./actions";

export type LeadFormValues = {
  id?: string;
  name?: string;
  mobile?: string;
  email?: string | null;
  interestedTreatment?: string | null;
  enquiryDate?: string;
  source?: string;
  branchId?: string;
  assignedToId?: string | null;
  followUpDate?: string | null;
  notes?: string | null;
  estimatedValue?: number | null;
};

type Dupes = { patients: { id: string; code: string; fullName: string; branch: string }[]; leads: { id: string; code: string; name: string; status: string }[] };

export function LeadForm({
  values = {},
  branches,
  users,
  treatments,
  currentUserId,
}: {
  values?: LeadFormValues;
  branches: { id: string; name: string }[];
  users: { id: string; name: string; role: string }[];
  treatments: string[];
  currentUserId: string;
}) {
  const dialog = useDialog();
  const router = useRouter();
  const [mobile, setMobile] = useState(values.mobile ?? "");
  const [check, setCheck] = useState<{ mobile: string; dupes: Dupes } | null>(null);
  const digits = mobile.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

  useEffect(() => {
    if (digits.length !== 10) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/leads/check?mobile=${digits}${values.id ? `&excludeId=${values.id}` : ""}`, { signal: ctrl.signal });
        if (r.ok) setCheck({ mobile: digits, dupes: await r.json() });
      } catch {}
    }, 250);
    return () => (clearTimeout(t), ctrl.abort());
  }, [digits, values.id]);

  const dupes = check && check.mobile === digits ? check.dupes : null;
  const hasDupes = dupes && (dupes.patients.length > 0 || dupes.leads.length > 0);

  return (
    <ActionForm
      action={saveLeadAction}
      resetOnSuccess={!values.id}
      onSuccess={(s) => {
        dialog?.close();
        if (!values.id && s?.id) router.push(`/leads/${s.id}`);
      }}
    >
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Name" required error={fe(s, "name")}>
              <Input name="name" defaultValue={values.name} required autoFocus />
            </Field>
            <Field label="Mobile number" required error={fe(s, "mobile")}>
              <Input name="mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" placeholder="98765 43210" required />
            </Field>
          </FormGrid>
          {hasDupes && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <TriangleAlert className="h-4 w-4" /> This number already exists
              </p>
              <ul className="mt-1 space-y-0.5 text-ink-2">
                {dupes!.patients.map((p) => (
                  <li key={p.id}>
                    Patient{" "}
                    <Link href={`/patients/${p.id}`} className="font-medium text-ink underline" target="_blank">
                      {p.fullName}
                    </Link>{" "}
                    ({p.code} · {p.branch}) — converting will link to this patient.
                  </li>
                ))}
                {dupes!.leads.map((l) => (
                  <li key={l.id}>
                    Open lead{" "}
                    <Link href={`/leads/${l.id}`} className="font-medium text-ink underline" target="_blank">
                      {l.name}
                    </Link>{" "}
                    ({l.code} · {STATUS.lead[l.status as keyof typeof STATUS.lead]?.[1] ?? l.status})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FormGrid>
            <Field label="Email" error={fe(s, "email")}>
              <Input name="email" type="email" defaultValue={values.email ?? ""} />
            </Field>
            <Field label="Interested in" error={fe(s, "interestedTreatment")}>
              <Input name="interestedTreatment" list="lead-treatments" defaultValue={values.interestedTreatment ?? ""} placeholder="e.g. Laser Hair Reduction" />
              <datalist id="lead-treatments">
                {treatments.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Lead source" required error={fe(s, "source")}>
              <Select name="source" defaultValue={values.source ?? "INSTAGRAM"} options={LEAD_SOURCES} />
            </Field>
            <Field label="Enquiry date" required error={fe(s, "enquiryDate")}>
              <Input name="enquiryDate" type="date" defaultValue={values.enquiryDate ?? istDateKey()} required />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" required error={fe(s, "branchId")}>
                <Select name="branchId" defaultValue={values.branchId ?? branches[0]?.id} options={branches.map((b) => [b.id, b.name] as const)} />
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={values.branchId ?? branches[0]?.id ?? ""} />
            )}
            <Field label="Assigned to" error={fe(s, "assignedToId")}>
              <Select name="assignedToId" defaultValue={values.assignedToId ?? (values.id ? "" : currentUserId)} placeholder="Unassigned" options={users.map((u) => [u.id, `${u.name} · ${u.role}`] as const)} />
            </Field>
            <Field label="Next follow-up" error={fe(s, "followUpDate")}>
              <Input name="followUpDate" type="date" defaultValue={values.followUpDate ?? ""} />
            </Field>
            <Field label="Estimated value (₹)" error={fe(s, "estimatedValue")}>
              <Input name="estimatedValue" type="number" min={0} step="100" defaultValue={values.estimatedValue ?? ""} />
            </Field>
          </FormGrid>
          <Field label="Notes" error={fe(s, "notes")}>
            <Textarea name="notes" defaultValue={values.notes ?? ""} rows={2} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Add lead"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

/** Stage dropdown on pipeline cards. */
export function MoveLeadSelect({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const opts = (["NEW", "CONTACTED", "CONSULTATION_BOOKED", "TREATMENT_PURCHASED", "FOLLOW_UP"] as const).map((k) => [k, STATUS.lead[k][1]] as const);
  return (
    <select
      aria-label="Move to stage"
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          const r = await moveLeadAction(id, next);
          if (r?.ok) {
            if (r.message) toast(r.message, "success");
            router.refresh();
          } else if (r?.error) toast(r.error, "error");
        });
      }}
      className="h-7 max-w-full rounded-md border border-border bg-surface-2 px-1.5 text-[12px] text-ink-2 focus:border-accent focus:outline-none disabled:opacity-60"
    >
      {status === "LOST" && <option value="LOST">Lost</option>}
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
