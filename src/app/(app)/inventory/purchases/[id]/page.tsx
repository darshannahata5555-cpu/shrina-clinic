import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, fmtDateTime, fmtNum, money, r2, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { PrintButton } from "../../_lib/print-button";

export const metadata = { title: "Purchase" };

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const { id } = await params;
  const p = await db.purchase.findFirst({
    where: { id, branchId: { in: scope.branches.map((b) => b.id) } },
    include: {
      supplier: true,
      branch: { select: { name: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
    },
  });
  if (!p) notFound();
  const [creator, expense] = await Promise.all([
    p.createdById ? db.user.findUnique({ where: { id: p.createdById }, select: { name: true } }) : null,
    db.expense.findFirst({ where: { deletedAt: null, category: "PRODUCT_PURCHASE", description: { startsWith: `Purchase ${p.number}` } }, select: { id: true, code: true, status: true } }),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/inventory/purchases", label: "Purchases" }}
        title={`Purchase ${p.number}`}
        description={`${p.supplier.name} · ${fmtDate(p.purchaseDate)} · ${p.branch.name}`}
        actions={<PrintButton><Printer className="h-4 w-4" /> Print</PrintButton>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items received" />
          <Table>
            <THead>
              <tr>
                <TH>Product</TH>
                <TH>Batch</TH>
                <TH className="hidden sm:table-cell">Expiry</TH>
                <TH className="text-right">Qty</TH>
                <TH className="hidden text-right sm:table-cell">Unit cost</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <tbody>
              {p.items.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link href={`/inventory/${i.product.id}`} className="font-medium hover:text-accent">
                      {i.product.name}
                    </Link>
                    <p className="text-xs text-muted">{i.product.sku}</p>
                  </TD>
                  <TD className="text-ink-2">{i.batchNo}</TD>
                  <TD className="hidden text-ink-2 sm:table-cell">{i.expiryDate ? fmtDate(i.expiryDate) : "—"}</TD>
                  <TD className="tabular text-right">
                    {fmtNum(i.quantity)} <span className="text-xs text-muted">{i.product.unit}</span>
                  </TD>
                  <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{money(i.unitCost)}</TD>
                  <TD className="tabular text-right font-medium">{money(r2(toNum(i.quantity) * toNum(i.unitCost)))}</TD>
                </TR>
              ))}
              <TR>
                <TD colSpan={5} className="text-right font-medium">
                  Total
                </TD>
                <TD className="tabular text-right text-base font-semibold">{money(p.totalAmount)}</TD>
              </TR>
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Bill details" />
          <CardBody>
            <DetailList
              className="sm:grid-cols-1"
              items={[
                ["Supplier", <Link key="s" href={`/inventory/suppliers/${p.supplier.id}`} className="hover:text-accent">{p.supplier.name}</Link>],
                ["Supplier GSTIN", p.supplier.gstin ?? "—"],
                ["Supplier bill no.", p.billNo ?? "—"],
                ["Receiving branch", p.branch.name],
                ["Recorded by", `${creator?.name ?? "—"} · ${fmtDateTime(p.createdAt)}`],
                [
                  "Expense",
                  expense ? (
                    <Link key="e" href={`/expenses?q=${encodeURIComponent(expense.code)}`} className="inline-flex items-center gap-2 hover:text-accent">
                      {expense.code} <StatusBadge kind="approval" status={expense.status} />
                    </Link>
                  ) : (
                    "Not recorded as expense"
                  ),
                ],
                ["Notes", p.notes ?? "—"],
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
