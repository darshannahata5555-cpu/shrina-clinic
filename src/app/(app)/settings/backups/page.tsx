import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseBackup, Download } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { ActionButton, ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { createBackupAction, saveBackupSettingsAction } from "./actions";

export const metadata = { title: "Backups & data" };

async function listBackups() {
  const dir = path.resolve(process.cwd(), process.env.STORAGE_DIR || "storage", "backups");
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".dump"));
    const rows = await Promise.all(files.map(async (f) => ({ name: f, ...(await stat(path.join(dir, f))) })));
    return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => ({ name: r.name, size: r.size, at: new Date(r.mtimeMs) }));
  } catch {
    return [];
  }
}

const mb = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function BackupsPage() {
  await requirePermission("settings.manage");
  const [backups, cfg] = await Promise.all([listBackups(), getSetting("backups")]);
  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Backups & data"
        description="Two layers of protection: automated database backups, and soft-delete with the recycle bin for everyday mistakes."
        actions={
          <ActionButton action={createBackupAction} variant="primary" size="md">
            <DatabaseBackup className="h-4 w-4" /> Back up now
          </ActionButton>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Database backups" description={cfg.lastBackupAt ? `Last backup ${fmtDateTime(cfg.lastBackupAt)}` : "No backup taken from this screen yet"} />
          {backups.length === 0 ? (
            <EmptyState icon={<DatabaseBackup className="h-5 w-5" />} title="No backup files on this server" description="Click “Back up now”, or rely on your cloud database's automated daily backups." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>File</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Size</TH>
                  <TH className="text-right">Download</TH>
                </tr>
              </THead>
              <tbody>
                {backups.map((b) => (
                  <TR key={b.name}>
                    <TD className="font-mono text-xs">{b.name}</TD>
                    <TD className="text-[13px] text-ink-2">{fmtDateTime(b.at)}</TD>
                    <TD className="tabular text-right text-[13px]">{mb(b.size)}</TD>
                    <TD className="text-right">
                      <a href={`/api/files/backups/${b.name}`} download className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                        <Download className="h-3.5 w-3.5" /> .dump
                      </a>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Retention" />
            <CardBody>
              <ActionForm action={saveBackupSettingsAction}>
                <div className="flex items-end gap-2">
                  <Field label="Keep backups for (days)" className="flex-1">
                    <Input name="retentionDays" type="number" min={1} defaultValue={cfg.retentionDays} />
                  </Field>
                  <SubmitButton variant="outline">Save</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recovery guide" />
            <CardBody className="space-y-3 text-[13px] leading-relaxed text-ink-2">
              <p>
                <span className="font-medium text-ink">Deleted a record by mistake?</span> Restore it from Settings → Recycle bin. Nothing is permanently erased.
              </p>
              <p>
                <span className="font-medium text-ink">Production:</span> enable the cloud database provider&apos;s automated daily backups with point-in-time recovery, and schedule{" "}
                <code className="rounded bg-surface-3 px-1">scripts/backup.sh</code> nightly to copy dumps off-site.
              </p>
              <p>
                <span className="font-medium text-ink">Full restore:</span> <code className="rounded bg-surface-3 px-1">pg_restore --clean --no-owner -d $DATABASE_URL file.dump</code> — done by your technical partner; it replaces all current data.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
