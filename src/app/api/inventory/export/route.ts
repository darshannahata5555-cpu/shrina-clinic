import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { istDateKey, toNum } from "@/lib/format";
import { loadStockRows } from "@/app/(app)/inventory/_lib/data";
import { inventoryReport, reportRange, txnWhere } from "@/app/(app)/inventory/_lib/queries";
import { TXN_LABEL } from "@/app/(app)/inventory/_lib/labels";

type Col = { header: string; key: string; width?: number; numFmt?: string };

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
  return ws;
}
const INR = '"₹"#,##0.00';
const QTY = "#,##0.##";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissions.has("inventory.view") || !user.permissions.has("reports.export"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await getBranchScope();
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const type = sp.export ?? "stock";
  const wb = new ExcelJS.Workbook();
  wb.creator = "SHRINA Clinic";
  const branchLabel = scope.current?.name ?? "All branches";
  let filename = "";

  if (type === "transactions") {
    const txns = await db.inventoryTransaction.findMany({
      where: txnWhere(sp, scope.ids),
      include: { product: { select: { name: true, sku: true, unit: true } }, batch: { select: { batchNo: true, expiryDate: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20000,
    });
    sheet(
      wb,
      "Stock movements",
      [
        { header: "Date", key: "date", width: 20 },
        { header: "Branch", key: "branch", width: 20 },
        { header: "Product", key: "product", width: 34 },
        { header: "SKU", key: "sku", width: 12 },
        { header: "Movement", key: "type", width: 20 },
        { header: "Quantity", key: "qty", numFmt: QTY },
        { header: "Unit", key: "unit", width: 8 },
        { header: "Batch", key: "batch" },
        { header: "Unit cost", key: "cost", numFmt: INR },
        { header: "Unit price", key: "price", numFmt: INR },
        { header: "Reference", key: "ref", width: 14 },
        { header: "Note", key: "notes", width: 40 },
      ],
      txns.map((t) => ({
        date: t.createdAt,
        branch: t.branch.name,
        product: t.product.name,
        sku: t.product.sku,
        type: TXN_LABEL[t.type] ?? t.type,
        qty: toNum(t.quantity),
        unit: t.product.unit,
        batch: t.batch?.batchNo ?? "untracked",
        cost: t.unitCost === null ? null : toNum(t.unitCost),
        price: t.unitPrice === null ? null : toNum(t.unitPrice),
        ref: t.refType ?? "",
        notes: t.notes ?? "",
      })),
    );
    filename = `stock-movements-${istDateKey()}.xlsx`;
  } else if (type === "report") {
    const range = reportRange(sp);
    const r = await inventoryReport(scope.ids, range.start, range.end);
    sheet(
      wb,
      "Product profit",
      [
        { header: "Product", key: "name", width: 34 },
        { header: "SKU", key: "sku", width: 12 },
        { header: "Qty sold", key: "qty", numFmt: QTY },
        { header: "Unit", key: "unit", width: 8 },
        { header: "Revenue", key: "revenue", numFmt: INR },
        { header: "Cost", key: "cost", numFmt: INR },
        { header: "Profit", key: "margin", numFmt: INR },
        { header: "Margin %", key: "marginPct", numFmt: "0.0" },
      ],
      r.profitRows,
    );
    sheet(
      wb,
      "Treatment usage",
      [
        { header: "Treatment", key: "treatment", width: 32 },
        { header: "Product", key: "product", width: 34 },
        { header: "Sessions", key: "sessions" },
        { header: "Qty used", key: "qty", numFmt: QTY },
        { header: "Unit", key: "unit", width: 8 },
        { header: "Cost", key: "cost", numFmt: INR },
        { header: "Used without stock", key: "shortfall", numFmt: QTY },
      ],
      r.usageRows,
    );
    sheet(
      wb,
      "Write-offs",
      [
        { header: "Reason", key: "reason", width: 22 },
        { header: "Product", key: "product", width: 34 },
        { header: "Qty", key: "qty", numFmt: QTY },
        { header: "Unit", key: "unit", width: 8 },
        { header: "Value at cost", key: "value", numFmt: INR },
      ],
      r.writeOffRows.map((w) => ({ ...w, reason: TXN_LABEL[w.type] ?? w.type })),
    );
    filename = `inventory-report-${range.from}-to-${range.to}.xlsx`;
  } else {
    const rows = await loadStockRows(scope.ids);
    const branchCols = scope.isAll ? scope.branches.filter((b) => scope.ids.includes(b.id)) : [];
    sheet(
      wb,
      "Stock",
      [
        { header: "Product ID", key: "sku", width: 12 },
        { header: "Product", key: "name", width: 34 },
        { header: "Category", key: "category" },
        { header: "Brand", key: "brand" },
        { header: "Unit", key: "unit", width: 8 },
        ...branchCols.map((b) => ({ header: `Stock – ${b.name}`, key: `b_${b.id}`, numFmt: QTY })),
        { header: "Stock (total)", key: "stock", numFmt: QTY },
        { header: "Minimum", key: "minStock", numFmt: QTY },
        { header: "Status", key: "status", width: 12 },
        { header: "Nearest expiry", key: "nearestExpiry", width: 14, numFmt: "dd-mmm-yyyy" },
        { header: "Purchase price", key: "purchasePrice", numFmt: INR },
        { header: "Selling price", key: "sellingPrice", numFmt: INR },
        { header: "Value at cost", key: "value", numFmt: INR },
        { header: "Supplier", key: "supplierName", width: 26 },
        { header: "Retail", key: "retail", width: 8 },
        { header: "Active", key: "active", width: 8 },
      ],
      rows.map((r) => ({
        ...r,
        ...Object.fromEntries(branchCols.map((b) => [`b_${b.id}`, r.byBranch[b.id] ?? 0])),
        status: r.status === "OUT" ? "Out of stock" : r.status === "LOW" ? "Low" : "OK",
        retail: r.isRetail ? "Yes" : "No",
        active: r.isActive ? "Yes" : "No",
      })),
    );
    filename = `stock-${istDateKey()}.xlsx`;
  }

  await audit(user.id, "EXPORT", "Inventory", null, `Exported inventory ${type} (${branchLabel}) to Excel`);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
