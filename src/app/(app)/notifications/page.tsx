import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Bell, CheckCheck, Eye, Mail, MessageCircle, Play, RotateCcw, Send, Smartphone } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { providerStatus } from "@/lib/messaging";
import { SAMPLE_VARS, TEMPLATE_PLACEHOLDERS } from "@/lib/reminders";
import { cn, fmtDateTime, fromIst, addDaysKey, istDayRange } from "@/lib/format";
import { LinkTabs, PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { DateParam, FilterBar, SelectParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { dispatchNowAction, markAllReadAction, markReadAction, openAlertAction, retryMessageAction, runRemindersAction, toggleRuleAction } from "./actions";
import { RuleForm } from "./rule-form";
import { TestMessageForm } from "./test-form";

export const metadata = { title: "Notifications" };

const PAGE = 25;
const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email", IN_APP: "In-app" };
const CHANNEL_ICON = { WHATSAPP: MessageCircle, SMS: Smartphone, EMAIL: Mail, IN_APP: Bell } as const;

function offsetLabel(min: number, key: string) {
  if (key === "PRODUCT_REORDER") return "Daily, when stock is low";
  if (min === 0) return key === "FOLLOW_UP" ? "On the follow-up date" : "At the time";
  const abs = Math.abs(min);
  const v = abs % 1440 === 0 ? `${abs / 1440} day${abs / 1440 === 1 ? "" : "s"}` : abs % 60 === 0 ? `${abs / 60} hour${abs / 60 === 1 ? "" : "s"}` : `${abs} min`;
  return `${v} ${min < 0 ? "before" : "after"}`;
}

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const sp = await searchParams;
  const manage = can(user, "notifications.manage");
  const tab = manage && (sp.tab === "outbox" || sp.tab === "rules") ? sp.tab : "alerts";
  const page = Math.max(1, Number(sp.page) || 1);
  const unread = await db.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } });

  const tabs = [
    { key: "alerts", label: "My alerts", href: "/notifications", count: unread },
    ...(manage
      ? [
          { key: "outbox", label: "Message outbox", href: "/notifications?tab=outbox" },
          { key: "rules", label: "Reminder rules", href: "/notifications?tab=rules" },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Notifications"
        description={manage ? "Your alerts, patient reminders sent by WhatsApp / SMS / email, and reminder settings." : "Alerts and reminders for you."}
        actions={
          manage && (
            <>
              <Dialog title="Send a test message" description="Check a provider is working before relying on reminders." trigger={<Button variant="outline"><Send className="h-4 w-4" /> Test message</Button>}>
                <TestMessageForm />
              </Dialog>
              <ActionButton action={runRemindersAction} variant="primary" size="md">
                <Play className="h-4 w-4" /> Run reminders now
              </ActionButton>
            </>
          )
        }
      />
      <LinkTabs tabs={tabs} active={tab} />
      {tab === "alerts" && <Alerts userId={user.id} page={page} unread={unread} sp={sp} />}
      {tab === "outbox" && <Outbox sp={sp} page={page} />}
      {tab === "rules" && <Rules />}
    </>
  );
}

async function Alerts({ userId, page, unread, sp }: { userId: string; page: number; unread: number; sp: Record<string, string | string[] | undefined> }) {
  const where: Prisma.NotificationWhereInput = { userId, channel: "IN_APP", ...(sp.show === "unread" ? { readAt: null } : {}) };
  const [rows, total] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.notification.count({ where }),
  ]);
  return (
    <Card>
      <CardHeader
        title="My alerts"
        description={unread ? `${unread} unread` : "You're all caught up"}
        actions={
          <>
            <Link href={sp.show === "unread" ? "/notifications" : "/notifications?show=unread"} className="text-[13px] text-muted hover:text-ink">
              {sp.show === "unread" ? "Show all" : "Unread only"}
            </Link>
            {unread > 0 && (
              <ActionButton action={markAllReadAction} variant="ghost">
                <CheckCheck className="h-4 w-4" /> Mark all read
              </ActionButton>
            )}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Bell className="h-5 w-5" />} title="No alerts" description="Low stock, expense approvals, lead follow-ups and other alerts for you will appear here." />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((n) => (
            <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3 sm:px-5", !n.readAt && "bg-accent-soft/40")}>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
              <form action={openAlertAction} className="min-w-0 flex-1">
                <input type="hidden" name="id" value={n.id} />
                <button className="block w-full text-left">
                  <p className={cn("text-sm text-ink", !n.readAt && "font-semibold")}>{n.title ?? "Alert"}</p>
                  <p className="mt-0.5 text-[13px] text-ink-2">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{fmtDateTime(n.createdAt)}</p>
                </button>
              </form>
              {!n.readAt && (
                <ActionButton action={markReadAction} fields={{ id: n.id }} variant="ghost" title="Mark as read">
                  <CheckCheck className="h-4 w-4" />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => withParams("/notifications", sp, { page: p })} />
    </Card>
  );
}

async function Outbox({ sp, page }: { sp: Record<string, string | string[] | undefined>; page: number }) {
  const scope = await getBranchScope();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const from = str("from");
  const to = str("to");
  const where: Prisma.NotificationWhereInput = {
    channel: str("channel") ? (str("channel") as never) : { not: "IN_APP" },
    ...(str("status") ? { status: str("status") as never } : {}),
    ...(str("rule") ? { ruleKey: str("rule") } : {}),
    OR: [{ branchId: { in: scope.ids } }, { branchId: null }],
    ...(from || to
      ? { scheduledFor: { ...(from ? { gte: fromIst(from) } : {}), ...(to ? { lt: fromIst(addDaysKey(to, 1)) } : {}) } }
      : {}),
  };
  const { start } = istDayRange();
  const weekAgo = new Date(start.getTime() - 7 * 86400000);
  const base = { channel: { not: "IN_APP" as const }, OR: [{ branchId: { in: scope.ids } }, { branchId: null }] };
  const [rows, total, rules, queued, sentToday, failed, skipped] = await Promise.all([
    db.notification.findMany({ where, include: { patient: { select: { id: true, fullName: true } } }, orderBy: { scheduledFor: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.notification.count({ where }),
    db.reminderRule.findMany({ select: { key: true, name: true }, orderBy: { name: "asc" } }),
    db.notification.count({ where: { ...base, status: "QUEUED" } }),
    db.notification.count({ where: { ...base, status: "SENT", sentAt: { gte: start } } }),
    db.notification.count({ where: { ...base, status: "FAILED", createdAt: { gte: weekAgo } } }),
    db.notification.count({ where: { ...base, status: "SKIPPED", createdAt: { gte: weekAgo } } }),
  ]);
  const ruleName = new Map(rules.map((r) => [r.key, r.name]));
  const providers = providerStatus();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Queued" value={queued} hint="Waiting for their send time" tone="warning" />
        <StatCard label="Sent today" value={sentToday} tone="success" />
        <StatCard label="Failed (7 days)" value={failed} hint="Retry from the table" tone="danger" />
        <StatCard label="Logged only (7 days)" value={skipped} hint="Provider not configured" tone="neutral" />
      </div>

      <Card>
        <CardHeader title="Messaging providers" description="Configured through environment variables on the server." />
        <CardBody className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["WHATSAPP", "WhatsApp Business Cloud API", "WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID", "Reminders sent outside a 24-hour chat window need Meta-approved message templates."],
              ["SMS", "SMS gateway", "SMS_PROVIDER_URL, SMS_API_KEY, SMS_SENDER_ID", "Indian SMS requires DLT-registered sender ID and templates."],
              ["EMAIL", "Email (Resend)", "RESEND_API_KEY, EMAIL_FROM", "Use a verified sending domain for best delivery."],
            ] as const
          ).map(([k, label, env, note]) => {
            const Icon = CHANNEL_ICON[k];
            return (
              <div key={k} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-muted" /> {label}
                  </p>
                  {providers[k] ? <Badge tone="success" dot>Connected</Badge> : <Badge tone="neutral" dot>Log-only</Badge>}
                </div>
                <p className="mt-1.5 text-xs text-muted">{note}</p>
                {!providers[k] && <p className="mt-1.5 font-mono text-[11px] text-muted">{env}</p>}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Message outbox"
          description="Every reminder and message generated by the system."
          actions={
            <ActionButton action={dispatchNowAction} variant="outline">
              <Send className="h-3.5 w-3.5" /> Send due messages
            </ActionButton>
          }
        />
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SelectParam name="channel" placeholder="All channels" options={[["WHATSAPP", "WhatsApp"], ["SMS", "SMS"], ["EMAIL", "Email"]]} />
            <SelectParam name="status" placeholder="All statuses" options={[["QUEUED", "Queued"], ["SENT", "Sent"], ["FAILED", "Failed"], ["SKIPPED", "Logged only"]]} />
            <SelectParam name="rule" placeholder="All reminders" options={[...rules.map((r) => [r.key, r.name] as const), ["TEST", "Test messages"] as const]} />
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Send time</TH>
              <TH>Channel</TH>
              <TH>Recipient</TH>
              <TH className="hidden lg:table-cell">Reminder</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </tr>
          </THead>
          <tbody>
            {rows.length === 0 && <TableEmpty colSpan={6}>No messages match these filters.</TableEmpty>}
            {rows.map((m) => (
              <TR key={m.id}>
                <TD className="tabular whitespace-nowrap text-ink-2">{fmtDateTime(m.scheduledFor)}</TD>
                <TD className="whitespace-nowrap">{CHANNEL_LABEL[m.channel]}</TD>
                <TD>
                  {m.patient ? (
                    <Link href={`/patients/${m.patient.id}`} className="font-medium hover:text-accent">
                      {m.patient.fullName}
                    </Link>
                  ) : (
                    <span className="font-medium">{m.title ?? "Staff"}</span>
                  )}
                  <p className="max-w-56 truncate text-xs text-muted">{m.recipient}</p>
                </TD>
                <TD className="hidden text-ink-2 lg:table-cell">{m.ruleKey === "TEST" ? "Test message" : ruleName.get(m.ruleKey ?? "") ?? m.ruleKey ?? "—"}</TD>
                <TD>
                  <StatusBadge kind="notification" status={m.status} />
                  {m.error && <p className="mt-1 max-w-56 truncate text-[11px] text-muted" title={m.error}>{m.error}</p>}
                </TD>
                <TD className="text-right whitespace-nowrap">
                  <Dialog title={m.title ?? "Message"} description={`${CHANNEL_LABEL[m.channel]} → ${m.recipient}`} trigger={<Button variant="ghost" size="sm"><Eye className="h-3.5 w-3.5" /> View</Button>}>
                    <div className="space-y-3">
                      <div className="rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">{m.body}</div>
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        <dt className="text-muted">Scheduled</dt>
                        <dd>{fmtDateTime(m.scheduledFor)}</dd>
                        <dt className="text-muted">Sent</dt>
                        <dd>{m.sentAt ? fmtDateTime(m.sentAt) : "—"}</dd>
                        <dt className="text-muted">Status</dt>
                        <dd>{m.status}</dd>
                        {m.error && (
                          <>
                            <dt className="text-muted">Detail</dt>
                            <dd className="break-words">{m.error}</dd>
                          </>
                        )}
                      </dl>
                    </div>
                  </Dialog>
                  {(m.status === "FAILED" || m.status === "SKIPPED") && (
                    <ActionButton action={retryMessageAction} fields={{ id: m.id }} variant="ghost">
                      <RotateCcw className="h-3.5 w-3.5" /> Retry
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => withParams("/notifications", sp, { page: p })} />
      </Card>
    </div>
  );
}

async function Rules() {
  const rules = await db.reminderRule.findMany({ orderBy: { offsetMinutes: "asc" } });
  const order = ["APPOINTMENT_24H", "APPOINTMENT_2H", "SESSION_UPCOMING", "FOLLOW_UP", "PACKAGE_EXPIRY", "POST_TREATMENT", "PRODUCT_REORDER"];
  rules.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        Reminders run automatically every 15 minutes (server cron). Patients who have withdrawn communication consent are never messaged.
        Lead follow-up alerts go to the assigned staff member in-app every morning they are due.
      </p>
      {rules.length === 0 && (
        <Card>
          <EmptyState title="No reminder rules" description="Reminder rules are created with the initial setup." />
        </Card>
      )}
      {rules.map((r) => (
        <Card key={r.id}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {r.name}
                {r.enabled ? <Badge tone="success" dot>On</Badge> : <Badge tone="neutral" dot>Off</Badge>}
              </span>
            }
            description={`${offsetLabel(r.offsetMinutes, r.key)} · ${r.channels.map((c) => CHANNEL_LABEL[c]).join(", ") || "no channel"}`}
            actions={
              <ActionButton action={toggleRuleAction} fields={{ id: r.id }} variant="ghost">
                {r.enabled ? "Turn off" : "Turn on"}
              </ActionButton>
            }
          />
          <details className="group">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-[13px] text-accent hover:bg-surface-2 sm:px-5">
              <span className="group-open:hidden">Edit timing, channels & message →</span>
              <span className="hidden group-open:inline">Close editor</span>
            </summary>
            <CardBody className="border-t border-border">
              <RuleForm
                rule={{ id: r.id, key: r.key, name: r.name, enabled: r.enabled, offsetMinutes: r.offsetMinutes, channels: r.channels, template: r.template }}
                placeholders={TEMPLATE_PLACEHOLDERS[r.key] ?? Object.keys(SAMPLE_VARS)}
                sample={SAMPLE_VARS}
              />
            </CardBody>
          </details>
        </Card>
      ))}
    </div>
  );
}
