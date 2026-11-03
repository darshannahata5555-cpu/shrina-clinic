import { SearchX } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<SearchX className="h-5 w-5" />}
        title="Record not found"
        description="It may have been deleted, moved to another branch you can't access, or the link is wrong."
        action={<LinkButton href="/dashboard" variant="outline">Back to dashboard</LinkButton>}
      />
    </Card>
  );
}
