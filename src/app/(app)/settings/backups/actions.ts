"use server";

import { execFile } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertPermission, ActionError } from "@/lib/auth";
import { handle, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { getSetting, saveSetting } from "@/lib/settings";

const run = promisify(execFile);
const DIR = path.resolve(process.cwd(), process.env.STORAGE_DIR || "storage", "backups");

/** pg_dump in custom format (restorable with pg_restore). Prunes backups older than the retention window. */
export async function createBackupAction(_: ActionState): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("settings.manage");
    const url = process.env.DATABASE_URL;
    if (!url) throw new ActionError("DATABASE_URL is not configured.");
    const conn = url.split("?")[0]!; // libpq rejects Prisma's ?schema= parameter
    await mkdir(DIR, { recursive: true });
    const file = `shrina-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.dump`;
    try {
      await run(process.env.PG_DUMP_PATH || "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(DIR, file)}`, conn], { timeout: 120_000 });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      throw new ActionError(
        msg.includes("ENOENT")
          ? "pg_dump is not installed on this server. Use your database provider's automated backups, or set PG_DUMP_PATH."
          : `Backup failed: ${msg.slice(0, 200)}`,
      );
    }
    const { retentionDays } = await getSetting("backups");
    const cutoff = Date.now() - retentionDays * 86400000;
    let pruned = 0;
    for (const f of await readdir(DIR)) {
      const s = await stat(path.join(DIR, f));
      if (f.endsWith(".dump") && s.mtimeMs < cutoff) {
        await unlink(path.join(DIR, f));
        pruned++;
      }
    }
    await saveSetting("backups", { lastBackupAt: new Date().toISOString() });
    await audit(user.id, "EXPORT", "Backup", file, `Created database backup ${file}${pruned ? ` (pruned ${pruned} old)` : ""}`);
    return { ok: true, message: `Backup created: ${file}` };
  });
}

export async function saveBackupSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("settings.manage");
    const days = Number(fd.get("retentionDays"));
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ActionError("Retention must be between 1 and 3650 days.");
    await saveSetting("backups", { retentionDays: days });
    await audit(user.id, "UPDATE", "Setting", "backups", `Backup retention set to ${days} days`);
    return { ok: true, message: "Retention saved" };
  });
}
