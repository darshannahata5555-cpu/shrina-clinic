import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { LinkTabs, PageHeader } from "@/components/ui/page";
import { hasActivityTab, hasExpenseTab } from "./_lib/access";
import { ExpensesTab } from "./expenses-tab";
import { ActivitiesTab } from "./activities-tab";

export const metadata = { title: "Expenses & Activities" };

type SP = Record<string, string | string[] | undefined>;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const showExpenses = hasExpenseTab(user);
  const showActivities = hasActivityTab(user);
  if (!showExpenses && !showActivities) redirect("/forbidden");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const tab = sp.tab === "activities" && showActivities ? "activities" : showExpenses ? "expenses" : "activities";

  return (
    <>
      <PageHeader
        title={showExpenses && showActivities ? "Expenses & Activities" : showExpenses ? "Expenses" : "Internal Activities"}
        description="Clinic spending with owner approval, plus daily checklists, maintenance and complaints."
      />
      {showExpenses && showActivities && (
        <LinkTabs
          active={tab}
          tabs={[
            { key: "expenses", label: "Expenses", href: "/expenses" },
            { key: "activities", label: "Internal activities", href: "/expenses?tab=activities" },
          ]}
        />
      )}
      {tab === "expenses" ? <ExpensesTab user={user} scope={scope} sp={sp} /> : <ActivitiesTab user={user} scope={scope} sp={sp} />}
    </>
  );
}
