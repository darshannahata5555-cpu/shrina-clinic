"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { controlBase, controlClass } from "@/components/ui/field";
import { uploadPhotosAction } from "./actions";

export function PhotoUploadForm({
  patientId,
  packages,
  treatments,
  today,
  defaultPackageId,
}: {
  patientId: string;
  packages: { id: string; name: string }[];
  treatments: { id: string; name: string }[];
  today: string;
  defaultPackageId?: string;
}) {
  const dialog = useDialog();
  const [pkg, setPkg] = useState(defaultPackageId ?? "");
  return (
    <ActionForm action={uploadPhotosAction} resetOnSuccess onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="patientId" value={patientId} />
          <FormGrid>
            <Field label="Photo type" required error={fe(s, "kind")}>
              <Select name="kind" defaultValue="BEFORE" options={[["BEFORE", "Before treatment"], ["AFTER", "After treatment"], ["PROGRESS", "Progress (mid-course)"]]} />
            </Field>
            <Field label="Date taken" error={fe(s, "takenAt")}>
              <Input name="takenAt" type="date" defaultValue={today} max={today} />
            </Field>
            <Field label="Treatment package" error={fe(s, "packageId")}>
              <Select name="packageId" value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="Not linked to a package" options={packages.map((p) => [p.id, p.name] as const)} />
            </Field>
            {!pkg && (
              <Field label="Treatment" error={fe(s, "treatmentId")}>
                <Select name="treatmentId" defaultValue="" placeholder="General / not specific" options={treatments.map((t) => [t.id, t.name] as const)} />
              </Field>
            )}
          </FormGrid>
          <Field label="Caption" error={fe(s, "caption")}>
            <Input name="caption" placeholder="e.g. Left cheek, natural light, front view" />
          </Field>
          <Field label="Photos" required error={fe(s, "files")} hint="JPG, PNG, WEBP or HEIC · up to 10 MB each · up to 12 at once">
            <input name="files" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple required className={`${controlClass} file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-2.5 file:py-1 file:text-[13px] file:text-ink`} />
          </Field>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            Photos are stored privately and visible only to authorised staff. They must not be used for marketing unless the patient has given documented marketing-photo consent.
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingText="Uploading…">Upload photos</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

type Ph = { id: string; url: string; kind: string; date: string; dateKey: string; group: string; caption: string | null };

/** Side-by-side before/after comparison. */
export function PhotoCompare({ photos }: { photos: Ph[] }) {
  const groups = useMemo(() => [...new Set(photos.map((p) => p.group))], [photos]);
  const [group, setGroup] = useState(groups[0] ?? "");
  const inGroup = photos.filter((p) => p.group === group).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const defLeft = inGroup.find((p) => p.kind === "BEFORE") ?? inGroup[0];
  const defRight = [...inGroup].reverse().find((p) => p.kind === "AFTER") ?? inGroup[inGroup.length - 1];
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const left = inGroup.find((p) => p.id === leftId) ?? defLeft;
  const right = inGroup.find((p) => p.id === rightId) ?? defRight;
  const label = (p: Ph) => `${p.date} · ${p.kind === "BEFORE" ? "Before" : p.kind === "AFTER" ? "After" : "Progress"}${p.caption ? ` · ${p.caption}` : ""}`;

  if (!photos.length) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setLeftId(null);
            setRightId(null);
          }}
          className={`${controlBase} h-9 w-auto`}
        >
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          [left, setLeftId, "Left"] as const,
          [right, setRightId, "Right"] as const,
        ].map(([ph, set, side]) => (
          <div key={side} className="space-y-2">
            <select value={ph?.id ?? ""} onChange={(e) => set(e.target.value)} className={`${controlClass} h-9`}>
              {inGroup.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
            <div className="aspect-[4/5] overflow-hidden rounded-xl border border-border bg-surface-3">
              {ph && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ph.url} alt={label(ph)} className="h-full w-full object-cover" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
