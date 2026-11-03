import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { UserForm } from "./user-form";

export const metadata = { title: "Users & access" };

export default async function UsersPage({ searchParams }: PageProps<"/settings/users">) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const roleFilter = typeof sp.role === "string" ? sp.role : "";
  const status = typeof sp.status === "string" ? sp.status : "";

  const [users, roles, branches, staff] = await Promise.all([
    db.user.findMany({
      where: {
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
        ...(roleFilter ? { roleId: roleFilter } : {}),
        ...(status ? { isActive: status === "active" } : {}),
      },
      include: { role: true, branch: true, staff: { select: { code: true, designation: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.role.findMany({ orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.staff.findMany({ where: { deletedAt: null }, select: { id: true, fullName: true, code: true, user: { select: { id: true } } }, orderBy: { fullName: "asc" } }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Users & access"
        description="Every person who signs in. Access = role permissions ± individual overrides, limited to their branches."
        actions={
          <Dialog
            title="Add user"
            description="Give a staff member their own login. Never share accounts — every action is logged against the user."
            size="lg"
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Add user
              </Button>
            }
          >
            <UserForm
              roles={roles.map((r) => ({ id: r.id, name: r.name }))}
              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
              staff={staff.map((s) => ({ id: s.id, name: `${s.fullName} (${s.code})`, linked: !!s.user }))}
            />
          </Dialog>
        }
      />
      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Search name or email" />
            <SelectParam name="role" placeholder="All roles" options={roles.map((r) => [r.id, r.name] as const)} />
            <SelectParam name="status" placeholder="Any status" options={[["active", "Active"], ["inactive", "Deactivated"]]} />
          </FilterBar>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>User</TH>
              <TH>Role</TH>
              <TH className="hidden md:table-cell">Branch access</TH>
              <TH className="hidden lg:table-cell">Last sign-in</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {users.map((u) => {
              const overrides = u.grantPermissions.length + u.revokePermissions.length;
              return (
                <TR key={u.id}>
                  <TD>
                    <Link href={`/settings/users/${u.id}`} className="font-medium hover:text-accent">
                      {u.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {u.email}
                      {u.staff ? ` · ${u.staff.code}` : ""}
                    </p>
                  </TD>
                  <TD>
                    <span className="text-ink-2">{u.role.name}</span>
                    {overrides > 0 && (
                      <Badge tone="violet" className="ml-1.5">
                        {overrides} override{overrides > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </TD>
                  <TD className="hidden text-ink-2 md:table-cell">
                    {u.allBranches || u.role.permissions.includes("branches.all")
                      ? "All branches"
                      : [u.branch?.name, ...u.extraBranchIds.map((id) => branchName.get(id))].filter(Boolean).join(", ") || "—"}
                  </TD>
                  <TD className="hidden text-ink-2 lg:table-cell">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {u.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Deactivated</Badge>}
                      {u.totpEnabled && (
                        <Badge tone="info">
                          <ShieldCheck className="h-3 w-3" /> 2FA
                        </Badge>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
