"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Report chart (dataviz rules): one axis, bars ≤24px with a 4px rounded data-end, 2px gap between
 * grouped bars, hairline solid grid, recessive axes, hover tooltip, a legend for ≥2 series, text in ink
 * tokens (never the series colour). Single-series charts use the clinic accent; multi-series use the
 * validated categorical slots 1–2 (blue / orange — light & dark steps checked with validate_palette.js).
 * Every chart is rendered above a table of the same rows (the accessible/table view).
 */

export type ReportChartSpec = {
  type: "column" | "grouped" | "hbar";
  x: string;
  series: { key: string; label: string }[];
  format?: "money" | "number" | "percent";
  limit?: number;
};

const VIZ_CSS = `
.viz{--series-1:#2a78d6;--series-2:#eb6834;}
[data-theme="dark"] .viz{--series-1:#3987e5;--series-2:#d95926;}
`;

function fmt(format: ReportChartSpec["format"], v: number, compact: boolean) {
  if (format === "percent") return `${+v.toFixed(1)}%`;
  if (format === "money") {
    if (!compact) return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
    const a = Math.abs(v);
    if (a >= 1e7) return `₹${+(v / 1e7).toFixed(1)}Cr`;
    if (a >= 1e5) return `₹${+(v / 1e5).toFixed(1)}L`;
    if (a >= 1e4) return `₹${+(v / 1e3).toFixed(0)}K`;
    return `₹${new Intl.NumberFormat("en-IN").format(Math.round(v))}`;
  }
  if (compact && Math.abs(v) >= 1e4) return `${+(v / 1e3).toFixed(0)}K`;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);
}

export function ReportChart({ spec, rows, title }: { spec: ReportChartSpec; rows: Record<string, string | number | null>[]; title: string }) {
  const multi = spec.series.length > 1;
  const color = (i: number) => (multi ? `var(--series-${i + 1})` : "var(--accent)");
  const data = (spec.limit ? rows.slice(0, spec.limit) : rows).map((r) => {
    const o: Record<string, string | number> = { [spec.x]: String(r[spec.x] ?? "") };
    for (const s of spec.series) o[s.key] = typeof r[s.key] === "number" ? (r[s.key] as number) : 0;
    return o;
  });
  if (!data.length || data.every((d) => spec.series.every((s) => !d[s.key]))) {
    return <p className="py-8 text-center text-sm text-muted">No data for this period.</p>;
  }

  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--surface-3)", opacity: 0.6 }}
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        return (
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
            <p className="mb-1 font-medium text-ink">{label}</p>
            {spec.series.map((s, i) => {
              const p = payload.find((x) => x.dataKey === s.key);
              return (
                <p key={s.key} className="flex items-center gap-1.5 text-ink-2">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color(i) }} />
                  {s.label}: <span className="tabular font-medium text-ink">{fmt(spec.format, Number(p?.value ?? 0), false)}</span>
                </p>
              );
            })}
          </div>
        );
      }}
    />
  );

  const axisTick = { fill: "var(--muted)", fontSize: 11 };

  return (
    <div className="viz" role="img" aria-label={`${title} chart`}>
      <style>{VIZ_CSS}</style>
      {multi && (
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2">
          {spec.series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color(i) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {spec.type === "hbar" ? (
        <div style={{ height: Math.max(120, data.length * 30 + 36) }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid horizontal={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => fmt(spec.format, v, true)} />
              <YAxis
                type="category"
                dataKey={spec.x}
                tickLine={false}
                axisLine={{ stroke: "var(--border-strong)" }}
                tick={axisTick}
                width={150}
                tickFormatter={(v: string) => (v.length > 24 ? v.slice(0, 23) + "…" : v)}
              />
              {tooltip}
              {spec.series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} fill={color(i)} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                  {!multi && data.length <= 12 && (
                    <LabelList dataKey={s.key} position="right" offset={6} style={{ fill: "var(--ink-2)", fontSize: 11 }} formatter={(v: unknown) => fmt(spec.format, Number(v), true)} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ height: 240 }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={multi ? "24%" : "22%"} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis dataKey={spec.x} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} tick={axisTick} interval="preserveStartEnd" minTickGap={10} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => fmt(spec.format, v, true)} width={56} />
              {tooltip}
              {spec.series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} fill={color(i)} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
