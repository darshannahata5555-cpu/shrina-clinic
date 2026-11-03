import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import { remainingSessions } from "@/lib/packages";
import { fmtDate, fmtDateTime, money, relativeDays } from "@/lib/format";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ProgressBar } from "./overview";

export async function PackagesTab({ patientId, user }: { patientId: string; user: CurrentUser }) {
  const packages = await db.treatmentPackage.findMany({
    where: { patientId, deletedAt: null },
    include: {
      treatment: { select: { name: true, category: true } },
      branch: { select: { code: true } },
      doctor: { select: { fullName: true } },
      therapist: { select: { fullName: true } },
      sessions: {
        orderBy: [{ sessionNumber: { sort: "asc", nulls: "last" } }, { scheduledAt: "asc" }],
        include: { therapist: { select: { fullName: true } }, doctor: { select: { fullName: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { purchaseDate: "desc" }],
  });
  const showPrice = can(user, "billing.view") || can(user, "packages.manage");

  if (packages.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title="No treatment packages yet"
          description="Sold packages track total, completed and remaining sessions automatically."
          action={can(user, "packages.manage") && <LinkButton href={`/treatments/packages/new?patientId=${patientId}`}><Plus className="h-4 w-4" /> Sell package</LinkButton>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {can(user, "packages.manage") && (
        <div className="flex justify-end">
          <LinkButton href={`/treatments/packages/new?patientId=${patientId}`} size="sm">
            <Plus className="h-3.5 w-3.5" /> Sell package
          </LinkButton>
        </div>
      )}
      {packages.map((k) => {
        const left = remainingSessions(k);
        const upcoming = k.sessions.find((s) => s.status === "SCHEDULED");
        return (
          <Card key={k.id}>
            <CardHeader
              title={
                <Link href={`/treatments/packages/${k.id}`} className="hover:text-accent">
                  {k.name}
                </Link>
              }
              description={`${k.code} · ${k.treatment.category}${k.bodyArea ? ` · ${k.bodyArea}` : ""} · ${k.branch.code}`}
              actions={
                <>
                  <StatusBadge kind="package" status={k.status} />
                  <LinkButton href={`/treatments/packages/${k.id}`} variant="outline" size="sm">
                    Open package
                  </LinkButton>
                </>
              }
            />
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">Sessions</span>
                  <span className="tabular text-ink">
                    <strong className="font-semibold">{k.completedSessions}</strong> of {k.totalSessions} completed ·{" "}
                    <strong className="font-semibold">{left}</strong> remaining
                  </span>
                </div>
                <ProgressBar done={k.completedSessions} total={k.totalSessions} />
              </div>
              <div className="text-[13px]">
                <p className="text-muted">Purchased / expiry</p>
                <p className="text-ink">
                  {fmtDate(k.purchaseDate)} → {k.expiryDate ? fmtDate(k.expiryDate) : "—"}
                </p>
                {k.status === "ACTIVE" && k.expiryDate && <p className="text-xs text-muted">expires {relativeDays(k.expiryDate)}</p>}
              </div>
              <div className="text-[13px]">
                <p className="text-muted">Doctor / therapist</p>
                <p className="text-ink">{[k.doctor?.fullName, k.therapist?.fullName].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <div className="text-[13px]">
                {showPrice && (
                  <>
                    <p className="text-muted">Package price</p>
                    <p className="tabular text-ink">{money(k.price, { decimals: false })}</p>
                  </>
                )}
                {upcoming?.scheduledAt && <p className="mt-1 text-xs text-info">Next: {fmtDateTime(upcoming.scheduledAt)}</p>}
              </div>
            </div>
            {k.sessions.length > 0 && (
              <details className="border-t border-border px-4 py-3 sm:px-5">
                <summary className="cursor-pointer text-[13px] font-medium text-accent">Session history ({k.sessions.length})</summary>
                <div className="scroll-thin mt-3 overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-left text-xs text-muted">
                      <tr>
                        <th className="py-1.5 pr-3 font-medium">#</th>
                        <th className="py-1.5 pr-3 font-medium">Date</th>
                        <th className="py-1.5 pr-3 font-medium">Status</th>
                        <th className="hidden py-1.5 pr-3 font-medium sm:table-cell">Doctor / therapist</th>
                        <th className="py-1.5 font-medium">Notes & observations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k.sessions.map((s) => (
                        <tr key={s.id} className="border-t border-border align-top">
                          <td className="tabular py-2 pr-3 text-ink">{s.sessionNumber ?? "—"}</td>
                          <td className="py-2 pr-3 whitespace-nowrap text-ink-2">{fmtDate(s.performedAt ?? s.scheduledAt)}</td>
                          <td className="py-2 pr-3">
                            <StatusBadge kind="session" status={s.status} />
                          </td>
                          <td className="hidden py-2 pr-3 text-ink-2 sm:table-cell">{[s.doctor?.fullName, s.therapist?.fullName].filter(Boolean).join(" · ") || "—"}</td>
                          <td className="py-2 text-ink-2">
                            {[s.observations, s.notes, s.adjustmentReason && `Adjustment: ${s.adjustmentReason}`].filter(Boolean).join(" · ") || "—"}
                            {s.approvedAt && <Badge tone="success" className="ml-1.5">Approved</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
