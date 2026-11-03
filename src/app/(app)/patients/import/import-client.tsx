"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, FileSpreadsheet, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select, controlClass } from "@/components/ui/field";
import { ActionForm, FormError, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/format";
import { importPatientsAction, previewImportAction } from "./actions";
import type { PreviewRow } from "./parse";

function PreviewButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <LoaderCircle className="h-4 w-4 animate-spin" />} Preview import
    </Button>
  );
}

export function ImportClient({ branches, defaultBranchId }: { branches: { id: string; name: string }[]; defaultBranchId: string | null }) {
  const [preview, previewAction] = useActionState(previewImportAction, null);
  const [includeDup, setIncludeDup] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const rows: PreviewRow[] = useMemo(() => preview?.rows ?? [], [preview]);
  const errorRows = rows.filter((r) => r.errors.length);
  const dupRows = rows.filter((r) => !r.errors.length && r.duplicate);
  const ready = rows.filter((r) => !r.errors.length && (includeDup || !r.duplicate));
  const payload = JSON.stringify(ready.map((r) => ({ row: r.row, data: r.data })));

  if (done) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center py-12 text-center">
          <CircleCheck className="mb-3 h-10 w-10 text-success" />
          <p className="text-base font-semibold text-ink">{done}</p>
          <p className="mt-1 text-sm text-muted">New patients have permanent Patient IDs and appear in search immediately.</p>
          <div className="mt-5 flex gap-2">
            <Link href="/patients?sort=new" className="text-sm font-medium text-accent hover:underline">
              View newest patients →
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="1. Choose file"
          description="Use the template so columns are recognised. Required: Full Name and Mobile."
          actions={
            <a href="/api/patients/import-template" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-surface-2">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Download template
            </a>
          }
        />
        <CardBody>
          <form action={previewAction} className="flex flex-wrap items-end gap-3">
            <Field label="Excel file (.xlsx)" className="min-w-64 flex-1">
              <input
                name="file"
                type="file"
                required
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className={`${controlClass} file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-2.5 file:py-1 file:text-[13px] file:text-ink`}
              />
            </Field>
            <PreviewButton />
          </form>
          {preview && !preview.ok && preview.error && (
            <div className="mt-4">
              <FormError message={preview.error} />
            </div>
          )}
          {preview?.unknownHeaders && preview.unknownHeaders.length > 0 && (
            <p className="mt-3 text-xs text-muted">Ignored columns: {preview.unknownHeaders.join(", ")}</p>
          )}
        </CardBody>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader
            title={`2. Review ${preview?.fileName ?? "file"}`}
            description={`${rows.length} rows · ${rows.length - errorRows.length - dupRows.length} ready · ${dupRows.length} possible duplicates · ${errorRows.length} with errors`}
          />
          <div className="scroll-thin max-h-[420px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Row</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Mobile</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Email</th>
                  <th className="hidden px-4 py-2 font-medium lg:table-cell">DOB / gender</th>
                  <th className="px-4 py-2 font-medium">Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className={cn("border-t border-border align-top", r.errors.length ? "bg-danger-soft/40" : r.duplicate ? "bg-warning-soft/40" : "")}>
                    <td className="tabular px-4 py-2 text-muted">{r.row}</td>
                    <td className="px-4 py-2 text-ink">{r.data.fullName || "—"}</td>
                    <td className="tabular px-4 py-2 text-ink-2">{r.data.mobile || "—"}</td>
                    <td className="hidden px-4 py-2 text-ink-2 md:table-cell">{r.data.email ?? "—"}</td>
                    <td className="hidden px-4 py-2 text-ink-2 lg:table-cell">{[r.data.dob, r.data.gender?.toLowerCase()].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-2">
                      {r.errors.length ? (
                        <span className="flex items-start gap-1 text-danger">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.errors.join("; ")}
                        </span>
                      ) : r.duplicate ? (
                        <span className="text-warning">{r.duplicate}</span>
                      ) : (
                        <Badge tone="success">Ready</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <ActionForm action={importPatientsAction} refresh={false} onSuccess={(s) => setDone(s?.message ?? "Import complete")}>
              <input type="hidden" name="payload" value={payload} />
              <div className="flex flex-wrap items-end gap-4">
                {branches.length > 1 ? (
                  <Field label="Import into branch" className="min-w-56">
                    <Select name="branchId" defaultValue={defaultBranchId ?? ""} options={branches.map((b) => [b.id, b.name] as const)} required />
                  </Field>
                ) : (
                  <input type="hidden" name="branchId" value={branches[0]?.id ?? ""} />
                )}
                {dupRows.length > 0 && (
                  <Checkbox
                    name="includeDuplicates"
                    checked={includeDup}
                    onChange={(e) => setIncludeDup(e.target.checked)}
                    label={`Also import ${dupRows.length} possible duplicate${dupRows.length > 1 ? "s" : ""}`}
                    className="pb-2"
                  />
                )}
                <div className="ml-auto">
                  <SubmitButton disabled={!ready.length} pendingText="Importing…">
                    Import {ready.length} patient{ready.length === 1 ? "" : "s"}
                  </SubmitButton>
                </div>
              </div>
              {errorRows.length > 0 && <p className="mt-3 text-xs text-muted">Rows with errors are skipped. Fix them in Excel and import again.</p>}
            </ActionForm>
          </div>
        </Card>
      )}
    </div>
  );
}
