"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Plus, Receipt, Sparkles, Stethoscope, Trash2, TriangleAlert, Wallet, PenLine } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea, Label } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PatientPicker, type PickedPatient } from "@/components/pickers/patient-picker";
import { computeInvoice, type LineInput } from "@/lib/gst";
import { cn, money, r2 } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { amountInWords } from "@/lib/invoice";
import { createInvoiceAction } from "../actions";

type Kind = "TREATMENT" | "PACKAGE" | "PRODUCT" | "CONSULTATION" | "OTHER";
export type BuilderLine = {
  kind: Kind;
  treatmentId?: string | null;
  productId?: string | null;
  packageId?: string | null;
  pkgMode?: "existing" | "new";
  newPkg?: { treatmentId: string; totalSessions: number; bodyArea: string };
  description?: string;
  quantity: number;
  unitPrice: number;
  discountValue?: number;
  discountMode?: "amt" | "pct";
};
type Line = BuilderLine & { key: number };

type Treatment = { id: string; name: string; category: string; price: number; gstRate: number; sessions: number };
type Product = { id: string; name: string; sku: string; unit: string; price: number; gstRate: number };
type Ctx = {
  advance: number;
  unbilledPackages: { id: string; code: string; name: string; price: number; totalSessions: number; completedSessions: number; treatmentId: string; gstRate: number }[];
  openInvoices: { id: string; number: string; balance: number }[];
};
type PayRow = { key: number; method: string; amount: string; reference: string };

const METHODS = ["UPI", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;
const KIND_META: Record<Kind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  TREATMENT: { label: "Treatment", icon: Sparkles },
  PACKAGE: { label: "Package", icon: Package },
  PRODUCT: { label: "Product", icon: Receipt },
  CONSULTATION: { label: "Consultation", icon: Stethoscope },
  OTHER: { label: "Other", icon: PenLine },
};

let seq = 1;

