// Pure GST / invoice maths — safe to import from client components (live invoice preview) and server.
import { r2 } from "./format";
import type { InvoiceItemKind } from "@prisma/client";

export type LineInput = {
  kind: InvoiceItemKind;
  description: string;
  quantity: number;
  unitPrice: number;
  /** flat discount amount for the line (₹) */
  discount: number;
  gstRate: number;
  treatmentId?: string | null;
  productId?: string | null;
  packageId?: string | null;
  hsnSac?: string | null;
};

export type ComputedLine = LineInput & { gross: number; taxable: number; tax: number; total: number };

export type InvoiceTotals = {
  lines: ComputedLine[];
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  roundOff: number;
  total: number;
};

/**
 * GST maths. With `pricesIncludeGst` the unit price is tax-inclusive and the
 * taxable value is backed out; otherwise GST is added on top. Intra-state supply
 * splits tax equally into CGST + SGST; inter-state uses IGST.
 */
export function computeInvoice(
  lines: LineInput[],
  opts: { gstEnabled: boolean; pricesIncludeGst: boolean; roundOff: boolean; interState?: boolean },
): InvoiceTotals {
  const computed: ComputedLine[] = lines.map((l) => {
    const gross = r2(l.quantity * l.unitPrice);
    const after = r2(Math.max(0, gross - (l.discount || 0)));
    const rate = opts.gstEnabled ? l.gstRate || 0 : 0;
    let taxable: number, tax: number;
    if (opts.pricesIncludeGst && rate > 0) {
      taxable = r2(after / (1 + rate / 100));
      tax = r2(after - taxable);
    } else {
      taxable = after;
      tax = r2((after * rate) / 100);
    }
    return { ...l, gstRate: rate, gross, taxable, tax, total: r2(taxable + tax) };
  });

  const subtotal = r2(computed.reduce((s, l) => s + l.gross, 0));
  const discountTotal = r2(computed.reduce((s, l) => s + Math.min(l.discount || 0, l.gross), 0));
  const taxableAmount = r2(computed.reduce((s, l) => s + l.taxable, 0));
  const taxTotal = r2(computed.reduce((s, l) => s + l.tax, 0));
  const cgst = opts.interState ? 0 : r2(taxTotal / 2);
  const sgst = opts.interState ? 0 : r2(taxTotal - cgst);
  const igst = opts.interState ? taxTotal : 0;
  const exact = r2(taxableAmount + taxTotal);
  const total = opts.roundOff ? Math.round(exact) : exact;
  return { lines: computed, subtotal, discountTotal, taxableAmount, cgst, sgst, igst, taxTotal, roundOff: r2(total - exact), total };
}

