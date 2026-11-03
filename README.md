# SHRINA — Clinic Management & Operations

Internal web application for **SHRINA Korean Beauty Aesthetic Clinic**: patients and their lifetime
treatment history, appointments, treatment packages & sessions, billing with GST, payments, inventory,
expenses, staff attendance & payroll, leads/CRM, reminders, reports — across multiple branches with
role-based access and a full audit trail.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 6 · PostgreSQL
- **Responsive:** desktop, tablet and phone; light & dark mode
- **Developer guide:** [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) (architecture, shared libraries, rules, URL map)

## What's included (mapped to the requirements document)

| Spec § | Module | Where |
|---|---|---|
| 2, 14 | Role-aware dashboard; reports (revenue, patients, staff, business, branches) with date filters, Excel + PDF | `/dashboard`, `/reports` |
| 3, 10, 11 | Patients: permanent IDs, global search (⌘K), duplicate detection & merge, lifetime history by year with filters, consultations, before/after photos with consent & doctor approval, consents, Excel import/export, branch transfer | `/patients` |
| 4 | Treatment catalogue (with product usage per session), packages with auto *Remaining = Total − Completed*, renew / adjust / approve, sessions board | `/treatments`, `/sessions` |
| 5 | Appointments: day (doctor/therapist columns) / week / month / list, conflict detection, full status flow, reschedule; automated reminders | `/appointments`, `/notifications` |
| 6 | GST invoicing (CGST/SGST, SAC/HSN, amount in words), packages & products on invoices, discounts by permission, partial / advance payments, credit notes & refunds, A4 print/PDF, outstanding & ageing, day-end cash summary | `/billing`, `/payments` |
| 7 | Inventory: batches & expiry (FEFO), purchases, suppliers, stock in/out, damage/returns, branch transfers, automatic deduction on treatment, profit & usage reports | `/inventory` |
| 8 | Expenses with receipt upload and approval workflow; opening/closing checklists, maintenance, complaints | `/expenses` |
| 9 | Staff profiles; attendance by PIN kiosk, rotating QR, mobile + optional GPS, manual entry; leave with balances; payroll from attendance with configurable rules and salary slips | `/staff`, `/attendance`, `/leaves`, `/payroll` |
| 12 | Leads pipeline (board + list), enquiry history, follow-ups, conversion to patient, source & conversion reports | `/leads` |
| 13 | Multi-branch: branch switcher, branch-scoped data for every role, consolidated owner view | top bar, `/branches` |
| 15, 16 | RBAC (7 roles + custom, per-user overrides), audit log, soft delete & recycle bin, 2FA, backups, dark mode, mobile layout | `/settings`, `/account` |

### Decisions taken during the build (confirm with the clinic)

- Patient Excel export requires *Export* permission (receptionists can't download the full patient list).
- Medical history entries are add-only (never deleted) for record integrity.
- Treatment and product prices come from the catalogue; discounts are capped at 15 % (configurable) unless the user
  has refund rights or is the owner.
- Invoices can be cancelled only when nothing has been collected (refund first) and no package session was used.
- Approvers' own expenses are auto-approved; staff can edit their expenses until approved.
- Payroll defaults: salary ÷ calendar days, weekly offs paid, 10-min late grace, 3 lates = ½ day, < 7 h = half day,
  overtime after 30 min. All editable in **Payroll → Rules**.
- Undoing a completed session does not return the consumed products to stock (use an inventory adjustment).

### Needs the clinic's input before go-live

- Real branch names, addresses, GSTIN(s), invoice prefix and terms (Settings → Clinic; Branch Management).
- Treatment price list, package rules and product catalogue with per-session usage quantities.
- WhatsApp Business account (Meta) with **approved message templates** for reminders; SMS needs **DLT registration**.
- Hosting decision (see Deployment) and a domain.
- Historical patient data in the import template (Patients → Import) for migration.

## Quick start (local)

Requirements: Node.js 20+, PostgreSQL 15+.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy       # create tables
npm run db:seed                 # optional: realistic demo data (WIPES the database)
npm run dev                     # http://localhost:4600
```

Demo logins (after seeding) — password `Shrina@123`:

| Role | Email |
|---|---|
| Owner / Super Admin | owner@shrina.in |
| Branch Manager (Flagship / City Centre) | manager@shrina.in / manager.cc@shrina.in |
| Doctor (Flagship / City Centre) | doctor@shrina.in / doctor.cc@shrina.in |
| Receptionist | reception@shrina.in |
| Therapist | therapist@shrina.in |
| Accounts | accounts@shrina.in |
| HR / Admin | hr@shrina.in |

Attendance kiosk PIN for every seeded employee: `1234`. The spec's example patient **Priya Sharma**
(mobile 9876543210) has the 2023 → 2026 history from the requirements document.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | 32+ random characters used to sign sessions (`openssl rand -base64 48`) |
| `CRON_SECRET` | Bearer token required by `/api/cron/reminders` |
| `APP_URL` | Public base URL (used in messages and QR codes) |
| `STORAGE_DIR` | Folder for private uploads (photos, consent forms, receipts, backups). Default `./storage` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business Cloud API (Meta). Blank = log-only mode |
| `SMS_PROVIDER_URL`, `SMS_API_KEY` | SMS gateway (e.g. MSG91). Blank = log-only mode |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email via Resend. Blank = log-only mode |
| `PG_DUMP_PATH` | Optional path to `pg_dump` for in-app backups |

When a messaging provider isn't configured, reminders are still generated and recorded in
**Notifications → Message outbox** as *Skipped*, so nothing breaks before integrations are set up.

## Scheduled jobs

Call the reminder engine every 15 minutes (generates due reminders, sends queued messages, expires
overdue packages):

```bash
*/15 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/reminders
15 2 * * *    cd /srv/shrina && ./scripts/backup.sh       # nightly pg_dump, 30-day retention
```

## Deployment (recommended)

Patient data is sensitive health information — keep it in India and encrypted at rest.

1. **Database:** managed PostgreSQL in Mumbai (`ap-south-1`) — e.g. AWS RDS, Neon or Supabase — with automated
   daily backups and point-in-time recovery enabled.
2. **App:** a small VM in Mumbai (AWS Lightsail / EC2, DigitalOcean BLR) running `npm run build && npm start`
   behind Nginx/Caddy with HTTPS, managed by PM2 or systemd. Uploads live in `STORAGE_DIR` on an encrypted
   disk that is backed up nightly. *(Serverless hosts such as Vercel need `src/lib/storage.ts` switched to S3/R2 —
   the module is isolated for exactly this.)*
3. Run `npx prisma migrate deploy` on each release; never `db:seed` in production.
4. Create the real owner account, then deactivate or delete the demo users (or start from an empty database
   and create the owner with `npx tsx scripts/create-owner.ts`).
5. Turn on **Settings → Clinic → Security → Require 2FA** for admin accounts.

## Security model

- Sessions: signed HTTP-only cookies (12 h), versioned so a password change / deactivation signs a user out everywhere.
- Optional TOTP two-factor sign-in (Google/Microsoft Authenticator, Authy); lockout after 5 failed attempts in 15 min.
- **RBAC:** 7 built-in roles + custom roles; per-user grant/revoke overrides; branch-scoped data access.
- Confidential medical notes, before/after photos and consent documents are permission-gated and served only through
  an authenticated file route — never from a public URL.
- Every create / edit / delete / approval / payment / refund / export / sign-in is written to the activity log.
- Records are soft-deleted and restorable from the recycle bin.
