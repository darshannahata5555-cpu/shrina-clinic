"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** On-screen toolbar for printable documents (hidden when printing). `auto` opens the print dialog once. */
export function PrintToolbar({ backHref, backLabel, auto }: { backHref: string; backLabel: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3">
      <Link href={backHref} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5" /> {backLabel}
      </Link>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted sm:inline">Choose “Save as PDF” in the print dialog to download</span>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save PDF
        </Button>
      </div>
    </div>
  );
}
