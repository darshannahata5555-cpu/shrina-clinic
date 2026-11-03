import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Mail, MessageCircle, Pencil, Phone, Trash2, UserCheck, ArrowRightLeft, StickyNote, Footprints, PhoneCall } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { cn, fmtDate, fmtDateTime, istDayRange, money, relativeDays, toIstDateInput, toNum } from "@/lib/format";
import { LEAD_SOURCES } from "@/lib/status";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { LeadForm } from "../lead-form";
import { assignableUsers, treatmentNames } from "../data";
import { deleteLeadAction } from "../actions";
import { ActivityForm, AssignForm, ConvertForm, StatusForm } from "./forms";

export const metadata = { title: "Lead" };

const SOURCE_LABEL = Object.fromEntries(LEAD_SOURCES) as Record<string, string>;
const ACT_ICON = { CALL: PhoneCall, WHATSAPP: MessageCircle, NOTE: StickyNote, VISIT: Footprints, EMAIL: Mail, STATUS_CHANGE: ArrowRightLeft } as const;
const ACT_LABEL: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", NOTE: "Note", VISIT: "Visit", EMAIL: "Email", STATUS_CHANGE: "Stage change" };

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const user = await requirePermission(["leads.view", "leads.manage"]);
  const { id } = await params;
  const scope = await getBranchScope();
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } },
    include: {
      branch: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      patient: { select: { id: true, code: true, fullName: true } },
      activities: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) notFound();
  const manage = can(user, "leads.manage");

  const authorIds = [...new Set(lead.activities.map((a) => a.createdById).filter(Boolean))] as string[];
  const [authors, users, treatments, existing, paid] = await Promise.all([
    db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }),
    manage ? assignableUsers([lead.branchId]) : Promise.resolve([]),
    manage ? treatmentNames() : Promise.resolve([]),
    lead.patientId ? Promise.resolve(null) : db.patient.findFirst({ where: { deletedAt: null, OR: [{ mobile: lead.mobile }, { altMobile: lead.mobile }] }, select: { code: true, fullName: true } }),
    lead.patientId
      ? db.invoice.aggregate({ where: { patientId: lead.patientId, deletedAt: null, status: { not: "CANCELLED" }, date: { gte: lead.enquiryDate } }, _sum: { paidAmount: true }, _count: true })
      : Promise.resolve(null),
  ]);
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  const open = !["LOST", "TREATMENT_PURCHASED"].includes(lead.status);
  const overdue = open && lead.followUpDate && lead.followUpDate < istDayRange().start;
  const wa = `https://wa.me/91${lead.mobile}?text=${encodeURIComponent(`Hi ${lead.name.split(" ")[0]}, this is SHRINA Clinic following up on your enquiry${lead.interestedTreatment ? ` about ${lead.interestedTreatment}` : ""}.`)}`;
  const branchOpts = scope.branches.map((b) => ({ id: b.id, name: b.name }));

  return (
    <>
      <PageHeader
        back={{ href: "/leads", label: "Leads & CRM" }}
        title={lead.name}
        meta={
          <>
            <StatusBadge kind="lead" status={lead.status} />
            <Badge tone="neutral">{SOURCE_LABEL[lead.source]}</Badge>
            <span className="text-[13px] text-muted">
              {lead.code} · {lead.branch.name}
            </span>
          </>
        }
        actions={
          <>
            <a href={`tel:+91${lead.mobile}`} className="inline-flex h-9.5 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-2">
              <Phone className="h-4 w-4" /> Call
            </a>
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-9.5 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-2">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
            {manage && (
              <Dialog title="Edit lead" size="lg" trigger={<Button variant="outline"><Pencil className="h-4 w-4" /> Edit</Button>}>
                <LeadForm
                  values={{
                    id: lead.id,
                    name: lead.name,
                    mobile: lead.mobile,
                    email: lead.email,
                    interestedTreatment: lead.interestedTreatment,
                    enquiryDate: toIstDateInput(lead.enquiryDate),
                    source: lead.source,
                    branchId: lead.branchId,
                    assignedToId: lead.assignedToId,
                    followUpDate: toIstDateInput(lead.followUpDate),
                    notes: lead.notes,
                    estimatedValue: lead.estimatedValue ? toNum(lead.estimatedValue) : null,
                  }}
                  branches={branchOpts}
                  users={users}
                  treatments={treatments}
                  currentUserId={user.id}
                />
              </Dialog>
            )}
            {lead.patient ? (
              <LinkButton href={`/patients/${lead.patient.id}`} variant="soft">
                <UserCheck className="h-4 w-4" /> {lead.patient.code}
              </LinkButton>
            ) : (
              manage && (
                <Dialog title="Convert to patient" description={`${lead.name} · ${lead.mobile}`} trigger={<Button><UserCheck className="h-4 w-4" /> Convert to patient</Button>}>
                  <ConvertForm
                    id={lead.id}
                    branchId={lead.branchId}
                    branches={branchOpts}
                    existing={existing}
                    canBook={can(user, "appointments.manage")}
                    canBill={can(user, "billing.create")}
                  />
                </Dialog>
              )
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {manage && (
            <Card>
              <CardHeader title="Log follow-up" description="Record every call, message or visit so the next person knows where things stand." />
              <CardBody>
                <ActivityForm id={lead.id} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Enquiry history" description={`${lead.activities.length} entr${lead.activities.length === 1 ? "y" : "ies"}`} />
            <CardBody>
              {lead.activities.length === 0 ? (
                <p className="text-sm text-muted">No activity yet.</p>
              ) : (
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {lead.activities.map((a) => {
                    const Icon = ACT_ICON[a.type as keyof typeof ACT_ICON] ?? StickyNote;
                    return (
                      <li key={a.id} className="relative">
                        <span className={cn("absolute -left-[37px] grid h-6 w-6 place-items-center rounded-full border border-border bg-surface", a.type === "STATUS_CHANGE" ? "text-accent" : "text-muted")}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <p className="text-sm text-ink">{a.note}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {ACT_LABEL[a.type] ?? a.type} · {fmtDateTime(a.createdAt)}
                          {a.createdById && ` · ${authorName.get(a.createdById) ?? "Staff"}`}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                className="sm:grid-cols-1"
                items={[
                  ["Mobile", lead.mobile],
                  ["Email", lead.email ?? "—"],
                  ["Interested in", lead.interestedTreatment ?? "—"],
                  ["Enquiry date", fmtDate(lead.enquiryDate)],
                  ["Assigned to", lead.assignedTo?.name ?? "Unassigned"],
                  [
                    "Next follow-up",
                    lead.followUpDate ? (
                      <span className={overdue ? "font-medium text-danger" : ""}>
                        {fmtDate(lead.followUpDate)} ({relativeDays(lead.followUpDate)})
                      </span>
                    ) : (
                      "—"
                    ),
                  ],
                  ["Estimated value", lead.estimatedValue ? money(toNum(lead.estimatedValue), { decimals: false }) : "—"],
                  ...(lead.status === "LOST" ? ([["Lost reason", lead.lostReason ?? "—"]] as [string, string][]) : []),
                  ...(lead.patient
                    ? ([
                        [
                          "Converted",
                          <span key="c">
                            {lead.convertedAt ? fmtDate(lead.convertedAt) : "—"} ·{" "}
                            <Link href={`/patients/${lead.patient.id}`} className="text-accent hover:underline">
                              {lead.patient.fullName} <ArrowUpRight className="inline h-3 w-3" />
                            </Link>
                          </span>,
                        ],
                        ["Paid since enquiry", paid && paid._count ? `${money(toNum(paid._sum.paidAmount), { decimals: false })} · ${paid._count} invoice${paid._count === 1 ? "" : "s"}` : "No payments yet"],
                      ] as [string, React.ReactNode][])
                    : []),
                  ["Notes", lead.notes ?? "—"],
                ]}
              />
            </CardBody>
          </Card>

          {manage && (
            <>
              <Card>
                <CardHeader title="Pipeline stage" />
                <CardBody>
                  <StatusForm id={lead.id} status={lead.status} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Owner & follow-up" />
                <CardBody>
                  <AssignForm id={lead.id} assignedToId={lead.assignedToId} followUpDate={toIstDateInput(lead.followUpDate)} users={users} />
                </CardBody>
              </Card>
              <div className="flex justify-end">
                <ActionButton action={deleteLeadAction} fields={{ id: lead.id }} variant="ghost" confirm={`Delete lead ${lead.code}? It can be restored from Settings → Recycle bin.`}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete lead
                </ActionButton>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