export function InvoiceBuilder(props: {
  patient: PickedPatient | null;
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  today: string;
  treatments: Treatment[];
  products: Product[];
  stock: Record<string, Record<string, number>>;
  billing: { gstEnabled: boolean; pricesIncludeGst: boolean; roundOff: boolean; defaultServiceGst: number };
  canDiscount: boolean;
  discountLimit: number;
  initialLines: BuilderLine[];
}) {
  const { treatments, products, billing } = props;
  const T = useMemo(() => new Map(treatments.map((t) => [t.id, t])), [treatments]);
  const P = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const consultTreatment = treatments.find((t) => t.category === "Consultation");

  const [patient, setPatient] = useState<PickedPatient | null>(props.patient);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [branchId, setBranchId] = useState(props.defaultBranchId);
  const [lines, setLines] = useState<Line[]>(() => props.initialLines.map((l) => ({ ...l, key: seq++ })));
  const [pays, setPays] = useState<PayRow[]>([{ key: seq++, method: "UPI", amount: "", reference: "" }]);
  const [advanceUse, setAdvanceUse] = useState("");

  useEffect(() => {
    setCtx(null);
    if (!patient) return;
    let alive = true;
    fetch(`/api/billing/patient-context?patientId=${patient.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setCtx(d));
    return () => {
      alive = false;
    };
  }, [patient]);

  const PK = useMemo(() => new Map((ctx?.unbilledPackages ?? []).map((p) => [p.id, p])), [ctx]);
  const stockAt = props.stock[branchId] ?? {};

  // Derive server-shaped lines for the GST maths.
  const derived = lines.map((l) => {
    let unitPrice = l.unitPrice;
    let gstRate = billing.defaultServiceGst;
    const description = l.description?.trim() || "";
    let label = "";
    if (l.kind === "TREATMENT" && l.treatmentId) {
      const t = T.get(l.treatmentId);
      if (t) ((unitPrice = t.price), (gstRate = t.gstRate), (label = t.name));
    } else if (l.kind === "PRODUCT" && l.productId) {
      const p = P.get(l.productId);
      if (p) ((unitPrice = p.price), (gstRate = p.gstRate), (label = p.name));
    } else if (l.kind === "PACKAGE") {
      if (l.pkgMode !== "new" && l.packageId) {
        const pk = PK.get(l.packageId);
        if (pk) ((unitPrice = pk.price), (gstRate = pk.gstRate), (label = `${pk.name} (${pk.code})`));
      } else if (l.pkgMode === "new" && l.newPkg?.treatmentId) {
        const t = T.get(l.newPkg.treatmentId);
        if (t) {
          gstRate = t.gstRate;
          const area = l.newPkg.bodyArea && !t.name.toLowerCase().includes(l.newPkg.bodyArea.toLowerCase()) ? ` – ${l.newPkg.bodyArea}` : "";
          label = `${t.name}${area} · ${l.newPkg.totalSessions} session${l.newPkg.totalSessions > 1 ? "s" : ""}`;
        }
      }
    } else if (l.kind === "CONSULTATION") label = "Doctor consultation";
    const qty = l.kind === "PACKAGE" ? 1 : l.quantity || 0;
    const gross = r2(qty * (unitPrice || 0));
    const dv = l.discountValue || 0;
    const discount = r2(Math.min(gross, l.discountMode === "pct" ? (gross * dv) / 100 : dv));
    return {
      line: l,
      input: { kind: l.kind, description: description || label, quantity: qty, unitPrice: unitPrice || 0, discount, gstRate: billing.gstEnabled ? gstRate : 0 } as LineInput,
      gross,
      label,
      pct: gross > 0 ? (discount / gross) * 100 : 0,
    };
  });
  const totals = computeInvoice(derived.map((d) => d.input), { gstEnabled: billing.gstEnabled, pricesIncludeGst: billing.pricesIncludeGst, roundOff: billing.roundOff });
  const paid = r2(pays.reduce((s, p) => s + (Number(p.amount) || 0), 0) + (Number(advanceUse) || 0));
  const due = r2(totals.total - paid);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (kind: Kind) => {
    const base: Line = { key: seq++, kind, quantity: 1, unitPrice: 0, discountMode: "amt", discountValue: 0 };
    if (kind === "PACKAGE") base.pkgMode = ctx?.unbilledPackages.length ? "existing" : "new";
    if (kind === "PACKAGE" && base.pkgMode === "new") base.newPkg = { treatmentId: "", totalSessions: 6, bodyArea: "" };
    if (kind === "CONSULTATION" && consultTreatment) ((base.unitPrice = consultTreatment.price), (base.treatmentId = consultTreatment.id));
    setLines((ls) => [...ls, base]);
  };

  const problems: string[] = [];
  derived.forEach((d, i) => {
    const l = d.line;
    if (l.kind === "TREATMENT" && !l.treatmentId) problems.push(`Item ${i + 1}: choose a treatment`);
    if (l.kind === "PRODUCT") {
      if (!l.productId) problems.push(`Item ${i + 1}: choose a product`);
      else if ((stockAt[l.productId] ?? 0) < d.input.quantity) problems.push(`Item ${i + 1}: only ${stockAt[l.productId] ?? 0} in stock at this branch`);
    }
    if (l.kind === "PACKAGE" && l.pkgMode !== "new" && !l.packageId) problems.push(`Item ${i + 1}: choose a package`);
    if (l.kind === "PACKAGE" && l.pkgMode === "new" && (!l.newPkg?.treatmentId || !(l.unitPrice > 0))) problems.push(`Item ${i + 1}: choose treatment and price`);
    if (l.kind === "OTHER" && !l.description?.trim()) problems.push(`Item ${i + 1}: add a description`);
    if (d.pct > props.discountLimit + 0.01) problems.push(`Item ${i + 1}: discount above your ${props.discountLimit}% limit`);
  });
  if (paid > totals.total + 0.009) problems.push("Payments are more than the invoice total");
  if ((Number(advanceUse) || 0) > (ctx?.advance ?? 0) + 0.009) problems.push("Advance used is more than the available balance");

  const linesJson = JSON.stringify(
    derived.map((d) => ({
      kind: d.line.kind,
      description: d.line.description?.trim() || "",
      treatmentId: d.line.kind === "PACKAGE" ? null : d.line.treatmentId ?? null,
      productId: d.line.productId ?? null,
      packageId: d.line.kind === "PACKAGE" && d.line.pkgMode !== "new" ? d.line.packageId ?? null : null,
      newPackage:
        d.line.kind === "PACKAGE" && d.line.pkgMode === "new" && d.line.newPkg
          ? { treatmentId: d.line.newPkg.treatmentId, totalSessions: d.line.newPkg.totalSessions, bodyArea: d.line.newPkg.bodyArea || null }
          : null,
      quantity: d.input.quantity,
      unitPrice: d.input.unitPrice,
      discount: d.input.discount,
    })),
  );
  const paysJson = JSON.stringify(pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference || null })));

  return (
    <ActionForm action={createInvoiceAction} refresh={false}>
      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="payments" value={paysJson} />
      <input type="hidden" name="advanceAmount" value={advanceUse || "0"} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Bill to" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Patient" required className="sm:col-span-2">
                <PatientPicker defaultValue={props.patient} onChange={setPatient} required />
              </Field>
              {props.branches.length > 1 ? (
                <Field label="Billing branch" hint="Invoice series and stock are taken from this branch">
                  <Select name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={props.branches.map((b) => [b.id, b.name] as const)} />
                </Field>
              ) : (
                <input type="hidden" name="branchId" value={branchId} />
              )}
              <Field label="Invoice date" required>
                <Input type="date" name="date" defaultValue={props.today} max={props.today} required />
              </Field>
              {ctx && ctx.openInvoices.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning sm:col-span-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {ctx.openInvoices.length} earlier invoice{ctx.openInvoices.length > 1 ? "s" : ""} unpaid ·{" "}
                  {money(ctx.openInvoices.reduce((s, i) => s + i.balance, 0))} outstanding
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Items"
              description={
                !props.canDiscount
                  ? "Prices come from the catalogue. Your role can't give discounts."
                  : props.discountLimit >= 100
                    ? "Prices come from the treatment & product catalogue. Your role can approve any discount."
                    : `Prices come from the treatment & product catalogue. You can give up to ${props.discountLimit}% discount per item — larger discounts need the owner or accounts.`
              }
            />
            <CardBody className="space-y-3">
              {lines.length === 0 && <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">No items yet — add a treatment, package or product below.</p>}
              {derived.map((d, i) => {
                const l = d.line;
                const Icon = KIND_META[l.kind].icon;
                const comp = totals.lines[i];
                return (
                  <div key={l.key} className="rounded-xl border border-border bg-surface-2 p-3 sm:p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Badge tone="accent">
                        <Icon className="h-3 w-3" /> {KIND_META[l.kind].label}
                      </Badge>
                      <span className="flex-1" />
                      <span className="tabular text-sm font-semibold">{money(comp?.total ?? 0)}</span>
                      <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-muted hover:bg-surface-3 hover:text-danger" aria-label="Remove item">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
                      {/* item selector */}
                      <div className="col-span-2 md:col-span-12">
                        {l.kind === "TREATMENT" && (
                          <Select
                            value={l.treatmentId ?? ""}
                            onChange={(e) => update(l.key, { treatmentId: e.target.value })}
                            placeholder="Choose treatment…"
                            options={treatments.filter((t) => t.category !== "Consultation").map((t) => [t.id, `${t.name} — ${money(t.price, { decimals: false })}`] as const)}
                          />
                        )}
                        {l.kind === "PRODUCT" && (
                          <Select
                            value={l.productId ?? ""}
                            onChange={(e) => update(l.key, { productId: e.target.value })}
                            placeholder="Choose product…"
                            options={products.map((p) => [p.id, `${p.name} — ${money(p.price, { decimals: false })} · ${stockAt[p.id] ?? 0} in stock`] as const)}
                          />
                        )}
                        {l.kind === "PACKAGE" && (
                          <div className="space-y-3">
                            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-[13px]">
                              {(["existing", "new"] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => update(l.key, { pkgMode: m, newPkg: m === "new" ? l.newPkg ?? { treatmentId: "", totalSessions: 6, bodyArea: "" } : l.newPkg })}
                                  className={cn("rounded-md px-3 py-1.5 font-medium", (l.pkgMode ?? "existing") === m ? "bg-ink text-bg" : "text-muted hover:text-ink")}
                                >
                                  {m === "existing" ? "Existing package" : "Sell new package"}
                                </button>
                              ))}
                            </div>
                            {l.pkgMode !== "new" ? (
                              ctx && ctx.unbilledPackages.length === 0 ? (
                                <p className="text-[13px] text-muted">This patient has no unbilled packages. Switch to “Sell new package”.</p>
                              ) : (
                                <Select
                                  value={l.packageId ?? ""}
                                  onChange={(e) => update(l.key, { packageId: e.target.value })}
                                  placeholder={patient ? (ctx ? "Choose package…" : "Loading…") : "Pick a patient first"}
                                  options={(ctx?.unbilledPackages ?? []).map((p) => [p.id, `${p.code} · ${p.name} — ${money(p.price, { decimals: false })}`] as const)}
                                />
                              )
                            ) : (
                              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                                <div className="col-span-2 md:col-span-3">
                                  <Label>Treatment</Label>
                                  <Select
                                    value={l.newPkg?.treatmentId ?? ""}
                                    onChange={(e) => {
                                      const t = T.get(e.target.value);
                                      const sessions = t?.sessions ?? 1;
                                      update(l.key, { newPkg: { treatmentId: e.target.value, totalSessions: sessions, bodyArea: l.newPkg?.bodyArea ?? "" }, unitPrice: t ? t.price * sessions : 0 });
                                    }}
                                    placeholder="Choose…"
                                    options={treatments.filter((t) => t.category !== "Consultation").map((t) => [t.id, t.name] as const)}
                                  />
                                </div>
                                <div>
                                  <Label>Sessions</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={l.newPkg?.totalSessions ?? 1}
                                    onChange={(e) => {
                                      const n = Math.max(1, Number(e.target.value) || 1);
                                      const t = l.newPkg?.treatmentId ? T.get(l.newPkg.treatmentId) : null;
                                      update(l.key, { newPkg: { ...(l.newPkg ?? { treatmentId: "", bodyArea: "" }), totalSessions: n }, unitPrice: t ? t.price * n : l.unitPrice });
                                    }}
                                  />
                                </div>
                                <div className="col-span-2 md:col-span-2">
                                  <Label>Body area</Label>
                                  <Input value={l.newPkg?.bodyArea ?? ""} placeholder="e.g. Full body" onChange={(e) => update(l.key, { newPkg: { ...(l.newPkg ?? { treatmentId: "", totalSessions: 1 }), bodyArea: e.target.value } })} />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {(l.kind === "CONSULTATION" || l.kind === "OTHER") && (
                          <Input
                            value={l.description ?? ""}
                            onChange={(e) => update(l.key, { description: e.target.value })}
                            placeholder={l.kind === "OTHER" ? "Description (required)" : "Doctor consultation"}
                          />
                        )}
                      </div>

                      {/* numbers */}
                      <div className="md:col-span-2">
                        <Label>Qty</Label>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={l.kind === "PACKAGE" ? 1 : l.quantity}
                          disabled={l.kind === "PACKAGE"}
                          onChange={(e) => update(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </div>
                      <div className="md:col-span-3">
                        <Label>Rate (₹)</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={d.input.unitPrice}
                          readOnly={!(l.kind === "CONSULTATION" || l.kind === "OTHER" || (l.kind === "PACKAGE" && l.pkgMode === "new"))}
                          className={cn(!(l.kind === "CONSULTATION" || l.kind === "OTHER" || (l.kind === "PACKAGE" && l.pkgMode === "new")) && "bg-surface-3 text-ink-2")}
                          onChange={(e) => update(l.key, { unitPrice: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="col-span-2 md:col-span-4">
                        <Label>Discount</Label>
                        <div className="flex gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={!props.canDiscount}
                            value={l.discountValue || ""}
                            placeholder="0"
                            aria-invalid={d.pct > props.discountLimit + 0.01 || undefined}
                            onChange={(e) => update(l.key, { discountValue: Math.max(0, Number(e.target.value) || 0) })}
                          />
                          <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface p-0.5 text-[12px]">
                            {(["amt", "pct"] as const).map((m) => (
                              <button key={m} type="button" disabled={!props.canDiscount} onClick={() => update(l.key, { discountMode: m })} className={cn("rounded-md px-2.5", (l.discountMode ?? "amt") === m ? "bg-ink text-bg" : "text-muted")}>
                                {m === "amt" ? "₹" : "%"}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 md:col-span-3">
                        <Label>GST</Label>
                        <p className="tabular flex h-9.5 items-center text-sm text-ink-2">
                          {billing.gstEnabled ? `${d.input.gstRate}% · ${money(comp?.tax ?? 0)}` : "Not applied"}
                        </p>
                      </div>
                    </div>
                    {d.input.discount > 0 && (
                      <p className="mt-2 text-xs text-muted">
                        Discount {money(d.input.discount)} ({d.pct.toFixed(1)}%) · taxable {money(comp?.taxable ?? 0)}
                      </p>
                    )}
                    {l.kind === "PRODUCT" && l.productId && (stockAt[l.productId] ?? 0) < d.input.quantity && (
                      <p className="mt-2 text-xs text-danger">Only {stockAt[l.productId] ?? 0} {P.get(l.productId)?.unit} in stock at this branch.</p>
                    )}
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2 pt-1">
                {(Object.keys(KIND_META) as Kind[]).map((k) => {
                  const Icon = KIND_META[k].icon;
                  return (
                    <Button key={k} type="button" variant="outline" size="sm" onClick={() => add(k)}>
                      <Plus className="h-3.5 w-3.5" /> <Icon className="h-3.5 w-3.5" /> {KIND_META[k].label}
                    </Button>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Field label="Notes on invoice">
                <Textarea name="notes" rows={2} placeholder="Optional — printed on the invoice" />
              </Field>
            </CardBody>
          </Card>
        </div>

        {/* Summary & payment */}
        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="Summary" description={billing.pricesIncludeGst ? "Prices include GST" : "GST added on top of prices"} />
            <CardBody className="space-y-2 text-sm">
              {[
                ["Subtotal", totals.subtotal],
                ["Discount", -totals.discountTotal],
                ["Taxable value", totals.taxableAmount],
                ["CGST", totals.cgst],
                ["SGST", totals.sgst],
                ...(totals.roundOff ? [["Round off", totals.roundOff] as [string, number]] : []),
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between text-ink-2">
                  <span>{k}</span>
                  <span className="tabular">{money(v as number)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="font-medium">Total</span>
                <span className="tabular text-2xl font-semibold">{money(totals.total)}</span>
              </div>
              <p className="text-xs text-muted">{amountInWords(totals.total)}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment now" description="Optional — leave blank to bill now and collect later." />
            <CardBody className="space-y-3">
              {pays.map((p) => (
                <div key={p.key} className="grid grid-cols-[1fr_110px_auto] gap-2">
                  <Select value={p.method} onChange={(e) => setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, method: e.target.value } : x)))} options={METHODS.map((m) => [m, PAYMENT_METHOD_LABEL[m]!] as const)} />
                  <Input type="number" min={0} step="0.01" placeholder="₹ 0" value={p.amount} onChange={(e) => setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)))} />
                  <button type="button" onClick={() => setPays((ps) => (ps.length > 1 ? ps.filter((x) => x.key !== p.key) : [{ ...p, amount: "", reference: "" }]))} className="rounded p-1 text-muted hover:text-danger" aria-label="Remove payment">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {p.method !== "CASH" && (
                    <Input
                      className="col-span-3"
                      placeholder="Reference (UTR / card last 4 / txn id)"
                      value={p.reference}
                      onChange={(e) => setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, reference: e.target.value } : x)))}
                    />
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPays((ps) => [...ps, { key: seq++, method: "CASH", amount: "", reference: "" }])}>
                  <Plus className="h-3.5 w-3.5" /> Split payment
                </Button>
                {due > 0 && (
                  <Button
                    type="button"
                    variant="soft"
                    size="sm"
                    onClick={() =>
                      setPays((ps) => {
                        const last = ps[ps.length - 1]!;
                        return ps.map((x) => (x.key === last.key ? { ...x, amount: String(r2((Number(x.amount) || 0) + due)) } : x));
                      })
                    }
                  >
                    Collect full {money(due)}
                  </Button>
                )}
              </div>

              {ctx && ctx.advance > 0 && (
                <div className="rounded-lg border border-border bg-surface-2 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <Wallet className="h-4 w-4 text-success" /> Advance available: {money(ctx.advance)}
                  </p>
                  <div className="flex gap-2">
                    <Input type="number" min={0} max={ctx.advance} step="0.01" placeholder="Use ₹ 0" value={advanceUse} onChange={(e) => setAdvanceUse(e.target.value)} />
                    <Button type="button" variant="outline" size="sm" className="h-9.5" onClick={() => setAdvanceUse(String(r2(Math.min(ctx.advance, Math.max(0, totals.total - (paid - (Number(advanceUse) || 0)))))))}>
                      Use max
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1 border-t border-border pt-3 text-sm">
                <div className="flex justify-between text-ink-2">
                  <span>Paying now</span>
                  <span className="tabular">{money(paid)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Balance due</span>
                  <span className={cn("tabular", due > 0 ? "text-warning" : "text-success")}>{money(Math.max(0, due))}</span>
                </div>
              </div>

              {problems.length > 0 && lines.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                  {problems.slice(0, 4).map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              )}
              <SubmitButton className="w-full" pendingText="Creating invoice…" disabled={!patient || lines.length === 0 || problems.length > 0}>
                Create invoice · {money(totals.total)}
              </SubmitButton>
            </CardBody>
          </Card>
        </div>
      </div>
    </ActionForm>
  );
}
