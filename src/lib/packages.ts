import "server-only";
import { db, type Tx } from "./db";
import { ActionError } from "./auth";
import { nextPackageCode } from "./sequence";
import { stockOut } from "./inventory";
import { toNum } from "./format";
import { notifyUsers } from "./notify";

/** Remaining Sessions = Total Sessions − Completed Sessions (never negative). */
export const remainingSessions = (p: { totalSessions: number; completedSessions: number }) =>
  Math.max(0, p.totalSessions - p.completedSessions);

export type CreatePackageInput = {
  patientId: string;
  treatmentId: string;
  branchId: string;
  name?: string | null;
  bodyArea?: string | null;
  totalSessions: number;
  price: number;
  purchaseDate?: Date | null;
  expiryDate?: Date | null;
  doctorId?: string | null;
  therapistId?: string | null;
  notes?: string | null;
  renewedFromId?: string | null;
  userId?: string | null;
};

export async function createPackage(input: CreatePackageInput, tx: Tx) {
  const treatment = await tx.treatment.findUniqueOrThrow({ where: { id: input.treatmentId } });
  if (!(input.totalSessions >= 1)) throw new ActionError("Total sessions must be at least 1.");
  const purchaseDate = input.purchaseDate ?? new Date();
  const expiryDate =
    input.expiryDate ?? new Date(purchaseDate.getTime() + treatment.validityDays * 86400000);
  const name =
    input.name?.trim() ||
    `${treatment.name}${input.bodyArea && !treatment.name.includes(input.bodyArea) ? ` – ${input.bodyArea}` : ""} · ${input.totalSessions} session${input.totalSessions > 1 ? "s" : ""}`;
  return tx.treatmentPackage.create({
    data: {
      code: await nextPackageCode(tx),
      patientId: input.patientId,
      treatmentId: input.treatmentId,
      branchId: input.branchId,
      name,
      bodyArea: input.bodyArea ?? null,
      totalSessions: input.totalSessions,
      price: input.price,
      purchaseDate,
      expiryDate,
      doctorId: input.doctorId ?? null,
      therapistId: input.therapistId ?? null,
      notes: input.notes ?? null,
      renewedFromId: input.renewedFromId ?? null,
      createdById: input.userId ?? null,
    },
  });
}

/**
 * Recount completed sessions for a package and update its status.
 * Call after any session status change.
 */
export async function syncPackageProgress(packageId: string, tx: Tx) {
  const pkg = await tx.treatmentPackage.findUniqueOrThrow({ where: { id: packageId } });
  const completed = await tx.treatmentSession.count({ where: { packageId, status: "COMPLETED" } });
  let status = pkg.status;
  if (status === "ACTIVE" && completed >= pkg.totalSessions) status = "COMPLETED";
  if (status === "COMPLETED" && completed < pkg.totalSessions) status = "ACTIVE";
  return tx.treatmentPackage.update({ where: { id: packageId }, data: { completedSessions: completed, status } });
}

export type CompleteSessionInput = {
  performedAt?: Date | null;
  doctorId?: string | null;
  therapistId?: string | null;
  notes?: string | null;
  observations?: string | null;
  userId?: string | null;
};

/**
 * Mark a session completed: numbers it within its package, deducts the treatment's
 * configured product usage from inventory (once), updates the package's remaining
 * sessions, the linked appointment and the patient's visit dates.
 * Returns any stock shortfalls so the UI can warn.
 */
export async function completeSession(sessionId: string, input: CompleteSessionInput, tx: Tx) {
  const s = await tx.treatmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { package: true, treatment: { include: { productUsages: { include: { product: true } } } } },
  });
  if (s.status === "COMPLETED") throw new ActionError("This session is already marked completed.");
  if (s.package) {
    if (s.package.status === "CANCELLED") throw new ActionError("This package has been cancelled.");
    if (s.package.completedSessions >= s.package.totalSessions)
      throw new ActionError("All sessions in this package are already used. Renew the package to continue.");
  }

  const performedAt = input.performedAt ?? new Date();
  const sessionNumber =
    s.sessionNumber ?? (s.packageId ? (await tx.treatmentSession.count({ where: { packageId: s.packageId, status: "COMPLETED" } })) + 1 : null);

  // Automatic product deduction, e.g. 5 ml serum per Hydra Facial.
  const shortfalls: { product: string; shortfall: number; unit: string }[] = [];
  if (!s.stockDeducted) {
    for (const u of s.treatment.productUsages) {
      const qty = toNum(u.quantity);
      if (qty <= 0) continue;
      const r = await stockOut(
        {
          productId: u.productId,
          branchId: s.branchId,
          quantity: qty,
          type: "TREATMENT_USAGE",
          refType: "Session",
          refId: s.id,
          notes: `${s.treatment.name} session`,
          userId: input.userId,
          allowShortfall: true,
        },
        tx,
      );
      if (r.shortfall > 0) shortfalls.push({ product: u.product.name, shortfall: r.shortfall, unit: u.product.unit });
    }
  }

  const updated = await tx.treatmentSession.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      performedAt,
      sessionNumber,
      doctorId: input.doctorId ?? s.doctorId,
      therapistId: input.therapistId ?? s.therapistId,
      notes: input.notes ?? s.notes,
      observations: input.observations ?? s.observations,
      stockDeducted: true,
    },
  });

  if (s.packageId) await syncPackageProgress(s.packageId, tx);
  if (s.appointmentId)
    await tx.appointment.update({ where: { id: s.appointmentId }, data: { status: "COMPLETED", completedAt: performedAt } });

  const patient = await tx.patient.findUniqueOrThrow({ where: { id: s.patientId }, select: { firstVisitAt: true, lastVisitAt: true } });
  await tx.patient.update({
    where: { id: s.patientId },
    data: {
      firstVisitAt: patient.firstVisitAt ?? performedAt,
      lastVisitAt: !patient.lastVisitAt || patient.lastVisitAt < performedAt ? performedAt : patient.lastVisitAt,
    },
  });

  if (shortfalls.length) {
    await notifyUsers(
      {
        permission: "inventory.manage",
        branchId: s.branchId,
        title: "Stock shortfall during treatment",
        body: shortfalls.map((x) => `${x.product}: short by ${x.shortfall} ${x.unit}`).join(", "),
        link: "/inventory",
      },
      tx,
    );
  }
  return { session: updated, shortfalls };
}

/** Packages past their expiry date with sessions left are flipped to EXPIRED. Idempotent. */
export async function expireOverduePackages(tx?: Tx) {
  return (tx ?? db).treatmentPackage.updateMany({
    where: { status: "ACTIVE", expiryDate: { lt: new Date() }, deletedAt: null },
    data: { status: "EXPIRED" },
  });
}
