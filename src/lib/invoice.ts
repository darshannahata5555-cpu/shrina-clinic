// Pure invoice helpers (client-safe): amount in words (Indian numbering), discount policy.

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? twoDigits(rest) : ""].filter(Boolean).join(" ");
}

/** Integer → words using the Indian system (thousand, lakh, crore). */
export function numberToIndianWords(num: number): string {
  let n = Math.floor(Math.abs(num));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? numberToIndianWords(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}

/** e.g. 5310.5 → "Rupees Five Thousand Three Hundred Ten and Fifty Paise Only" */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount) + 1e-9);
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let s = `Rupees ${numberToIndianWords(rupees)}`;
  if (paise > 0) s += ` and ${twoDigits(paise)} Paise`;
  return `${amount < 0 ? "Minus " : ""}${s} Only`;
}

/**
 * Discount policy:
 * - Any discount needs the `billing.discount` permission.
 * - Up to `maxPercent` (Settings → Billing) of a line's value is allowed for everyone with that permission.
 * - Above that only the Owner, or users who can also issue refunds (`billing.refund`, i.e. accounts seniors),
 *   may approve the larger discount themselves.
 */
export function discountAllowance(opts: { canDiscount: boolean; unlimited: boolean; maxPercent: number }) {
  if (!opts.canDiscount) return 0;
  return opts.unlimited ? 100 : Math.max(0, Math.min(100, opts.maxPercent));
}

export const SERVICE_SAC_DEFAULT = "999722";
