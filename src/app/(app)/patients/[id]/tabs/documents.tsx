import Link from "next/link";
import { FileText, Lock, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import { CONSENT_LABEL, MEDICAL_CATEGORIES } from "@/lib/patients";
import { fileUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime, istDateKey } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { ConsentForm, MedicalEntryForm } from "../record-forms";
import { revokeConsentAction } from "../actions";

export async function DocumentsTab({ patientId, user }: { patientId: string; user: CurrentUser }) {
  const medical = can(user, "patients.medical");
  const canConsent = can(user, "photos.manage") || can(user, "patients.edit");
  const [consents, entries] = await Promise.all([
    db.consentRecord.findMany({ where: { patientId }, orderBy: { signedAt: "desc" } }),
    medical ? db.medicalHistoryEntry.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" } }) : Promise.resolve([]),
  ]);
  const people = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...consents.map((c) => c.recordedById), ...entries.map((e) => e.recordedById)].filter((x): x is string => !!x) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const catLabel = Object.fromEntries(MEDICAL_CATEGORIES);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Consent records"
          description="Treatment, clinical-photo, marketing-photo and communication consents. Photos are never used for marketing without documented marketing consent."
          actions={
            canConsent && (
              <Dialog
                title="Record consent"
                trigger={
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5" /> Record consent
                  </Button>
                }
              >
                <ConsentForm patientId={patientId} today={istDateKey()} types={Object.entries(CONSENT_LABEL)} />
              </Dialog>
            )
          }
        />
        <Table>
          <THead>
            <tr>
              <TH>Consent</TH>
              <TH>Signed</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">Notes</TH>
              <TH className="hidden sm:table-cell">Document</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {consents.length === 0 && <TableEmpty colSpan={6}>No consents recorded yet.</TableEmpty>}
            {consents.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{CONSENT_LABEL[c.type] ?? c.type}</TD>
                <TD className="whitespace-nowrap text-ink-2">
                  {fmtDate(c.signedAt)}
                  {c.recordedById && <span className="block text-xs text-muted">by {people.get(c.recordedById) ?? "staff"}</span>}
                </TD>
                <TD>{c.revokedAt ? <Badge tone="danger">Revoked {fmtDate(c.revokedAt)}</Badge> : c.granted ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Declined</Badge>}</TD>
                <TD className="hidden max-w-sm text-ink-2 md:table-cell">{c.notes ?? "—"}</TD>
                <TD className="hidden sm:table-cell">
                  {c.documentPath ? (
                    <Link href={fileUrl(c.documentPath)!} target="_blank" className="inline-flex items-center gap-1 text-accent hover:underline">
                      <FileText className="h-3.5 w-3.5" /> View
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </TD>
                <TD className="text-right">
                  {canConsent && !c.revokedAt && c.granted && (
                    <ActionButton action={revokeConsentAction} fields={{ id: c.id }} variant="ghost" className="text-danger" confirm={`Revoke ${CONSENT_LABEL[c.type]}? This is recorded in the audit log.`}>
                      Revoke
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-muted" /> Medical history records
            </span>
          }
          description={medical ? "Confidential — append-only log of conditions, allergies, medications and procedures." : undefined}
          actions={
            medical && (
              <Dialog
                title="Add medical record"
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="h-3.5 w-3.5" /> Add record
                  </Button>
                }
              >
                <MedicalEntryForm patientId={patientId} categories={MEDICAL_CATEGORIES} />
              </Dialog>
            )
          }
        />
        {!medical ? (
          <p className="px-5 py-6 text-sm text-muted">Medical history is visible to doctors and the owner only.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Category</TH>
                <TH>Details</TH>
                <TH className="hidden sm:table-cell">Recorded</TH>
              </tr>
            </THead>
            <tbody>
              {entries.length === 0 && <TableEmpty colSpan={3}>No medical records yet.</TableEmpty>}
              {entries.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <Badge tone={e.category === "ALLERGY" ? "danger" : "neutral"}>{catLabel[e.category] ?? e.category}</Badge>
                  </TD>
                  <TD className="text-ink">{e.description}</TD>
                  <TD className="hidden whitespace-nowrap text-ink-2 sm:table-cell">
                    {fmtDateTime(e.recordedAt)}
                    {e.recordedById && <span className="block text-xs text-muted">{people.get(e.recordedById) ?? "staff"}</span>}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
