"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { saveRulesAction } from "../actions";

export type RulesValues = {
  salaryBasis: string;
  weeklyOffPaid: boolean;
  holidaysPaid: boolean;
  lateGraceMinutes: number;
  latesPerHalfDay: number;
  halfDayMinHours: number;
  fullDayMinHours: number;
  overtimeEnabled: boolean;
  overtimeMinMinutes: number;
  overtimeRateMultiplier: number;
  paidLeavesPerYear: number;
  sickLeavesPerYear: number;
  casualLeavesPerYear: number;
  pinEnabled: boolean;
  qrEnabled: boolean;
  mobileEnabled: boolean;
  gpsRequired: boolean;
  gpsRadiusMeters: number;
};

export function RulesForm({ v, branchesWithoutGps }: { v: RulesValues; branchesWithoutGps: string[] }) {
  return (
    <ActionForm action={saveRulesAction}>
      {(s) => (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Salary calculation" description="How the per-day rate and unpaid days are worked out." />
            <CardBody className="space-y-4">
              <Field label="Per-day rate" error={fe(s, "salaryBasis")} hint="Used to value each unpaid day, half day and overtime hour.">
                <Select
                  name="salaryBasis"
                  defaultValue={v.salaryBasis}
                  options={[
                    ["CALENDAR", "Monthly salary ÷ days in the month (28–31)"],
                    ["WORKING", "Monthly salary ÷ working days (excludes weekly offs & holidays)"],
                    ["FIXED_30", "Monthly salary ÷ 30"],
                    ["FIXED_26", "Monthly salary ÷ 26"],
                  ]}
                />
              </Field>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox name="weeklyOffPaid" defaultChecked={v.weeklyOffPaid} label="Weekly offs are paid" />
                <Checkbox name="holidaysPaid" defaultChecked={v.holidaysPaid} label="Clinic holidays are paid" />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Late marks, half days & overtime" />
            <CardBody>
              <FormGrid className="sm:grid-cols-3">
                <Field label="Grace period (minutes)" error={fe(s, "lateGraceMinutes")} hint="Arrivals within this are not late.">
                  <Input name="lateGraceMinutes" inputMode="numeric" defaultValue={v.lateGraceMinutes} />
                </Field>
                <Field label="Late marks per ½-day cut" error={fe(s, "latesPerHalfDay")} hint="0 = never deduct for lates.">
                  <Input name="latesPerHalfDay" inputMode="numeric" defaultValue={v.latesPerHalfDay} />
                </Field>
                <div />
                <Field label="Full day needs (hours)" error={fe(s, "fullDayMinHours")} hint="Worked less → half day.">
                  <Input name="fullDayMinHours" inputMode="decimal" defaultValue={v.fullDayMinHours} />
                </Field>
                <Field label="Half day needs (hours)" error={fe(s, "halfDayMinHours")} hint="Worked less → absent.">
                  <Input name="halfDayMinHours" inputMode="decimal" defaultValue={v.halfDayMinHours} />
                </Field>
                <div />
                <Field label="Overtime counts after (minutes)" error={fe(s, "overtimeMinMinutes")} hint="Extra time beyond the shift.">
                  <Input name="overtimeMinMinutes" inputMode="numeric" defaultValue={v.overtimeMinMinutes} />
                </Field>
                <Field label="Overtime rate (× hourly)" error={fe(s, "overtimeRateMultiplier")} hint="Hourly = per-day rate ÷ shift hours.">
                  <Input name="overtimeRateMultiplier" inputMode="decimal" defaultValue={v.overtimeRateMultiplier} />
                </Field>
                <div className="flex items-end pb-2">
                  <Checkbox name="overtimeEnabled" defaultChecked={v.overtimeEnabled} label="Pay overtime" />
                </div>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Leave entitlement (per calendar year)" description="Leave beyond the balance is treated as unpaid in payroll." />
            <CardBody>
              <FormGrid className="sm:grid-cols-3">
                <Field label="Casual leave" error={fe(s, "casualLeavesPerYear")}>
                  <Input name="casualLeavesPerYear" inputMode="numeric" defaultValue={v.casualLeavesPerYear} />
                </Field>
                <Field label="Sick leave" error={fe(s, "sickLeavesPerYear")}>
                  <Input name="sickLeavesPerYear" inputMode="numeric" defaultValue={v.sickLeavesPerYear} />
                </Field>
                <Field label="Paid / earned leave" error={fe(s, "paidLeavesPerYear")}>
                  <Input name="paidLeavesPerYear" inputMode="numeric" defaultValue={v.paidLeavesPerYear} />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Attendance methods" />
            <CardBody className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <Checkbox name="pinEnabled" defaultChecked={v.pinEnabled} label="Kiosk: employee ID + PIN" />
                <Checkbox name="qrEnabled" defaultChecked={v.qrEnabled} label="QR (phone scan & ID badge)" />
                <Checkbox name="mobileEnabled" defaultChecked={v.mobileEnabled} label="Mobile check-in from own phone" />
              </div>
              <div className="grid items-end gap-4 sm:grid-cols-[1fr_200px]">
                <Checkbox name="gpsRequired" defaultChecked={v.gpsRequired} label="Require GPS location within the clinic radius for mobile check-in" />
                <Field label="Allowed radius (metres)" error={fe(s, "gpsRadiusMeters")}>
                  <Input name="gpsRadiusMeters" inputMode="numeric" defaultValue={v.gpsRadiusMeters} />
                </Field>
              </div>
              {branchesWithoutGps.length > 0 && (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                  No GPS point set for: {branchesWithoutGps.join(", ")}. Add latitude/longitude in Branch Management before requiring GPS.
                </p>
              )}
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save rules</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
