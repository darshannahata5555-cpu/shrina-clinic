import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight, Minus, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { cn, fmtDate, fmtDateTime, fmtNum, money, toNum } from "@/lib/format";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { SegmentParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { expiryCutoff, loadStockRows, resolveRefs, userNames } from "../_lib/data";
import { STOCK_STATUS, TXN_LABEL, TXN_TONE } from "../_lib/labels";
import { ProductForm, StockInForm, StockOutForm, TransferForm } from "../forms";
import { deleteProductAction } from "../actions";

export const metadata = { title: "Product" };

const TXN_PAGE = 30;
type SP = Record<string, string | string[] | undefined>;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const { productId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const showEmpty = sp.batches === "all";
  const canManage = can(user, "inventory.manage");

  const product = await db.product.findFirst({ where: { id: productId, deletedAt: null }, include: { supplier: true } });
  if (!product) notFound();

  const accessibleIds = scope.branches.map((b) => b.id);
  const [rowArr, batches, txnCount, txns, usages, suppliers, allBranches] = await Promise.all([
    loadStockRows(accessibleIds, { id: productId }),
    db.productBatch.findMany({
      where: { productId, branchId: { in: scope.ids }, ...(showEmpty ? {} : { quantity: { gt: 0 } }) },
      include: { branch: { select: { name: true, code: true } }, supplier: { select: { name: true } } },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { purchaseDate: "asc" }],
    }),
    db.inventoryTransaction.count({ where: { productId, branchId: { in: scope.ids } } }),
    db.inventoryTransaction.findMany({
      where: { productId, branchId: { in: scope.ids } },
      include: { batch: { select: { batchNo: true } }, branch: { select: { code: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * TXN_PAGE,
      take: TXN_PAGE,
    }),
    db.treatmentProductUsage.findMany({ where: { productId }, include: { treatment: { select: { id: true, name: true, isActive: true, deletedAt: true } } } }),
    db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const row = rowArr[0]!;
  const [refOf, names] = await Promise.all([resolveRefs(txns), userNames(txns.map((t) => t.createdById))]);
  const [tone, label] = STOCK_STATUS[row.status];
  const cutoff = expiryCutoff();
  const now = new Date();

  const branchOpts = scope.branches.filter((b) => scope.ids.includes(b.id)).map((b) => [b.id, b.name] as const);
  const supplierOpts = suppliers.map((s) => [s.id, s.name] as const);
  const batchOpts = (
    await db.productBatch.findMany({
      where: { productId, branchId: { in: accessibleIds }, quantity: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }],
    })
  ).map((b) => ({ id: b.id, branchId: b.branchId, batchNo: b.batchNo, expiryDate: b.expiryDate?.toISOString() ?? null, quantity: toNum(b.quantity) }));
  const stockInScope = scope.ids.reduce((s, id) => s + (row.byBranch[id] ?? 0), 0);

  return (
    <>
      <PageHeader
        back={{ href: "/inventory", label: "Products & Inventory" }}
        title={product.name}
        meta={
          <>
            <Badge tone="neutral">{product.sku}</Badge>
            <Badge tone={tone} dot>
              {label}
            </Badge>
            <Badge tone={product.isRetail ? "accent" : "neutral"}>{product.isRetail ? "Retail" : "Clinic consumable"}</Badge>
            {!product.isActive && <Badge tone="danger">Inactive</Badge>}
          </>
        }
        actions={
          canManage && (
            <>
              <Dialog title={`Stock in — ${product.name}`} trigger={<Button><Plus className="h-4 w-4" /> Stock in</Button>}>
                <StockInForm
                  productId={product.id}
                  unit={product.unit}
                  defaultCost={toNum(product.purchasePrice)}
                  branches={branchOpts}
                  defaultBranchId={scope.defaultBranchId}
                  suppliers={supplierOpts}
                  defaultSupplierId={product.supplierId}
                />
              </Dialog>
              <Dialog title={`Stock out / adjust — ${product.name}`} trigger={<Button variant="outline"><Minus className="h-4 w-4" /> Stock out</Button>}>
                <StockOutForm productId={product.id} unit={product.unit} branches={branchOpts} defaultBranchId={scope.defaultBranchId} batches={batchOpts} />
              </Dialog>
              {allBranches.length > 1 && (
                <Dialog title={`Transfer — ${product.name}`} trigger={<Button variant="outline"><ArrowLeftRight className="h-4 w-4" /> Transfer</Button>}>
                  <TransferForm
                    productId={product.id}
                    unit={product.unit}
                    fromBranches={scope.branches.map((b) => [b.id, b.name] as const)}
                    allBranches={allBranches.map((b) => [b.id, b.name] as const)}
                    defaultBranchId={scope.defaultBranchId}
                    batches={batchOpts}
                  />
                </Dialog>
              )}
              <Dialog size="lg" title="Edit product" trigger={<Button variant="ghost"><Pencil className="h-4 w-4" /> Edit</Button>}>
                <ProductForm
                  suppliers={supplierOpts}
                  values={{
                    ...product,
                    purchasePrice: toNum(product.purchasePrice),
                    sellingPrice: toNum(product.sellingPrice),
                    gstRate: toNum(product.gstRate),
                    minStock: toNum(product.minStock),
                  }}
                />
              </Dialog>
              <ActionButton
                action={deleteProductAction}
                fields={{ id: product.id }}
                variant="ghost"
                size="md"
                confirm={`Delete ${product.name}?${stockInScope > 0 ? ` It still has ${fmtNum(stockInScope)} ${product.unit} in stock.` : ""} It can be restored from Settings → Recycle bin.`}
              >
                <Trash2 className="h-4 w-4" />
              </ActionButton>
            </>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Stock by branch" description={`Minimum level ${fmtNum(row.minStock)} ${product.unit} per branch`} />
          <CardBody>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {scope.branches.map((b) => {
                const qty = row.byBranch[b.id] ?? 0;
                const low = row.lowBranches.includes(b.id);
                return (
                  <div key={b.id} className={cn("rounded-lg border px-4 py-3", low ? "border-warning/40 bg-warning-soft/50" : "border-border bg-surface-2")}>
                    <p className="text-[13px] text-muted">{b.name}</p>
                    <p className="tabular mt-1 text-xl font-semibold">
                      {fmtNum(qty)} <span className="text-sm font-normal text-muted">{product.unit}</span>
                    </p>
                    <p className={cn("text-xs", qty <= 0 ? "text-danger" : low ? "text-warning" : "text-success")}>
                      {qty <= 0 ? "Out of stock" : low ? "At or below minimum — reorder" : "Healthy"}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList
              className="sm:grid-cols-2"
              items={[
                ["Category", product.category],
                ["Brand", product.brand ?? "—"],
                ["Unit", product.unit],
                ["HSN", product.hsnCode ?? "—"],
                ["Purchase price", `${money(product.purchasePrice)} / ${product.unit}`],
                ["Selling price", toNum(product.sellingPrice) ? `${money(product.sellingPrice)} / ${product.unit}` : "Not sold"],
                ["GST", `${fmtNum(product.gstRate)}%`],
                ["Stock value (cost)", money(row.value)],
                ["Supplier", product.supplier ? <Link key="s" href={`/inventory/suppliers/${product.supplier.id}`} className="hover:text-accent">{product.supplier.name}</Link> : "—"],
                ["Description", product.description ?? "—"],
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Batches"
            description="Used first-expiry-first-out. Expired and soon-expiring batches are highlighted."
            actions={<SegmentParam name="batches" defaultValue="current" options={[["current", "In stock"], ["all", "All batches"]]} />}
          />
          <Table>
            <THead>
              <tr>
                <TH>Batch</TH>
                {scope.isAll && <TH>Branch</TH>}
                <TH>Expiry</TH>
                <TH className="text-right">Remaining</TH>
                <TH className="hidden text-right sm:table-cell">Received</TH>
                <TH className="hidden text-right md:table-cell">Cost</TH>
                <TH className="hidden md:table-cell">Supplier</TH>
              </tr>
            </THead>
            <tbody>
              {batches.length === 0 ? (
                <TableEmpty colSpan={7}>No batches in stock.</TableEmpty>
              ) : (
                batches.map((b) => {
                  const expired = b.expiryDate && b.expiryDate < now;
                  const soon = b.expiryDate && b.expiryDate <= cutoff;
                  return (
                    <TR key={b.id} className={toNum(b.quantity) <= 0 ? "opacity-60" : ""}>
                      <TD className="font-medium">
                        {b.batchNo}
                        <p className="text-xs font-normal text-muted">Received {fmtDate(b.purchaseDate)}</p>
                      </TD>
                      {scope.isAll && <TD className="text-ink-2">{b.branch.code}</TD>}
                      <TD className="whitespace-nowrap">
                        {b.expiryDate ? (
                          <span className={expired ? "text-danger" : soon ? "text-warning" : "text-ink-2"}>
                            {fmtDate(b.expiryDate)}
                            {expired ? " · expired" : soon ? " · soon" : ""}
                          </span>
                        ) : (
                          <span className="text-muted">No expiry</span>
                        )}
                      </TD>
                      <TD className="tabular text-right font-medium">{fmtNum(b.quantity)}</TD>
                      <TD className="tabular hidden text-right text-muted sm:table-cell">{fmtNum(b.initialQty)}</TD>
                      <TD className="tabular hidden text-right text-ink-2 md:table-cell">{money(b.purchasePrice)}</TD>
                      <TD className="hidden text-ink-2 md:table-cell">{b.supplier?.name ?? "—"}</TD>
                    </TR>
                  );
                })
              )}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Used in treatments" description="Deducted automatically per completed session" />
          {usages.filter((u) => !u.treatment.deletedAt).length === 0 ? (
            <EmptyState icon={<Sparkles className="h-5 w-5" />} title="Not linked to any treatment" description="Set product usage on a treatment in the treatment catalogue." />
          ) : (
            <ul className="divide-y divide-border">
              {usages
                .filter((u) => !u.treatment.deletedAt)
                .map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/treatments/catalog/${u.treatment.id}`} className="hover:text-accent">
                      {u.treatment.name}
                      {!u.treatment.isActive && <span className="text-xs text-muted"> (inactive)</span>}
                    </Link>
                    <span className="tabular shrink-0 text-ink-2">
                      {fmtNum(u.quantity)} {product.unit} / session
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Stock history" description="Every movement in and out, newest first" />
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Movement</TH>
              <TH className="text-right">Qty</TH>
              <TH className="hidden md:table-cell">Batch</TH>
              <TH className="hidden md:table-cell">Reference</TH>
              <TH className="hidden lg:table-cell">Note</TH>
              <TH className="hidden lg:table-cell">By</TH>
            </tr>
          </THead>
          <tbody>
            {txns.length === 0 ? (
              <TableEmpty colSpan={7}>No stock movements yet.</TableEmpty>
            ) : (
              txns.map((t) => {
                const q = toNum(t.quantity);
                const ref = refOf(t.refType, t.refId);
                return (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap text-ink-2">
                      {fmtDateTime(t.createdAt)}
                      {scope.isAll && <span className="ml-1.5 text-[11px] text-muted">{t.branch.code}</span>}
                    </TD>
                    <TD>
                      <Badge tone={TXN_TONE[t.type] ?? "neutral"}>{TXN_LABEL[t.type] ?? t.type}</Badge>
                    </TD>
                    <TD className={cn("tabular text-right font-medium whitespace-nowrap", q >= 0 ? "text-success" : "text-ink")}>
                      {q > 0 ? "+" : "−"}
                      {fmtNum(Math.abs(q))} <span className="text-xs font-normal text-muted">{product.unit}</span>
                    </TD>
                    <TD className="hidden text-ink-2 md:table-cell">{t.batch?.batchNo ?? <span className="text-danger">untracked</span>}</TD>
                    <TD className="hidden md:table-cell">
                      {ref ? (
                        <Link href={ref.href} className="text-ink-2 hover:text-accent">
                          {ref.label}
                        </Link>
                      ) : (
                        <span className="text-muted">{t.refType === "Transfer" ? "Branch transfer" : t.refType === "Manual" ? "Manual entry" : "—"}</span>
                      )}
                    </TD>
                    <TD className="hidden max-w-64 truncate text-ink-2 lg:table-cell" title={t.notes ?? ""}>
                      {t.notes ?? "—"}
                    </TD>
                    <TD className="hidden text-muted lg:table-cell">{(t.createdById && names.get(t.createdById)) || "—"}</TD>
                  </TR>
                );
              })
            )}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={TXN_PAGE} total={txnCount} hrefFor={(p) => withParams(`/inventory/${productId}`, sp, { page: p })} />
      </Card>
    </>
  );
}
