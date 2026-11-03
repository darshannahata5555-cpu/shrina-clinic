import "server-only";
import { can, type CurrentUser } from "@/lib/auth";
import { REPORT_TABS } from "@/lib/reports";

/** Tabs a user may open: money tabs need reports.financial, operational ones reports.view. */
export function allowedTabs(user: CurrentUser) {
  const fin = can(user, "reports.financial");
  const ops = can(user, "reports.view");
  return REPORT_TABS.filter((t) => (t.key === "branches" ? fin || ops : t.financial ? fin : ops));
}
