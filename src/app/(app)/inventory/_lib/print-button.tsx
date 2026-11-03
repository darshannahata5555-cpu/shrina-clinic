"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function PrintButton({ children }: { children: ReactNode }) {
  return (
    <Button type="button" variant="outline" className="no-print" onClick={() => window.print()}>
      {children}
    </Button>
  );
}
