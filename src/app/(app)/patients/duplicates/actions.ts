"use server";

import { db } from "@/lib/db";
import { ActionError, assertPermission } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { handle, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";

/**
 * Merge duplicate patient records into one primary record. Every related record is
 * re-pointed to the primary inside a single transaction; duplicates are archived
 * (soft-deleted) with a note, so nothing is lost and it can be traced in the audit log.
 */
export async function mergePatientsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("patients.edit");
    if (!user.permissions.has("patients.delete")) throw new ActionError("Merging needs both edit and delete permission on patients.");
    const primaryId = String(fd.get("primaryId") ?? "");
    const dupIds = fd.getAll("mergeIds").map(String).filter((id) => id && id !== primaryId);
    if (!primaryId) throw new ActionError("Choose the record to keep.");
    if (!dupIds.length) throw new ActionError("Choose at least one duplicate to merge into the kept record.");

    const all = await db.patient.findMany({ where: { id: { in: [primaryId, ...dupIds] }, deletedAt: null } });
    const primary = all.find((p) => p.id === primaryId);
    const dups = all.filter((p) => p.id !== primaryId);
    if (!primary || dups.length !== dupIds.length) throw new ActionError("One of the records no longer exists. Refresh and try again.");
    for (const p of all) await assertBranchAccess(user, p.branchId);

    const moved: Record<string, number> = {};
    await db.$transaction(async (tx) => {
      const where = { patientId: { in: dupIds } };
      const to = { patientId: primaryId };
      const counts = await Promise.all([
        tx.appointment.updateMany({ where, data: to }),
        tx.treatmentPackage.updateMany({ where, data: to }),
        tx.treatmentSession.updateMany({ where, data: to }),
        tx.consultation.updateMany({ where, data: to }),
        tx.invoice.updateMany({ where, data: to }),
        tx.payment.updateMany({ where, data: to }),
        tx.creditNote.updateMany({ where, data: to }),
        tx.patientPhoto.updateMany({ where, data: to }),
        tx.consentRecord.updateMany({ where, data: to }),
        tx.medicalHistoryEntry.updateMany({ where, data: to }),
        tx.patientTransfer.updateMany({ where, data: to }),
        tx.lead.updateMany({ where, data: to }),
        tx.notification.updateMany({ where, data: to }),
      ]);
      const names = ["appointments", "packages", "sessions", "consultations", "invoices", "payments", "creditNotes", "photos", "consents", "medicalEntries", "transfers", "leads", "notifications"];
      counts.forEach((c, i) => c.count && (moved[names[i]!] = c.count));

      // Fill gaps on the primary from duplicates; keep earliest first visit / latest last visit.
      const pick = <K extends keyof typeof primary>(k: K) => primary[k] ?? dups.map((d) => d[k]).find((v) => v !== null && v !== undefined) ?? null;
      const dates = (k: "firstVisitAt" | "lastVisitAt" | "registeredAt") => [primary[k], ...dups.map((d) => d[k])].filter((x): x is Date => !!x).map((d) => d.getTime());
      const first = dates("firstVisitAt");
      const last = dates("lastVisitAt");
      const reg = dates("registeredAt");
      const mergeNote = `Merged duplicate record(s): ${dups.map((d) => `${d.code} (${d.fullName})`).join(", ")} on ${new Date().toISOString().slice(0, 10)}.`;
      await tx.patient.update({
        where: { id: primaryId },
        data: {
          altMobile: pick("altMobile"),
          email: pick("email"),
          dob: pick("dob"),
          gender: pick("gender"),
          address: pick("address"),
          city: pick("city"),
          source: pick("source"),
          referredBy: pick("referredBy"),
          assignedDoctorId: pick("assignedDoctorId"),
          skinType: pick("skinType"),
          allergies: pick("allergies"),
          medicalHistory: [primary.medicalHistory, ...dups.map((d) => d.medicalHistory)].filter(Boolean).join("\n") || null,
          marketingConsent: primary.marketingConsent || dups.some((d) => d.marketingConsent),
          firstVisitAt: first.length ? new Date(Math.min(...first)) : null,
          lastVisitAt: last.length ? new Date(Math.max(...last)) : null,
          registeredAt: new Date(Math.min(...reg)),
          notes: [primary.notes, mergeNote].filter(Boolean).join("\n"),
        },
      });
      for (const d of dups) {
        await tx.patient.update({
          where: { id: d.id },
          data: { deletedAt: new Date(), notes: [d.notes, `Merged into ${primary.code} (${primary.fullName}).`].filter(Boolean).join("\n") },
        });
      }
      await audit(
        user.id,
        "UPDATE",
        "Patient",
        primaryId,
        `Merged ${dups.map((d) => d.code).join(", ")} into ${primary.code} (${primary.fullName})`,
        { changes: { mergedIds: dupIds, moved }, branchId: primary.branchId, tx },
      );
    });
    return { ok: true, message: `Merged ${dups.length} record${dups.length > 1 ? "s" : ""} into ${primary.code}` };
  });
}
