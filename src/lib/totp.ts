import "server-only";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

/** Two-factor authentication (TOTP — Google Authenticator, Microsoft Authenticator, Authy…). */
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secret: string, label: string) {
  return new TOTP({ issuer: "SHRINA Clinic", label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

export function verifyTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return totp(secret, "user").validate({ token: clean, window: 1 }) !== null;
}

export async function totpQrDataUrl(secret: string, label: string): Promise<string> {
  return QRCode.toDataURL(totp(secret, label).toString(), { margin: 1, width: 220 });
}
