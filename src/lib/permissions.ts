// Permission catalogue + default role grants. Pure module — safe to import from client components.

export const PERMISSION_GROUPS = [
  {
    group: "Dashboard",
    items: [
      ["dashboard.view", "View dashboard"],
      ["dashboard.financials", "See revenue & financial figures on dashboard"],
    ],
  },
  {
    group: "Patients",
    items: [
      ["patients.view", "Search & view patient profiles"],
      ["patients.create", "Register patients"],
      ["patients.edit", "Edit patient details"],
      ["patients.delete", "Delete (archive) patients"],
      ["patients.medical", "View confidential medical history & doctor notes"],
      ["patients.transfer", "Transfer patients between branches"],
      ["patients.import", "Bulk import patients from Excel"],
      ["consultations.create", "Record consultations"],
      ["photos.view", "View before/after photos"],
      ["photos.manage", "Upload photos & record consent"],
      ["photos.approve", "Approve photos (doctor)"],
    ],
  },
  {
    group: "Appointments & treatments",
    items: [
      ["appointments.view", "View appointments & calendars"],
      ["appointments.manage", "Book, reschedule & update appointments"],
      ["treatments.manage", "Manage treatment catalogue"],
      ["packages.view", "View treatment packages"],
      ["packages.manage", "Create, renew & cancel packages"],
      ["sessions.update", "Mark sessions completed / missed"],
      ["sessions.approve", "Approve & adjust session records"],
    ],
  },
  {
    group: "Billing",
    items: [
      ["billing.view", "View invoices & payments"],
      ["billing.create", "Create invoices & record payments"],
      ["billing.discount", "Apply discounts"],
      ["billing.refund", "Issue refunds & credit notes"],
      ["billing.cancel", "Cancel invoices"],
    ],
  },
  {
    group: "Inventory",
    items: [
      ["inventory.view", "View products & stock"],
      ["inventory.manage", "Stock in/out, purchases, suppliers"],
    ],
  },
  {
    group: "Expenses & activities",
    items: [
      ["expenses.view", "View expenses"],
      ["expenses.create", "Submit expenses"],
      ["expenses.approve", "Approve / reject expenses"],
      ["activities.view", "View internal activity log"],
      ["activities.create", "Record activities & checklists"],
    ],
  },
  {
    group: "Staff & HR",
    items: [
      ["staff.view", "View employee records"],
      ["staff.manage", "Add & edit employees"],
      ["attendance.view", "View attendance of all staff"],
      ["attendance.manage", "Manual attendance entry & corrections"],
      ["leaves.approve", "Approve / reject leave requests"],
      ["payroll.view", "View payroll"],
      ["payroll.manage", "Run payroll, adjustments & mark paid"],
    ],
  },
  {
    group: "CRM",
    items: [
      ["leads.view", "View leads"],
      ["leads.manage", "Add, assign & update leads"],
    ],
  },
  {
    group: "Reports",
    items: [
      ["reports.view", "Operational reports"],
      ["reports.financial", "Financial reports & profit"],
      ["reports.export", "Export to Excel / PDF"],
    ],
  },
  {
    group: "Administration",
    items: [
      ["branches.all", "Access all branches"],
      ["branches.manage", "Create & edit branches"],
      ["notifications.manage", "Configure reminders & view outbox"],
      ["users.manage", "Manage users & permissions"],
      ["settings.manage", "Clinic, GST & payroll settings"],
      ["audit.view", "View activity (audit) logs"],
      ["recycle.manage", "Restore deleted records"],
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["items"][number][0];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.items.map((i) => i[0] as Permission),
);

export const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map(([k, l]) => [k, l])),
);

export const ROLE_KEYS = [
  "OWNER",
  "BRANCH_MANAGER",
  "DOCTOR",
  "RECEPTIONIST",
  "THERAPIST",
  "ACCOUNTS",
  "HR_ADMIN",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const DEFAULT_ROLES: Record<RoleKey, { name: string; description: string; permissions: Permission[] }> = {
  OWNER: {
    name: "Owner / Super Admin",
    description: "Complete access to every branch, finance, staff and settings.",
    permissions: ALL_PERMISSIONS,
  },
  BRANCH_MANAGER: {
    name: "Branch Manager",
    description: "Runs an assigned branch: patients, appointments, staff, expenses and branch reports.",
    permissions: [
      "dashboard.view", "dashboard.financials",
      "patients.view", "patients.create", "patients.edit", "patients.transfer",
      "consultations.create", "photos.view",
      "appointments.view", "appointments.manage",
      "packages.view", "packages.manage", "sessions.update", "sessions.approve",
      "billing.view", "billing.create", "billing.discount",
      "inventory.view", "inventory.manage",
      "expenses.view", "expenses.create", "activities.view", "activities.create",
      "staff.view", "attendance.view", "attendance.manage", "leaves.approve",
      "leads.view", "leads.manage",
      "reports.view", "reports.financial", "reports.export",
    ],
  },
  DOCTOR: {
    name: "Doctor",
    description: "Consultations, medical history, treatment records and follow-ups.",
    permissions: [
      "dashboard.view",
      "patients.view", "patients.edit", "patients.medical",
      "consultations.create", "photos.view", "photos.manage", "photos.approve",
      "appointments.view", "appointments.manage",
      "packages.view", "packages.manage", "sessions.update", "sessions.approve",
      "inventory.view",
    ],
  },
  RECEPTIONIST: {
    name: "Receptionist",
    description: "Registration, appointment booking, patient search, billing and reminders.",
    permissions: [
      "dashboard.view",
      "patients.view", "patients.create", "patients.edit",
      "appointments.view", "appointments.manage",
      "packages.view", "sessions.update",
      "billing.view", "billing.create",
      "inventory.view",
      "activities.view", "activities.create", "expenses.create",
      "leads.view", "leads.manage",
    ],
  },
  THERAPIST: {
    name: "Therapist",
    description: "Assigned treatment sessions, session updates and observations.",
    permissions: [
      "dashboard.view",
      "patients.view",
      "photos.view", "photos.manage",
      "appointments.view",
      "packages.view", "sessions.update",
      "inventory.view",
      "activities.create",
    ],
  },
  ACCOUNTS: {
    name: "Accounts Team",
    description: "Invoices, payments, expenses, reconciliation and financial reports.",
    permissions: [
      "dashboard.view", "dashboard.financials",
      "patients.view",
      "billing.view", "billing.create", "billing.discount", "billing.refund", "billing.cancel",
      "inventory.view",
      "expenses.view", "expenses.create",
      "payroll.view",
      "reports.view", "reports.financial", "reports.export",
    ],
  },
  HR_ADMIN: {
    name: "HR / Admin",
    description: "Employee records, attendance, leave and payroll preparation.",
    permissions: [
      "dashboard.view",
      "staff.view", "staff.manage",
      "attendance.view", "attendance.manage",
      "leaves.approve",
      "payroll.view", "payroll.manage",
      "activities.view", "activities.create",
      "reports.view", "reports.export",
    ],
  },
};

export function resolvePermissions(
  rolePermissions: string[],
  grant: string[] = [],
  revoke: string[] = [],
): Set<string> {
  const set = new Set<string>([...rolePermissions, ...grant]);
  for (const p of revoke) set.delete(p);
  return set;
}
