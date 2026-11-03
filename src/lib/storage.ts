import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { ActionError } from "./auth";

/**
 * Private file storage (patient photos, consent forms, expense receipts).
 * Files live OUTSIDE /public and are only served through the authenticated
 * route `/api/files/[...path]`, which checks permissions per folder.
 * Swap this module for S3 / R2 / GCS in production without touching callers.
 */
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || "storage");

export type StorageFolder = "photos" | "consents" | "receipts" | "imports" | "backups";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const DOC_TYPES = [...IMAGE_TYPES, "application/pdf"];

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

function resolveSafe(rel: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, rel);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid path");
  return full;
}

export async function saveUpload(
  file: File,
  folder: StorageFolder,
  opts: { kind?: "image" | "document"; maxMb?: number } = {},
): Promise<{ relPath: string; mimeType: string }> {
  const allowed = opts.kind === "image" ? IMAGE_TYPES : DOC_TYPES;
  if (!file || file.size === 0) throw new ActionError("Please choose a file.");
  if (!allowed.includes(file.type)) throw new ActionError(`Unsupported file type (${file.type || "unknown"}).`);
  const max = (opts.maxMb ?? 10) * 1024 * 1024;
  if (file.size > max) throw new ActionError(`File is larger than ${opts.maxMb ?? 10} MB.`);

  const month = new Date().toISOString().slice(0, 7);
  const rel = path.posix.join(folder, month, `${randomUUID()}.${EXT[file.type] ?? "bin"}`);
  const full = resolveSafe(rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(await file.arrayBuffer()));
  return { relPath: rel, mimeType: file.type };
}

export async function saveBuffer(buf: Buffer, folder: StorageFolder, ext: string) {
  const rel = path.posix.join(folder, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.${ext}`);
  const full = resolveSafe(rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return rel;
}

export async function readStored(rel: string): Promise<{ data: Buffer; mimeType: string; size: number } | null> {
  try {
    const full = resolveSafe(rel);
    const s = await stat(full);
    const ext = path.extname(full).slice(1).toLowerCase();
    return { data: await readFile(full), mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream", size: s.size };
  } catch {
    return null;
  }
}

/** URL for displaying a stored file in the app (auth-checked route). */
export const fileUrl = (rel: string | null | undefined) => (rel ? `/api/files/${rel}` : null);
