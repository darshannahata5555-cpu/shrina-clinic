import { ShieldCheck } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <Card>
      <EmptyState
        icon={<ShieldCheck className="h-5 w-5" />}
        title="You don't have access to this page"
        description="Your role doesn't include this permission. Ask the clinic owner if you need access."
        action={<LinkButton href="/dashboard" variant="outline">Back to dashboard</LinkButton>}
      />
    </Card>
  );
}
