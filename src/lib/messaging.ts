import "server-only";
import type { NotificationChannel, NotificationStatus } from "@prisma/client";

/**
 * Outbound patient/staff messaging providers.
 *
 *  - WhatsApp: Meta WhatsApp Business Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID).
 *    NOTE: free-form text is only delivered inside the 24-hour customer-service window. Business-initiated
 *    reminders outside that window must use a pre-approved message template (set WHATSAPP_TEMPLATE_* names
 *    and switch `sendWhatsApp` to the `template` payload once templates are approved in Meta Business Manager).
 *  - SMS: generic HTTP adapter (SMS_PROVIDER_URL, SMS_API_KEY, optional SMS_SENDER_ID). Default payload is
 *    MSG91/Textlocal-style JSON `{ sender, to, message }` with an `authkey` header — adjust `smsAdapter` for
 *    the provider you sign up with (DLT template registration is mandatory for Indian SMS).
 *  - Email: Resend REST API (RESEND_API_KEY, EMAIL_FROM).
 *
 * When a provider is not configured the message is marked SKIPPED ("log-only mode") — nothing throws.
 */

export type SendResult = { status: Extract<NotificationStatus, "SENT" | "FAILED" | "SKIPPED">; error?: string; providerId?: string };

const NOT_CONFIGURED = "Provider not configured (log-only mode)";
const TIMEOUT_MS = 12000;

export function providerStatus() {
  return {
    WHATSAPP: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    SMS: !!(process.env.SMS_PROVIDER_URL && process.env.SMS_API_KEY),
    EMAIL: !!process.env.RESEND_API_KEY,
  } as Record<Exclude<NotificationChannel, "IN_APP">, boolean>;
}

/** Indian mobile → E.164 digits without "+" (e.g. 919876543210). */
export function toE164India(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  if (d.length >= 11 && d.length <= 15) return d; // already international
  return null;
}

async function post(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function errorText(r: Response) {
  try {
    const t = await r.text();
    return `HTTP ${r.status}: ${t.slice(0, 300)}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { status: "SKIPPED", error: NOT_CONFIGURED };
  const num = toE164India(to);
  if (!num) return { status: "FAILED", error: `Invalid phone number "${to}"` };
  try {
    const r = await post(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: num, type: "text", text: { preview_url: false, body } }),
    });
    if (!r.ok) return { status: "FAILED", error: await errorText(r) };
    const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[] };
    return { status: "SENT", providerId: j.messages?.[0]?.id };
  } catch (e) {
    return { status: "FAILED", error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Adapter-shaped SMS sender — change the payload/headers here to match your SMS gateway. */
function smsAdapter(to: string, body: string) {
  return {
    url: process.env.SMS_PROVIDER_URL!,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: process.env.SMS_API_KEY!, Authorization: `Bearer ${process.env.SMS_API_KEY}` },
      body: JSON.stringify({ sender: process.env.SMS_SENDER_ID || "SHRINA", to, mobiles: to, message: body, route: "4", country: "91" }),
    } satisfies RequestInit,
  };
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!process.env.SMS_PROVIDER_URL || !process.env.SMS_API_KEY) return { status: "SKIPPED", error: NOT_CONFIGURED };
  const num = toE164India(to);
  if (!num) return { status: "FAILED", error: `Invalid phone number "${to}"` };
  try {
    const { url, init } = smsAdapter(num, body);
    const r = await post(url, init);
    if (!r.ok) return { status: "FAILED", error: await errorText(r) };
    return { status: "SENT" };
  } catch (e) {
    return { status: "FAILED", error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "SKIPPED", error: NOT_CONFIGURED };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { status: "FAILED", error: `Invalid email "${to}"` };
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1c1917">${body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")}</div>`;
  try {
    const r = await post("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "SHRINA Clinic <noreply@example.com>", to: [to], subject, text: body, html }),
    });
    if (!r.ok) return { status: "FAILED", error: await errorText(r) };
    const j = (await r.json().catch(() => ({}))) as { id?: string };
    return { status: "SENT", providerId: j.id };
  } catch (e) {
    return { status: "FAILED", error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Send one message on a channel. IN_APP is delivered by simply existing in the table. */
export async function sendOnChannel(channel: NotificationChannel, recipient: string, body: string, subject?: string | null): Promise<SendResult> {
  switch (channel) {
    case "WHATSAPP":
      return sendWhatsApp(recipient, body);
    case "SMS":
      return sendSms(recipient, body);
    case "EMAIL":
      return sendEmail(recipient, subject || "SHRINA Clinic", body);
    case "IN_APP":
      return { status: "SENT" };
  }
}

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Email",
  IN_APP: "In-app",
};
