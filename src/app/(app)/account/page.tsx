import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { totpQrDataUrl } from "@/lib/totp";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/form";
import { PasswordForm, ProfileForm, TwoFactor } from "./forms";
import { signOutOthersAction } from "./actions";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const me = await requireUser();
  const row = await db.user.findUniqueOrThrow({ where: { id: me.id }, include: { branch: true } });
  const pendingQr = !row.totpEnabled && row.totpSecret ? await totpQrDataUrl(row.totpSecret, row.email) : null;
  const logins = await db.auditLog.findMany({
    where: { userId: me.id, action: { in: ["LOGIN", "LOGIN_FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <>
      <PageHeader title="My account" description={`${me.roleName}${me.branchName ? ` · ${me.branchName}` : ""}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Profile" description={row.email} />
            <CardBody>
              <ProfileForm name={row.name} phone={row.phone} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Access" />
            <CardBody>
              <DetailList
                items={[
                  ["Role", me.roleName],
                  ["Branches", me.allBranches ? "All branches" : me.branchName ?? "—"],
                  ["Permissions", `${me.permissions.size} granted`],
                  ["Linked employee", me.staff ? `${me.staff.fullName} (${me.staff.code})` : "—"],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent sign-ins" actions={<ActionButton action={signOutOthersAction}>Sign out other devices</ActionButton>} />
            <CardBody className="space-y-1.5">
              {logins.map((l) => (
                <div key={l.id} className="flex justify-between gap-3 text-[13px]">
                  <span className={l.action === "LOGIN_FAILED" ? "text-danger" : "text-ink-2"}>{l.action === "LOGIN" ? "Signed in" : "Failed attempt"}</span>
                  <span className="text-muted">
                    {fmtDateTime(l.createdAt)}
                    {l.ip ? ` · ${l.ip}` : ""}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6" id="security">
          <Card>
            <CardHeader title="Password" description="Changing it signs you out on every other device." />
            <CardBody>
              <PasswordForm />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Two-factor authentication" actions={row.totpEnabled ? <Badge tone="success" dot>On</Badge> : <Badge tone="warning" dot>Off</Badge>} />
            <CardBody>
              <TwoFactor enabled={row.totpEnabled} pendingQr={pendingQr} secret={pendingQr ? row.totpSecret : null} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
