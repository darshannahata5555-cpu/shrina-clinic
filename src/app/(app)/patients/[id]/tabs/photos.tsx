import Link from "next/link";
import { Camera, CheckCircle2, ImagePlus, ShieldAlert, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import { activeConsents } from "@/lib/patients";
import { fileUrl } from "@/lib/storage";
import { fmtDate, istDateKey } from "@/lib/format";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { SelectParam } from "@/components/ui/filters";
import { PhotoCompare, PhotoUploadForm } from "../photo-components";
import { approvePhotoAction, deletePhotoAction } from "../actions";

type SP = Record<string, string | string[] | undefined>;
const KIND: Record<string, ["neutral" | "info" | "success" | "violet", string]> = {
  BEFORE: ["info", "Before"],
  AFTER: ["success", "After"],
  PROGRESS: ["violet", "Progress"],
};

export async function PhotosTab({ patientId, user, sp }: { patientId: string; user: CurrentUser; sp: SP }) {
  const pkgFilter = typeof sp.package === "string" ? sp.package : "";
  const [photos, packages, treatments, consents] = await Promise.all([
    db.patientPhoto.findMany({
      where: { patientId, deletedAt: null, ...(pkgFilter ? { packageId: pkgFilter } : {}) },
      include: { treatment: { select: { name: true } } },
      orderBy: { takenAt: "desc" },
    }),
    db.treatmentPackage.findMany({ where: { patientId, deletedAt: null }, select: { id: true, name: true, treatmentId: true }, orderBy: { purchaseDate: "desc" } }),
    db.treatment.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    activeConsents(patientId),
  ]);
  const clinical = consents.has("PHOTO_CLINICAL");
  const marketing = consents.has("PHOTO_MARKETING");
  const pkgName = new Map(packages.map((p) => [p.id, p.name]));
  const groupOf = (ph: (typeof photos)[number]) => (ph.packageId ? (pkgName.get(ph.packageId) ?? "Package") : (ph.treatment?.name ?? "General"));
  const uploaderIds = [...new Set(photos.map((p) => p.approvedById).filter((x): x is string => !!x))];
  const approvers = new Map((await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const groups = new Map<string, Map<string, typeof photos>>();
  for (const ph of photos) {
    const g = groupOf(ph);
    const d = istDateKey(ph.takenAt);
    if (!groups.has(g)) groups.set(g, new Map());
    const byDate = groups.get(g)!;
    byDate.set(d, [...(byDate.get(d) ?? []), ph]);
  }

  const compareData = photos.map((ph) => ({
    id: ph.id,
    url: fileUrl(ph.filePath)!,
    kind: ph.kind,
    date: fmtDate(ph.takenAt),
    dateKey: ph.takenAt.toISOString(),
    group: groupOf(ph),
    caption: ph.caption,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {clinical ? <Badge tone="success">Clinical photo consent on file</Badge> : <Badge tone="danger">No clinical photo consent</Badge>}
          {marketing ? (
            <Badge tone="success">Marketing use consented</Badge>
          ) : (
            <Badge tone="neutral">Not for marketing — no marketing consent</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {packages.length > 0 && <SelectParam name="package" placeholder="All treatments" options={packages.map((p) => [p.id, p.name] as const)} />}
          {can(user, "photos.manage") &&
            (clinical ? (
              <Dialog
                title="Upload photos"
                description="Before, after or progress photos for this patient"
                trigger={
                  <Button size="sm">
                    <ImagePlus className="h-3.5 w-3.5" /> Upload photos
                  </Button>
                }
              >
                <PhotoUploadForm patientId={patientId} packages={packages} treatments={treatments} today={istDateKey()} defaultPackageId={pkgFilter || undefined} />
              </Dialog>
            ) : null)}
        </div>
      </div>

      {!clinical && can(user, "photos.manage") && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Record the patient&apos;s clinical photo consent before uploading photos.
          </span>
          <LinkButton href={`/patients/${patientId}?tab=documents`} variant="outline" size="sm">
            Record consent
          </LinkButton>
        </div>
      )}

      {photos.length === 0 ? (
        <Card>
          <EmptyState icon={<Camera className="h-5 w-5" />} title="No photos yet" description="Before & after photos are grouped by treatment and date, and can be compared side by side." />
        </Card>
      ) : (
        <>
          {photos.length > 1 && (
            <Card>
              <CardHeader title="Compare progress" description="Choose any two photos from the same treatment" />
              <CardBody>
                <PhotoCompare photos={compareData} />
              </CardBody>
            </Card>
          )}
          {[...groups].map(([g, byDate]) => (
            <Card key={g}>
              <CardHeader title={g} description={`${[...byDate.values()].reduce((s, l) => s + l.length, 0)} photos`} />
              <CardBody className="space-y-5">
                {[...byDate].map(([d, list]) => (
                  <div key={d}>
                    <p className="mb-2 text-xs font-medium text-muted">{fmtDate(list[0]!.takenAt)}</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {list.map((ph) => (
                        <figure key={ph.id} className="group overflow-hidden rounded-xl border border-border bg-surface-2">
                          <Link href={fileUrl(ph.filePath)!} target="_blank" className="block aspect-[4/5] bg-surface-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(ph.filePath)!} alt={`${KIND[ph.kind]?.[1]} photo, ${fmtDate(ph.takenAt)}`} loading="lazy" className="h-full w-full object-cover" />
                          </Link>
                          <figcaption className="space-y-1.5 p-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge tone={KIND[ph.kind]?.[0] ?? "neutral"}>{KIND[ph.kind]?.[1] ?? ph.kind}</Badge>
                              {ph.approved ? (
                                <Badge tone="success">
                                  <CheckCircle2 className="h-3 w-3" /> Approved
                                </Badge>
                              ) : (
                                <Badge tone="warning">Awaiting doctor</Badge>
                              )}
                            </div>
                            {ph.caption && <p className="line-clamp-2 text-xs text-ink-2">{ph.caption}</p>}
                            {ph.approved && ph.approvedById && <p className="text-[11px] text-muted">by {approvers.get(ph.approvedById) ?? "doctor"}</p>}
                            <div className="flex items-center gap-1">
                              {can(user, "photos.approve") && (
                                <ActionButton action={approvePhotoAction} fields={{ id: ph.id }} variant="ghost" className="h-7 px-2 text-xs">
                                  {ph.approved ? "Unapprove" : "Approve"}
                                </ActionButton>
                              )}
                              {can(user, "photos.manage") && (
                                <ActionButton action={deletePhotoAction} fields={{ id: ph.id }} variant="ghost" className="h-7 px-2 text-xs text-danger" confirm="Delete this photo?" title="Delete photo">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </ActionButton>
                              )}
                            </div>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
