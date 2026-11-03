import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { istDateKey, toNum } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/status";
import { expenseWhere, seesAllExpenses } from "@/app/(app)/expenses/_lib/access";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissions.has("reports.export") || !seesAllExpenses(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await getBranchScope();
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const expenses = await db.expense.findMany({
    where: expenseWhere(sp, user, scope.ids),
    include: { branch: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 20000,
  });
  const ids = [...new Set(expenses.flatMap((e) => [e.addedById, e.approvedById]).filter(Boolean) as string[])];
  const users = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "SHRINA Clinic";
  const ws = wb.addWorksheet("Expenses");
  ws.columns = [
    { header: "Expense ID", key: "code", width: 12 },
    { header: "Date", key: "date", width: 13, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "Branch", key: "branch", width: 20 },
    { header: "Category", key: "category", width: 24 },
    { header: "Paid to", key: "paidTo", width: 28 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: '"₹"#,##0.00' } },
    { header: "Payment method", key: "method", width: 16 },
    { header: "Description", key: "description", width: 40 },
    { header: "Status", key: "status", width: 11 },
    { header: "Added by", key: "addedBy", width: 20 },
    { header: "Approved / reviewed by", key: "approvedBy", width: 22 },
    { header: "Rejection reason", key: "rejection", width: 30 },
    { header: "Receipt attached", key: "receipt", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const e of expenses) {
    ws.addRow({
      code: e.code,
      date: e.date,
      branch: e.branch.name,
      category: EXPENSE_CATEGORY_LABEL[e.category],
      paidTo: e.paidTo,
      amount: toNum(e.amount),
      method: PAYMENT_METHOD_LABEL[e.method],
      description: e.description ?? "",
      status: e.status,
      addedBy: (e.addedById && users.get(e.addedById)) || "",
      approvedBy: (e.approvedById && users.get(e.approvedById)) || "",
      rejection: e.rejectionReason ?? "",
      receipt: e.receiptPath ? "Yes" : "No",
    });
  }
  const totalRow = ws.addRow({ paidTo: "Total (excl. rejected)", amount: expenses.filter((e) => e.status !== "REJECTED").reduce((s, e) => s + toNum(e.amount), 0) });
  totalRow.font = { bold: true };

  await audit(user.id, "EXPORT", "Expense", null, `Exported ${expenses.length} expenses (${scope.current?.name ?? "All branches"}) to Excel`);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="expenses-${istDateKey()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
