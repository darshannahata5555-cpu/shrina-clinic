"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { saveUserAction } from "../actions";

type Opt = { id: string; name: string };

export function UserForm({
  roles,
  branches,
  staff,
  values,
}: {
  roles: Opt[];
  branches: Opt[];
  staff: (Opt & { linked: boolean })[];
  values?: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    roleId: string;
    branchId: string | null;
    allBranches: boolean;
    extraBranchIds: string[];
    staffId: string | null;
  };
}) {
  const dialog = useDialog();
  const router = useRouter();
  const [all, setAll] = useState(values?.allBranches ?? false);
  const [primary, setPrimary] = useState(values?.branchId ?? branches[0]?.id ?? "");
  return (
    <ActionForm
      action={saveUserAction}
      resetOnSuccess={!values}
      onSuccess={(s) => {
        dialog?.close();
        if (!values && s?.id) router.push(`/settings/users/${s.id}`);
      }}
    >
      {(s) => (
        <div className="space-y-4">
          {values && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Full name" required error={fe(s, "name")}>
              <Input name="name" defaultValue={values?.name} required />
            </Field>
            <Field label="Email (sign-in ID)" required error={fe(s, "email")}>
              <Input name="email" type="email" defaultValue={values?.email} required />
            </Field>
            <Field label="Mobile" error={fe(s, "phone")}>
              <Input name="phone" defaultValue={values?.phone ?? ""} />
            </Field>
            <Field label="Role" required error={fe(s, "roleId")}>
              <Select name="roleId" defaultValue={values?.roleId} options={roles.map((r) => [r.id, r.name] as const)} required />
            </Field>
            <Field label="Linked employee" hint="Connects attendance, leave and 'my schedule' to this login" error={fe(s, "staffId")}>
              <Select
                name="staffId"
                defaultValue={values?.staffId ?? ""}
                placeholder="— None —"
                options={staff.filter((x) => !x.linked || x.id === values?.staffId).map((x) => [x.id, x.name] as const)}
              />
            </Field>
            {!values && (
              <Field label="Initial password" hint="Leave blank to generate one" error={fe(s, "password")}>
                <Input name="password" type="text" autoComplete="new-password" minLength={8} />
              </Field>
            )}
          </FormGrid>
          <div className="rounded-lg border border-border p-3.5">
            <p className="mb-2.5 text-[13px] font-medium text-ink-2">Branch access</p>
            <Checkbox name="allBranches" label="All branches (owner-level view)" checked={all} onChange={(e) => setAll(e.target.checked)} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Primary branch" error={fe(s, "branchId")}>
                <Select name="branchId" value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder={all ? "— None —" : undefined} options={branches.map((b) => [b.id, b.name] as const)} />
              </Field>
              {!all && branches.length > 1 && (
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-ink-2">Additional branches</p>
                  <div className="flex flex-col gap-1.5">
                    {branches
                      .filter((b) => b.id !== primary)
                      .map((b) => (
                        <Checkbox key={b.id} name="extraBranchIds" value={b.id} defaultChecked={values?.extraBranchIds.includes(b.id)} label={b.name} />
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">{values ? "Save changes" : "Create user"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
