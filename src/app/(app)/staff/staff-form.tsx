"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/format";
import { saveStaffAction } from "./actions";
import { DEPARTMENTS, STAFF_TYPE_OPTIONS, WEEKDAY_SHORT as WEEKDAYS } from "./constants";

export type StaffFormValues = {
  id?: string;
  fullName?: string;
  mobile?: string;
  email?: string | null;
  designation?: string;
  department?: string;
  staffType?: string;
  joiningDate?: string;
  branchId?: string;
  monthlySalary?: number;
  salaryType?: string;
  shiftStart?: string;
  shiftEnd?: string;
  weeklyOff?: number[];
  bankName?: string | null;
  bankAccount?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  status?: string;
};

export function StaffForm({
  values = {},
  branches,
  canPay,
}: {
  values?: StaffFormValues;
  branches: { id: string; name: string }[];
  canPay: boolean;
}) {
  const [salaryType, setSalaryType] = useState(values.salaryType ?? "MONTHLY");
  const [off, setOff] = useState<number[]>(values.weeklyOff ?? [0]);
  const departments = DEPARTMENTS.includes(values.department ?? "") || !values.department ? DEPARTMENTS : [values.department, ...DEPARTMENTS];
  const cancelHref = values.id ? `/staff/${values.id}` : "/staff";

  return (
    <ActionForm action={saveStaffAction} successMessage="Employee saved">
      {(s) => (
        <div className="space-y-5">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <Card>
            <CardHeader title="Employee profile" />
            <CardBody>
              <FormGrid>
                <Field label="Full name" required error={fe(s, "fullName")}>
                  <Input name="fullName" defaultValue={values.fullName} required autoFocus={!values.id} />
                </Field>
                <Field label="Mobile number" required error={fe(s, "mobile")}>
                  <Input name="mobile" inputMode="tel" defaultValue={values.mobile} required />
                </Field>
                <Field label="Email" error={fe(s, "email")}>
                  <Input name="email" type="email" defaultValue={values.email ?? ""} />
                </Field>
                <Field label="Designation" required error={fe(s, "designation")}>
                  <Input name="designation" defaultValue={values.designation} placeholder="e.g. Laser Therapist" required />
                </Field>
                <Field label="Department" required error={fe(s, "department")}>
                  <Select name="department" defaultValue={values.department ?? ""} options={departments.map((d) => [d, d] as const)} placeholder="Choose…" required />
                </Field>
                <Field label="Role type" required error={fe(s, "staffType")} hint="Doctors and therapists appear in appointment & session pickers.">
                  <Select name="staffType" defaultValue={values.staffType ?? ""} options={STAFF_TYPE_OPTIONS} placeholder="Choose…" required />
                </Field>
                <Field label="Joining date" required error={fe(s, "joiningDate")}>
                  <Input name="joiningDate" type="date" defaultValue={values.joiningDate} required />
                </Field>
                <Field label="Branch" required error={fe(s, "branchId")}>
                  <Select name="branchId" defaultValue={values.branchId ?? branches[0]?.id} options={branches.map((b) => [b.id, b.name] as const)} required />
                </Field>
                <Field label="Employment status" required error={fe(s, "status")}>
                  <Select
                    name="status"
                    defaultValue={values.status ?? "ACTIVE"}
                    options={[
                      ["ACTIVE", "Active"],
                      ["ON_NOTICE", "On notice period"],
                      ["RESIGNED", "Resigned"],
                      ["TERMINATED", "Terminated"],
                    ]}
                  />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Working hours & salary" description="Used for late marks, overtime and payroll." />
            <CardBody className="space-y-4">
              <FormGrid className="sm:grid-cols-4">
                <Field label="Shift starts" required error={fe(s, "shiftStart")}>
                  <Input name="shiftStart" type="time" defaultValue={values.shiftStart ?? "10:00"} required />
                </Field>
                <Field label="Shift ends" required error={fe(s, "shiftEnd")}>
                  <Input name="shiftEnd" type="time" defaultValue={values.shiftEnd ?? "19:00"} required />
                </Field>
                {canPay ? (
                  <>
                    <Field label="Salary type" required error={fe(s, "salaryType")}>
                      <Select
                        name="salaryType"
                        value={salaryType}
                        onChange={(e) => setSalaryType(e.target.value)}
                        options={[
                          ["MONTHLY", "Monthly"],
                          ["DAILY", "Daily wage"],
                          ["HOURLY", "Hourly"],
                        ]}
                      />
                    </Field>
                    <Field label={salaryType === "MONTHLY" ? "Monthly salary (₹)" : salaryType === "DAILY" ? "Rate per day (₹)" : "Rate per hour (₹)"} required error={fe(s, "monthlySalary")}>
                      <Input name="monthlySalary" inputMode="decimal" defaultValue={values.monthlySalary ?? ""} required />
                    </Field>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="salaryType" value={values.salaryType ?? "MONTHLY"} />
                    <input type="hidden" name="monthlySalary" value={values.monthlySalary ?? 0} />
                  </>
                )}
              </FormGrid>
              <Field label="Weekly off" hint="Select one or more days.">
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d, i) => {
                    const on = off.includes(i);
                    return (
                      <label
                        key={d}
                        className={cn(
                          "cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors select-none",
                          on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-ink-2 hover:bg-surface-2",
                        )}
                      >
                        <input
                          type="checkbox"
                          name="weeklyOff"
                          value={i}
                          checked={on}
                          onChange={() => setOff((xs) => (on ? xs.filter((x) => x !== i) : [...xs, i]))}
                          className="sr-only"
                        />
                        {d}
                      </label>
                    );
                  })}
                </div>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Bank & emergency contact" description="Bank details are only visible to HR, payroll and the owner." />
            <CardBody>
              <FormGrid>
                <Field label="Bank name" error={fe(s, "bankName")}>
                  <Input name="bankName" defaultValue={values.bankName ?? ""} />
                </Field>
                <Field label="Account number" error={fe(s, "bankAccount")}>
                  <Input name="bankAccount" inputMode="numeric" defaultValue={values.bankAccount ?? ""} autoComplete="off" />
                </Field>
                <Field label="IFSC" error={fe(s, "ifsc")}>
                  <Input name="ifsc" defaultValue={values.ifsc ?? ""} className="uppercase" maxLength={11} />
                </Field>
                <Field label="UPI ID" error={fe(s, "upiId")}>
                  <Input name="upiId" defaultValue={values.upiId ?? ""} placeholder="name@okhdfcbank" />
                </Field>
                <Field label="Emergency contact name" error={fe(s, "emergencyName")}>
                  <Input name="emergencyName" defaultValue={values.emergencyName ?? ""} />
                </Field>
                <Field label="Emergency contact phone" error={fe(s, "emergencyPhone")}>
                  <Input name="emergencyPhone" inputMode="tel" defaultValue={values.emergencyPhone ?? ""} />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <div className="flex justify-end gap-2">
            <LinkButton href={cancelHref} variant="ghost">
              Cancel
            </LinkButton>
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Add employee"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
