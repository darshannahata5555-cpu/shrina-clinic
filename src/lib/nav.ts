import type { Permission } from "./permissions";

export type NavItem = { href: string; label: string; icon: string; any: Permission[] };
export type NavGroup = { label: string; items: NavItem[] };

/** Main menu (spec §17). Items are shown only when the user holds any of `any`. */
export const NAV: NavGroup[] = [
  {
    label: "",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", any: ["dashboard.view"] }],
  },
  {
    label: "Clinic",
    items: [
      { href: "/patients", label: "Patients", icon: "patients", any: ["patients.view"] },
      { href: "/appointments", label: "Appointments", icon: "appointments", any: ["appointments.view"] },
      { href: "/treatments", label: "Treatments", icon: "treatments", any: ["packages.view", "treatments.manage"] },
      { href: "/sessions", label: "Treatment Sessions", icon: "sessions", any: ["packages.view", "sessions.update"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/billing", label: "Billing & Invoices", icon: "billing", any: ["billing.view"] },
      { href: "/payments", label: "Payments", icon: "payments", any: ["billing.view"] },
      { href: "/expenses", label: "Expenses", icon: "expenses", any: ["expenses.view", "expenses.create", "activities.view", "activities.create"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/inventory", label: "Products & Inventory", icon: "inventory", any: ["inventory.view"] },
      { href: "/staff", label: "Staff Management", icon: "staff", any: ["staff.view"] },
      { href: "/attendance", label: "Attendance", icon: "attendance", any: ["dashboard.view"] },
      { href: "/leaves", label: "Leave Management", icon: "leaves", any: ["dashboard.view"] },
      { href: "/payroll", label: "Payroll", icon: "payroll", any: ["payroll.view"] },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/leads", label: "Leads & CRM", icon: "leads", any: ["leads.view"] },
      { href: "/reports", label: "Reports & Analytics", icon: "reports", any: ["reports.view", "reports.financial"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/branches", label: "Branch Management", icon: "branches", any: ["branches.manage", "branches.all"] },
      { href: "/notifications", label: "Notifications", icon: "notifications", any: ["dashboard.view"] },
      { href: "/settings", label: "Settings & Permissions", icon: "settings", any: ["settings.manage", "users.manage", "audit.view", "recycle.manage"] },
    ],
  },
];

export function navFor(permissions: Set<string>): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.any.some((p) => permissions.has(p))) })).filter(
    (g) => g.items.length > 0,
  );
}
