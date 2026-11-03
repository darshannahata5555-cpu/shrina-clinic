"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Single-series column chart (dataviz spec: ≤24px bars, 4px rounded data-end,
 * hairline solid horizontal grid, recessive axes, hover tooltip, no legend for one series).
 * Values are formatted as INR when `currency` is set.
 */
export function SimpleBarChart({
  data,
  currency = true,
  height = 220,
  seriesLabel = "Value",
}: {
  data: { label: string; value: number; sub?: string }[];
  currency?: boolean;
  height?: number;
  seriesLabel?: string;
}) {
  const fmtFull = (v: number) =>
    currency ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v) : new Intl.NumberFormat("en-IN").format(v);
  const fmtTick = (v: number) => {
    const a = Math.abs(v);
    const p = currency ? "₹" : "";
    if (a >= 1e7) return `${p}${+(v / 1e7).toFixed(1)}Cr`;
    if (a >= 1e5) return `${p}${+(v / 1e5).toFixed(1)}L`;
    if (a >= 1e4) return `${p}${+(v / 1e3).toFixed(0)}K`;
    return `${p}${new Intl.NumberFormat("en-IN").format(v)}`;
  };

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} tick={{ fill: "var(--muted)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={fmtTick} width={52} />
          <Tooltip
            cursor={{ fill: "var(--surface-3)", opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as { label: string; value: number; sub?: string };
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
                  <p className="font-medium text-ink">{d.sub ?? d.label}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-ink-2">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--accent)" }} />
                    {seriesLabel}: <span className="tabular font-medium text-ink">{fmtFull(d.value)}</span>
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
