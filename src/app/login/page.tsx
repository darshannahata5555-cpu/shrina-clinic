import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  const demo = process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_LOGINS === "1";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#2a1d20] text-[#f4ebe7] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 15%, rgba(224,144,156,0.35), transparent 70%), radial-gradient(50% 45% at 85% 80%, rgba(246,220,206,0.18), transparent 70%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f4ebe7] text-base font-bold text-[#2a1d20]">S</span>
          <span className="text-lg font-semibold tracking-[0.3em]">SHRINA</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-[13px] tracking-[0.25em] text-[#e0b3ba] uppercase">Korean Beauty Aesthetic Clinic</p>
          <h1 className="mt-4 text-[34px] leading-[1.15] font-semibold tracking-tight">
            Every patient, session and rupee — in one calm place.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#d9cbc6]">
            Appointments, treatment packages, billing, inventory, staff and reports across all SHRINA branches.
          </p>
        </div>
        <p className="relative text-xs text-[#b9a8a3]">Internal system · Authorised staff only · All activity is logged</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="text-lg font-semibold tracking-[0.3em] text-ink">SHRINA</span>
            <p className="text-xs text-muted">Clinic Management</p>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 mb-7 text-sm text-muted">Use the account given to you by the clinic owner.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />

          {demo && (
            <div className="mt-8 rounded-xl border border-dashed border-border-strong p-4 text-[12.5px] text-muted">
              <p className="mb-2 font-medium text-ink-2">Demo accounts (password: <code className="text-ink">Shrina@123</code>)</p>
              <ul className="grid grid-cols-1 gap-1">
                {[
                  ["Owner", "owner@shrina.in"],
                  ["Branch manager", "manager@shrina.in"],
                  ["Doctor", "doctor@shrina.in"],
                  ["Receptionist", "reception@shrina.in"],
                  ["Therapist", "therapist@shrina.in"],
                  ["Accounts", "accounts@shrina.in"],
                  ["HR / Admin", "hr@shrina.in"],
                ].map(([r, e]) => (
                  <li key={e} className="flex justify-between gap-2">
                    <span>{r}</span>
                    <code className="text-ink-2">{e}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
