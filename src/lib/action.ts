import "server-only";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "./auth";
import { fromIst, fromIstLocal } from "./format";

/** Shape returned by every server action; consumed by `useActionState` forms. */
export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
} | null;

export class FieldError extends Error {
  constructor(public fieldErrors: Record<string, string>, message = "Please fix the highlighted fields.") {
    super(message);
  }
}

/**
 * Wrap a server action body: converts thrown ActionError / FieldError / zod / Prisma errors
 * into an ActionState. `redirect()` / `notFound()` still work (they are re-thrown).
 */
export async function handle(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof FieldError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof ActionError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return { ok: false, error: "A record with the same unique value already exists." };
      if (e.code === "P2025") return { ok: false, error: "The record no longer exists." };
    }
    console.error("[action]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Validate input with a zod schema; throws FieldError keyed by field name. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fe: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = i.path.join(".") || "_";
      if (!fe[k]) fe[k] = i.message;
    }
    throw new FieldError(fe);
  }
  return r.data;
}

/** FormData → plain object (last value wins; use fd.getAll for multi-value fields). */
export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v === "string") o[k] = v;
  }
  return o;
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Zod field helpers for HTML form values (all arrive as strings). */
export const zf = {
  text: (label = "This field", min = 1) =>
    z.string({ error: `${label} is required` }).trim().min(min, min > 1 ? `${label} must be at least ${min} characters` : `${label} is required`),
  optText: () => z.preprocess(blankToUndef, z.string().trim().optional()).transform((v) => v ?? null),
  num: (label = "Value") =>
    z.preprocess(blankToUndef, z.coerce.number({ error: `${label} must be a number` })),
  optNum: () => z.preprocess(blankToUndef, z.coerce.number().optional()).transform((v) => v ?? null),
  int: (label = "Value") => z.preprocess(blankToUndef, z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`)),
  /** "YYYY-MM-DD" in IST → Date */
  date: (label = "Date") =>
    z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`).transform((v) => fromIst(v)),
  optDate: () =>
    z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()).transform((v) => (v ? fromIst(v) : null)),
  /** datetime-local in IST → Date */
  dateTime: (label = "Date & time") =>
    z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${label} is required`).transform((v) => fromIstLocal(v)),
  bool: () => z.preprocess((v) => v === "on" || v === "true" || v === "1" || v === true, z.boolean()),
  id: (label = "Selection") => z.string({ error: `${label} is required` }).min(1, `${label} is required`),
  optId: () => z.preprocess(blankToUndef, z.string().optional()).transform((v) => v ?? null),
  mobile: (label = "Mobile number") =>
    z.string({ error: `${label} is required` }).transform((v) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")).pipe(z.string().regex(/^\d{10}$/, `${label} must be 10 digits`)),
  optEmail: () => z.preprocess(blankToUndef, z.email("Enter a valid email").optional()).transform((v) => v ?? null),
  enumOf: <T extends readonly [string, ...string[]]>(values: T, label = "Value") => z.enum(values, { error: `Choose a valid ${label.toLowerCase()}` }),
};
