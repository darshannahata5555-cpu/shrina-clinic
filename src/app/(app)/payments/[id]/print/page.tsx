import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { getSetting } from "@/lib/settings";
import { advanceBalance } from "@/lib/billing";
import { fmtDateTime, money, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { amountInWords } from "@/lib/invoice";
import { PrintToolbar } from "../../../billing/_components/print-toolbar";

export const metadata = { title: "Payment receipt" };

export default async function ReceiptPrintPage({ params, searchParams }: PageProps<"/payments/[id]/print">) {
  await requirePermission("billing.view");
  const scope = await getBranchScope();
  const { id } = await params;
  const { auto } = await searchParams;
  const p = await db.payment.findFirst({
    where: { id, branchId: { in: scope.branches.map((b) => b.id) } },
    include: {
      patient: { select: { id: true, fullName: true, code: true, mobile: true } },
      invoice: { select: { number: true, total: true, balance: true, status: true } },
      branch: true,
    },
  });
  if (!p) notFound();
  const [clinic, receiver, advance] = await Promise.all([
    getSetting("clinic"),
    p.receivedById ? db.user.findUnique({ where: { id: p.receivedById }, select: { name: true } }) : null,
    advanceBalance(p.patientId),
  ]);
  const refund = p.kind === "REFUND";
  const title = refund ? "REFUND VOUCHER" : p.invoiceId ? "PAYMENT RECEIPT" : "ADVANCE RECEIPT";
  const rows: [string, string][] = [
    ["Receipt no.", p.receiptNo],
    ["Date", fmtDateTime(p.paidAt)],
    ["Patient", `${p.patient.fullName} (${p.patient.code})`],
    ["Mobile", p.patient.mobile],
    ["Against", p.invoice ? `Invoice ${p.invoice.number}` : refund ? "Advance balance" : "Advance / on account"],
    ["Mode", PAYMENT_METHOD_LABEL[p.method] ?? p.method],
    ...(p.reference ? ([["Reference", p.reference]] as [string, string][]) : []),
    ...(p.notes ? ([["Note", p.notes]] as [string, string][]) : []),
  ];

  return (
    <div className="-mx-4 -my-5 bg-surface-3 px-4 py-6 sm:-mx-6 sm:-my-7 sm:px-6 print:m-0 print:bg-white print:p-0">
      <PrintToolbar backHref="/payments" backLabel="Back to payments" auto={auto === "1"} />
      <article className="print-plain mx-auto max-w-[148mm] bg-white p-[10mm] text-[12px] leading-relaxed text-neutral-900 shadow-pop" style={{ colorScheme: "light" }}>
        <header className="flex items-start justify-between gap-4 border-b-2 border-neutral-900 pb-3">
          <div>
            <p className="text-[18px] font-bold tracking-[0.25em]">{clinic.clinicName || "SHRINA"}</p>
            <p className="text-[11px]">{clinic.legalName}</p>
            <p className="text-[11px] text-neutral-600">{p.branch.name}{p.branch.phone ? ` · ${p.branch.phone}` : ""}</p>
            {(p.branch.gstin || clinic.gstin) && <p className="text-[11px]">GSTIN: {p.branch.gstin || clinic.gstin}</p>}
          </div>
          <p className="text-right text-[13px] font-bold tracking-wide">{title}</p>
        </header>
        <table className="mt-3 w-full">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="w-32 py-1 align-top text-neutral-500">{k}</td>
                <td className="py-1 font-medium">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 rounded border border-neutral-300 px-4 py-3">
          <p className="text-[11px] text-neutral-500">{refund ? "Amount refunded" : "Amount received"}</p>
          <p className="tabular text-[22px] font-bold">{money(p.amount)}</p>
          <p className="text-[11px]">{amountInWords(toNum(p.amount))}</p>
        </div>
        {p.invoice && (
          <p className="mt-3 text-[11px] text-neutral-600">
            Invoice {p.invoice.number} total {money(p.invoice.total)} · balance now {money(p.invoice.status === "CANCELLED" ? 0 : p.invoice.balance)}
          </p>
        )}
        {advance > 0 && <p className="mt-1 text-[11px] text-neutral-600">Advance balance available: {money(advance)}</p>}
        <footer className="mt-10 flex items-end justify-between text-[11px] text-neutral-600">
          <p>Received by: {receiver?.name ?? "—"}</p>
          <p className="border-t border-neutral-400 px-6 pt-1">Authorised signatory</p>
        </footer>
      </article>
    </div>
  );
}
