import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { LinkTabs, PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PermissionMatrix } from "../permission-matrix";
import { saveRoleAction } from "../actions";

export const metadata = { title: "Roles & permissions" };

const ORDER = ["OWNER", "BRANCH_MANAGER", "DOCTOR", "RECEPTIONIST", "THERAPIST", "ACCOUNTS", "HR_ADMIN"];

export default async function RolesPage({ searchParams }: PageProps<"/settings/roles">) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  const roles = (await db.role.findMany({ include: { _count: { select: { users: true } } } })).sort(
    (a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99) || a.name.localeCompare(b.name),
  );
  const active = roles.find((r) => r.id === sp.role) ?? roles[0]!;

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Roles & permissions"
        description="Default access for each role. Individual users can be customised further under Users & access."
        actions={
          <Dialog title="New custom role" size="lg" trigger={<Button variant="outline"><Plus className="h-4 w-4" /> Custom role</Button>}>
            <PermissionMatrix
              action={saveRoleAction}
              hidden={{}}
              initial={[]}
              submitLabel="Create role"
              extraFields={
                <div className="mb-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Role name" required>
                    <Input name="name" placeholder="e.g. Senior Receptionist" required />
                  </Field>
                  <Field label="Description">
                    <Input name="description" />
                  </Field>
                </div>
              }
            />
          </Dialog>
        }
      />
      <LinkTabs
        active={active.id}
        tabs={roles.map((r) => ({ key: r.id, label: r.name, href: `/settings/roles?role=${r.id}`, count: r._count.users }))}
      />
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {active.name}
              {!active.isSystem && <Badge tone="violet">Custom</Badge>}
            </span>
          }
          description={
            <>
              {active.description ?? "—"} ·{" "}
              <Link className="text-accent hover:underline" href={`/settings/users?role=${active.id}`}>
                {active._count.users} user{active._count.users === 1 ? "" : "s"}
              </Link>{" "}
              · {active.key === "OWNER" ? ALL_PERMISSIONS.length : active.permissions.length} of {ALL_PERMISSIONS.length} permissions
            </>
          }
        />
        <CardBody>
          <PermissionMatrix
            key={active.id}
            action={saveRoleAction}
            hidden={{ id: active.id }}
            initial={active.key === "OWNER" ? ALL_PERMISSIONS : active.permissions}
            locked={active.key === "OWNER"}
            submitLabel={`Save ${active.name}`}
          />
        </CardBody>
      </Card>
    </>
  );
}
