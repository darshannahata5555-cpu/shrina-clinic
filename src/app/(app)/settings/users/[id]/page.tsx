import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { resolvePermissions } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { UserForm } from "../user-form";
import { PermissionMatrix } from "../../permission-matrix";
import { saveUserPermissionsAction, userStatusAction } from "../../actions";

export const metadata = { title: "User" };

export default async function UserPage({ params }: PageProps<"/settings/users/[id]">) {
  const me = await requirePermission("users.manage");
  const { id } = await params;
  const user = await db.user.findUnique({ where: { id }, include: { role: true, branch: true, staff: true } });
  if (!user) notFound();
  const [roles, branches, staff, logs] = await Promise.all([
    db.role.findMany({ orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.staff.findMany({ where: { deletedAt: null }, select: { id: true, fullName: true, code: true, user: { select: { id: true } } }, orderBy: { fullName: "asc" } }),
    db.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const effective = resolvePermissions(user.role.permissions, user.grantPermissions, user.revokePermissions);
  const isOwnerRole = user.role.key === "OWNER";
  const extra = branches.filter((b) => user.extraBranchIds.includes(b.id)).map((b) => b.name);

  return (
    <>
      <PageHeader
        back={{ href: "/settings/users", label: "Users & access" }}
        title={user.name}
        description={user.email}
        meta={
          <>
            <Badge tone="accent">{user.role.name}</Badge>
            {user.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Deactivated</Badge>}
            {user.totpEnabled ? <Badge tone="info">2FA on</Badge> : <Badge tone="warning">2FA off</Badge>}
          </>
        }
        actions={
          <>
            <Dialog title={`Edit ${user.name}`} size="lg" trigger={<Button variant="outline"><Pencil className="h-4 w-4" /> Edit</Button>}>
              <UserForm
                roles={roles.map((r) => ({ id: r.id, name: r.name }))}
                branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                staff={staff.map((s) => ({ id: s.id, name: `${s.fullName} (${s.code})`, linked: !!s.user }))}
                values={{
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  phone: user.phone,
                  roleId: user.roleId,
                  branchId: user.branchId,
                  allBranches: user.allBranches,
                  extraBranchIds: user.extraBranchIds,
                  staffId: user.staffId,
                }}
              />
            </Dialog>
            <ActionButton action={userStatusAction} fields={{ id, op: "reset-password" }} confirm="Generate a new temporary password? The user will be signed out." size="md">
              Reset password
            </ActionButton>
            {user.totpEnabled && (
              <ActionButton action={userStatusAction} fields={{ id, op: "reset-2fa" }} confirm="Turn off this user's 2FA (e.g. lost phone)?" size="md">
                Reset 2FA
              </ActionButton>
            )}
            <ActionButton action={userStatusAction} fields={{ id, op: "signout" }} size="md">
              Sign out everywhere
            </ActionButton>
            {user.id !== me.id && (
              <ActionButton
                action={userStatusAction}
                fields={{ id, op: "toggle" }}
                variant={user.isActive ? "danger" : "primary"}
                size="md"
                confirm={user.isActive ? `Deactivate ${user.name}? They will be signed out immediately.` : undefined}
              >
                {user.isActive ? "Deactivate" : "Reactivate"}
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <DetailList
                className="sm:grid-cols-1"
                items={[
                  ["Mobile", user.phone ?? "—"],
                  ["Linked employee", user.staff ? `${user.staff.fullName} · ${user.staff.code} · ${user.staff.designation}` : "Not linked"],
                  ["Branch access", user.allBranches || effective.has("branches.all") ? "All branches" : [user.branch?.name, ...extra].filter(Boolean).join(", ")],
                  ["Last sign-in", user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : "Never"],
                  ["Created", fmtDateTime(user.createdAt)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent activity" />
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>What</TH>
                </tr>
              </THead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-6 text-center text-sm text-muted">No activity yet</td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <TR key={l.id}>
                      <TD className="whitespace-nowrap text-xs text-muted">{fmtDateTime(l.createdAt)}</TD>
                      <TD className="text-[13px]">{l.summary}</TD>
                    </TR>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Permissions"
            description={
              isOwnerRole
                ? "Owners always have full access."
                : `Starts from the ${user.role.name} role. Tick or untick to customise this user only — differences are highlighted.`
            }
          />
          <CardBody>
            <PermissionMatrix
              action={saveUserPermissionsAction}
              hidden={{ id: user.id }}
              initial={[...effective]}
              baseline={user.role.permissions}
              locked={isOwnerRole}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
