import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { fmtDate, fmtDateTime, money, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { amountInWords } from "@/lib/invoice";
import { PrintToolbar } from "../../_components/print-toolbar";

export const metadata = { title: "Print invoice" };

const n2 = (v: unknown) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNum(v as number));

export default async function PrintInvoicePage({ params, searchParams }: PageProps<"/billing/[id]/print">) {
  const user = await requirePermission("billing.view");
  const scope = await getBranchScope();
  const { id } = await params;
  const { auto } = await searchParams;
  const inv = await db.invoice.findFirst({
    where: { id, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } },
    include: {
      patient: { select: { fullName: true, code: true, mobile: true, email: true, address: true } },
      branch: true,
      items: true,
      payments: { orderBy: { paidAt: "asc" } },
      creditNotes: true,
    },
  });
  if (!inv) notFound();
  const clinic = await getSetting("clinic");
  // Log print/PDF access, but at most once per user per invoice every 10 minutes (refreshes don't spam the log).
  const recentPrint = await db.auditLog.findFirst({
    where: { userId: user.id, action: "EXPORT", entity: "Invoice", entityId: inv.id, createdAt: { gte: new Date(Date.now() - 10 * 60000) } },
    select: { id: true },
  });
  if (!recentPrint) await audit(user.id, "EXPORT", "Invoice", inv.id, `Opened print view of invoice ${inv.number}`, { branchId: inv.branchId });

  const gstin = inv.branch.gstin || clinic.gstin;
  const cancelled = inv.status === "CANCELLED";
  const hasDiscount = inv.items.some((i) => toNum(i.discount) > 0);
  const th = "border-b border-neutral-300 px-2 py-1.5 text-left font-semibold text-neutral-700";
  const td = "border-b border-neutral-200 px-2 py-1.5 align-top";

  return (
    <div className="-mx-4 -my-5 bg-surface-3 px-4 py-6 sm:-mx-6 sm:-my-7 sm:px-6 print:m-0 print:bg-white print:p-0">
      <PrintToolbar backHref={`/billing/${inv.id}`} backLabel={`Back to ${inv.number}`} auto={auto === "1"} />
      <article className="print-plain relative mx-auto max-w-[210mm] bg-white p-[12mm] text-[11.5px] leading-relaxed text-neutral-900 shadow-pop" style={{ colorScheme: "light" }}>
        {cancelled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-20deg] rounded-lg border-4 border-red-600/40 px-6 py-2 text-5xl font-bold tracking-widest text-red-600/40">CANCELLED</span>
          </div>
        )}
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-900 pb-4">
          <div>
            <p className="text-[22px] font-bold tracking-[0.25em]">{clinic.clinicName || "SHRINA"}</p>
            <p className="text-[12px] font-medium">{clinic.legalName}</p>
            <p className="mt-1 max-w-[95mm] text-neutral-600">
              {inv.branch.name}
              {inv.branch.address ? ` · ${inv.branch.address}` : clinic.address ? ` · ${clinic.address}` : ""}
            </p>
            <p className="text-neutral-600">
              {[inv.branch.phone || clinic.phone, inv.branch.email || clinic.email, clinic.website].filter(Boolean).join(" · ")}
            </p>
            {gstin && <p className="mt-1 font-medium">GSTIN: {gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold tracking-wide">TAX INVOICE</p>
            <p className="mt-1">
              <span className="text-neutral-500">Invoice no.</span> <span className="font-semibold">{inv.number}</span>
            </p>
            <p>
              <span className="text-neutral-500">Date</span> {fmtDate(inv.date)}
            </p>
            <p>
              <span className="text-neutral-500">Place of supply</span> {clinic.state}
              {clinic.stateCode ? ` (${clinic.stateCode})` : ""}
            </p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-3">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Billed to</p>
            <p className="text-[13px] font-semibold">{inv.patient.fullName}</p>
            <p>Patient ID: {inv.patient.code}</p>
            <p>Mobile: {inv.patient.mobile}</p>
            {inv.patient.email && <p>{inv.patient.email}</p>}
            {inv.patient.address && <p className="text-neutral-600">{inv.patient.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Status</p>
            <p className="text-[13px] font-semibold">{cancelled ? "Cancelled" : toNum(inv.balance) <= 0 ? "Paid in full" : toNum(inv.paidAmount) > 0 ? "Partially paid" : "Payment due"}</p>
          </div>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="bg-neutral-100">
              <th className={th}>#</th>
              <th className={th}>Description</th>
              <th className={th}>SAC/HSN</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Rate</th>
              {hasDiscount && <th className={`${th} text-right`}>Disc.</th>}
              <th className={`${th} text-right`}>Taxable</th>
              <th className={`${th} text-right`}>GST</th>
              <th className={`${th} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {inv.items.map((it, i) => (
              <tr key={it.id}>
                <td className={td}>{i + 1}</td>
                <td className={td}>{it.description}</td>
                <td className={td}>{it.hsnSac ?? ""}</td>
                <td className={`${td} text-right`}>{toNum(it.quantity)}</td>
                <td className={`${td} text-right`}>{n2(it.unitPrice)}</td>
                {hasDiscount && <td className={`${td} text-right`}>{toNum(it.discount) ? n2(it.discount) : "—"}</td>}
                <td className={`${td} text-right`}>{n2(it.taxable)}</td>
                <td className={`${td} text-right`}>
                  {toNum(it.gstRate)}%<br />
                  <span className="text-neutral-500">{n2(it.tax)}</span>
                </td>
                <td className={`${td} text-right font-medium`}>{n2(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-4 flex items-start justify-between gap-8">
          <div className="max-w-[95mm] flex-1">
            <p className="text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Amount in words</p>
            <p className="font-medium">{amountInWords(toNum(inv.total))}</p>
            {inv.notes && (
              <>
                <p className="mt-3 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Notes</p>
                <p>{inv.notes}</p>
              </>
            )}
          </div>
          <table className="tabular w-[75mm] border-collapse">
            <tbody>
              {[
                ["Subtotal", n2(inv.subtotal)],
                ...(toNum(inv.discountTotal) ? [["Discount", `−${n2(inv.discountTotal)}`]] : []),
                ["Taxable value", n2(inv.taxableAmount)],
                ...(toNum(inv.igst)
                  ? [["IGST", n2(inv.igst)]]
                  : [
                      ["CGST", n2(inv.cgst)],
                      ["SGST", n2(inv.sgst)],
                    ]),
                ...(toNum(inv.roundOff) ? [["Round off", n2(inv.roundOff)]] : []),
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 text-neutral-600">{k}</td>
                  <td className="py-0.5 text-right">{v}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-neutral-900 text-[14px] font-bold">
                <td className="pt-1.5">Total (₹)</td>
                <td className="pt-1.5 text-right">{n2(inv.total)}</td>
              </tr>
              <tr>
                <td className="pt-1 text-neutral-600">Paid</td>
                <td className="pt-1 text-right">{n2(inv.paidAmount)}</td>
              </tr>
              {toNum(inv.creditedAmount) > 0 && (
                <tr>
                  <td className="text-neutral-600">Credited</td>
                  <td className="text-right">{n2(inv.creditedAmount)}</td>
                </tr>
              )}
              <tr className="font-semibold">
                <td>Balance due</td>
                <td className="text-right">{n2(inv.balance)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {inv.payments.length > 0 && (
          <section className="mt-5">
            <p className="text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Payments received</p>
            <table className="mt-1 w-full border-collapse">
              <tbody className="tabular">
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>{p.receiptNo}</td>
                    <td className={td}>{fmtDateTime(p.paidAt)}</td>
                    <td className={td}>
                      {p.kind === "REFUND" ? "Refund · " : ""}
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </td>
                    <td className={`${td} text-right`}>
                      {p.kind === "REFUND" ? "−" : ""}
                      {money(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="mt-8 grid grid-cols-[1fr_auto] items-end gap-8 border-t border-neutral-300 pt-3 text-[10.5px] text-neutral-600">
          <div>
            {clinic.terms && (
              <p>
                <span className="font-semibold text-neutral-800">Terms: </span>
                {clinic.terms}
              </p>
            )}
            {clinic.invoiceFooter && <p className="mt-1">{clinic.invoiceFooter}</p>}
          </div>
          <div className="text-center">
            <div className="mb-1 h-10" />
            <p className="border-t border-neutral-400 px-6 pt-1">Authorised signatory</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
