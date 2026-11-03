import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { signToken } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { kioskBranchId } from "@/app/attendance/kiosk/kiosk-lib";

const TTL_SECONDS = 90;

/**
 * Rotating QR for the kiosk screen. Staff scan it with their phone (signed in to the app) and land on
 * /attendance/me?k=<token>, which checks them in/out with method QR. The token is valid for 90 s and
 * names the kiosk's branch, so a photo of the code can't be reused later or from elsewhere.
 */
export async function GET(req: NextRequest) {
  const branchId = await kioskBranchId();
  if (!branchId) return NextResponse.json({ error: "Kiosk not set up" }, { status: 401 });
  const settings = await getSetting("attendance");
  if (!settings.qrEnabled) return NextResponse.json({ error: "QR attendance is off" }, { status: 404 });

  const token = await signToken({ qr: branchId }, `${TTL_SECONDS}s`);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const url = `${proto}://${host}/attendance/me?k=${encodeURIComponent(token)}`;
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 300, errorCorrectionLevel: "M" });
  return NextResponse.json(
    { dataUrl, expiresAt: Date.now() + TTL_SECONDS * 1000, refreshInSeconds: TTL_SECONDS - 20 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
