import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("scroll-thin relative overflow-x-auto", className)}>
      <table className="w-full min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface-2 text-left text-xs font-medium text-muted">
      {children}
    </thead>
  );
}

export function TH({ className, ...p }: ComponentProps<"th">) {
  return <th className={cn("px-4 py-2.5 font-medium whitespace-nowrap first:pl-5 last:pr-5", className)} {...p} />;
}

export function TR({ className, ...p }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border last:border-0 hover:bg-surface-2/60", className)} {...p} />;
}

export function TD({ className, ...p }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle text-ink first:pl-5 last:pr-5", className)} {...p} />;
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}
