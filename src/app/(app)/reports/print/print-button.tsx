"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <Button onClick={() => window.print()} size="sm">
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </Button>
  );
}
