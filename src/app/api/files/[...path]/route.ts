import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readStored } from "@/lib/storage";
import type { Permission } from "@/lib/permissions";

// Private files are only served to signed-in users holding the folder's permission.
const FOLDER_PERMS: Record<string, Permission[]> = {
  photos: ["photos.view"],
  consents: ["photos.view", "patients.medical", "patients.edit"],
  receipts: ["expenses.view", "expenses.approve", "expenses.create"],
  imports: ["patients.import"],
  backups: ["settings.manage"],
};

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { path } = await ctx.params;
  const rel = path.join("/");
  const perms = FOLDER_PERMS[path[0] ?? ""];
  if (!perms || !perms.some((p) => user.permissions.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const file = await readStored(rel);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
