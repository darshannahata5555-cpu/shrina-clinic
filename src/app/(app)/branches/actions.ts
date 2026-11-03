"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ActionError } from "@/lib/auth";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { saveSetting, getSetting } from "@/lib/settings";

const BranchSchema = z.object({
  id: zf.optId(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "Use 2–5 letters, e.g. FLG"),
  name: zf.text("Branch name"),
  city: zf.optText(),
  address: zf.optText(),
  phone: zf.optText(),
  email: zf.optEmail(),
  gstin: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters").optional()).transform((v) => v ?? null),
  openTime: z.string().regex(/^\d{2}:\d{2}$/, "Opening time required"),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/, "Closing time required"),
  lat: zf.optNum(),
  lng: zf.optNum(),
});

/** Create or update a branch. */
export async function saveBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("branches.manage");
    const { id, lat, lng, ...data } = parse(BranchSchema, formObject(fd));

    let branchId: string;
    if (id) {
      const before = await db.branch.findUniqueOrThrow({ where: { id } });
      const after = await db.branch.update({ where: { id }, data });
      branchId = id;
      await audit(user.id, "UPDATE", "Branch", id, `Updated branch ${after.name}`, { changes: diff(before, after, Object.keys(data)), branchId: id });
    } else {
      const created = await db.branch.create({ data });
      branchId = created.id;
      await audit(user.id, "CREATE", "Branch", created.id, `Created branch ${created.name}`, { branchId: created.id });
    }

    // Optional geo-fence centre for GPS attendance.
    if (lat !== null && lng !== null) {
      const att = await getSetting("attendance");
      await saveSetting("attendance", { branchLocations: { ...att.branchLocations, [branchId]: { lat, lng } } });
    }
    return { ok: true, message: id ? "Branch updated" : "Branch created", id: branchId };
  });
}

export async function toggleBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("branches.manage");
    const id = String(fd.get("id"));
    const b = await db.branch.findUniqueOrThrow({ where: { id } });
    if (b.isActive) {
      const active = await db.branch.count({ where: { isActive: true } });
      if (active <= 1) throw new ActionError("At least one branch must stay active.");
    }
    await db.branch.update({ where: { id }, data: { isActive: !b.isActive } });
    await audit(user.id, "STATUS", "Branch", id, `${b.isActive ? "Deactivated" : "Reactivated"} branch ${b.name}`, { branchId: id });
    return { ok: true, message: b.isActive ? "Branch deactivated" : "Branch reactivated" };
  });
}
