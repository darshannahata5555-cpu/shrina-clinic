"use server";

import { db } from "@/lib/db";
import { ActionError, assertPermission } from "@/lib/auth";
import { resolveWriteBranch } from "@/lib/branch";
import { handle, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { fromIst } from "@/lib/format";
import { normalizeRecord, readWorkbook, type ImportRecord, type PreviewRow } from "./parse";

const MAX_ROWS = 5000;

export type PreviewState = {
  ok: boolean;
  error?: string;
  rows?: PreviewRow[];
  fileName?: string;
  unknownHeaders?: string[];
} | null;

async function existingByMobile(mobiles: string[]) {
  const found = await db.patient.findMany({
    where: { deletedAt: null, OR: [{ mobile: { in: mobiles } }, { altMobile: { in: mobiles } }] },
    select: { code: true, fullName: true, mobile: true, altMobile: true },
  });
  const m = new Map<string, string>();
  for (const p of found) {
    m.set(p.mobile, `${p.fullName} (${p.code})`);
    if (p.altMobile) m.set(p.altMobile, `${p.fullName} (${p.code})`);
  }
  return m;
}

function flagRows(rows: PreviewRow[], existing: Map<string, string>) {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (r.errors.length) continue;
    const ex = existing.get(r.data.mobile);
    if (ex) r.duplicate = `Mobile already registered to ${ex}`;
    else if (seen.has(r.data.mobile)) r.duplicate = `Same mobile as row ${seen.get(r.data.mobile)} in this file`;
    else seen.set(r.data.mobile, r.row);
  }
  return rows;
}

export async function previewImportAction(_: PreviewState, fd: FormData): Promise<PreviewState> {
  try {
    await assertPermission("patients.import");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an Excel (.xlsx) file." };
    if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, error: "Only .xlsx files are supported. In Excel use File → Save As → Excel Workbook (.xlsx)." };
    if (file.size > 8 * 1024 * 1024) return { ok: false, error: "File is larger than 8 MB." };
    const { rows, unknownHeaders } = await readWorkbook(await file.arrayBuffer());
    if (!rows.length) return { ok: false, error: "No data rows found. Make sure the first row has column headers (download the template)." };
    if (rows.length > MAX_ROWS) return { ok: false, error: `The file has ${rows.length} rows — import at most ${MAX_ROWS} at a time.` };
    const preview: PreviewRow[] = rows.map(({ row, raw }) => {
      const { data, errors } = normalizeRecord(raw);
      return { row, data, errors, duplicate: null };
    });
    const existing = await existingByMobile([...new Set(preview.map((r) => r.data.mobile).filter(Boolean))]);
    return { ok: true, rows: flagRows(preview, existing), fileName: file.name, unknownHeaders };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    console.error("[import preview]", e);
    return { ok: false, error: "Couldn't read that file. Is it a valid .xlsx workbook?" };
  }
}

export async function importPatientsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("patients.import");
    const branchId = await resolveWriteBranch(String(fd.get("branchId") ?? "") || null);
    const includeDuplicates = fd.get("includeDuplicates") === "on";
    let payload: { row: number; data: Partial<Record<keyof ImportRecord, string>> }[];
    try {
      payload = JSON.parse(String(fd.get("payload") ?? "[]"));
    } catch {
      throw new ActionError("Import data was corrupted — please preview the file again.");
    }
    if (!Array.isArray(payload) || !payload.length) throw new ActionError("Nothing to import.");
    if (payload.length > MAX_ROWS) throw new ActionError(`Import at most ${MAX_ROWS} rows at a time.`);

    // Re-validate on the server.
    const rows: PreviewRow[] = payload.map((p) => {
      const raw = Object.fromEntries(Object.entries(p.data ?? {}).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));
      const { data, errors } = normalizeRecord(raw);
      return { row: Number(p.row) || 0, data, errors, duplicate: null };
    });
    const existing = await existingByMobile([...new Set(rows.map((r) => r.data.mobile))]);
    flagRows(rows, existing);
    const toImport = rows.filter((r) => !r.errors.length && (includeDuplicates || !r.duplicate));
    const skipped = rows.length - toImport.length;
    if (!toImport.length) throw new ActionError("No valid rows to import (all rows had errors or were duplicates).");

    const created = await db.$transaction(
      async (tx) => {
        // Reserve a block of patient IDs in one atomic step (same format as nextPatientCode: SHR-000123).
        const counter = await tx.counter.upsert({
          where: { key: "patient" },
          create: { key: "patient", value: toImport.length },
          update: { value: { increment: toImport.length } },
        });
        const start = counter.value - toImport.length + 1;
        await tx.patient.createMany({
          data: toImport.map((r, i) => ({
            code: `SHR-${String(start + i).padStart(6, "0")}`,
            fullName: r.data.fullName,
            mobile: r.data.mobile,
            altMobile: r.data.altMobile,
            email: r.data.email,
            dob: r.data.dob ? fromIst(r.data.dob) : null,
            gender: r.data.gender,
            address: r.data.address,
            city: r.data.city,
            source: r.data.source as never,
            referredBy: r.data.referredBy,
            skinType: r.data.skinType,
            allergies: r.data.allergies,
            medicalHistory: r.data.medicalHistory,
            notes: [r.data.notes, r.data.legacyId ? `Old patient ID: ${r.data.legacyId}` : null, r.duplicate ? `Imported despite: ${r.duplicate}` : null].filter(Boolean).join("\n") || null,
            registeredAt: r.data.registeredAt ? fromIst(r.data.registeredAt) : new Date(),
            branchId,
            createdById: user.id,
          })),
        });
        await audit(user.id, "IMPORT", "Patient", null, `Imported ${toImport.length} patients from Excel (${skipped} skipped)`, {
          changes: { imported: toImport.length, skipped, codes: [`SHR-${String(start).padStart(6, "0")}`, `SHR-${String(start + toImport.length - 1).padStart(6, "0")}`] },
          branchId,
          tx,
        });
        return toImport.length;
      },
      { timeout: 60000 },
    );
    return { ok: true, message: `Imported ${created} patient${created === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}` };
  });
}
