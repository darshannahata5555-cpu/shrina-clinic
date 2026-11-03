import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { financialYear } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BillingForm, ClinicForm, SecurityForm } from "./forms";

export const metadata = { title: "Clinic, GST & invoices" };

export default async function ClinicSettingsPage() {
  await requirePermission("settings.manage");
  const [clinic, billing, security, branch] = await Promise.all([
    getSetting("clinic"),
    getSetting("billing"),
    getSetting("security"),
    db.branch.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Clinic, GST & invoices" description="Details printed on invoices and how tax is calculated." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Clinic details" description="Legal identity used on invoices, salary slips and messages" />
          <CardBody>
            <ClinicForm values={clinic} />
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="GST & invoice format" description="Configure to match your accountant's requirements" />
            <CardBody>
              <BillingForm values={billing} sampleBranchCode={branch?.code ?? "FLG"} fy={financialYear().replace("-", "")} />
            </CardBody>
          </Card>
          <Card id="security">
            <CardHeader title="Security" description="Sessions expire after 12 hours. Every sign-in and change is recorded in the activity log." />
            <CardBody>
              <SecurityForm values={security} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
