import { NextResponse, type NextRequest } from "next/server";

// Optimistic auth gate: bounce requests without a session cookie to /login.
// Real verification (signature, user active, session version, permissions) happens
// server-side in requireUser()/assertPermission().
const PUBLIC = ["/login", "/api/cron", "/attendance/kiosk", "/api/attendance/kiosk", "/_next", "/favicon"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("shrina_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp|woff2)$).*)"],
};
