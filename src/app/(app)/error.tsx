"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <Card>
      <EmptyState
        icon={<TriangleAlert className="h-5 w-5" />}
        title="Something went wrong on this page"
        description={`Please try again. If it keeps happening, share this reference with your administrator: ${error.digest ?? "n/a"}`}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
