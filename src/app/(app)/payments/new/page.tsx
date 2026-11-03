import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { pickedPatient } from "@/lib/lookups";
import { istDateKey } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: PageProps<"/payments/new">) {
  const user = await requirePermission("billing.create");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
  let patientId = one(sp.patientId);
  const invoiceId = one(sp.invoiceId);
  if (invoiceId && !patientId) {
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, branchId: { in: scope.ids } }, select: { patientId: true } });
    patientId = inv?.patientId ?? null;
  }
  const patient = await pickedPatient(patientId);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Record payment" description="Take an advance, collect against an invoice, or refund unused advance." back={{ href: "/payments", label: "Payments" }} />
      <PaymentForm
        patient={patient}
        branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
        defaultBranchId={scope.defaultBranchId ?? ""}
        today={istDateKey()}
        canRefund={can(user, "billing.refund")}
        defaultInvoiceId={invoiceId}
      />
    </div>
  );
}
