/* SHRINA demo data. Run: npm run db:seed  (wipes and recreates all data) */
import { PrismaClient, Prisma, type PaymentMethod, type LeadSource, type StaffType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLES, ROLE_KEYS } from "../src/lib/permissions";
import { financialYear, istDateKey, fromIst, addDaysKey, weekdayOfKey, dbDate } from "../src/lib/format";

const db = new PrismaClient();

// ── deterministic randomness ──
let seed = 20261103;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p: number) => rnd() < p;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number, w: number) => String(n).padStart(w, "0");

const TODAY = istDateKey();
const at = (dateKey: string, hhmm: string) => fromIst(dateKey, hhmm);
const daysAgoKey = (n: number) => addDaysKey(TODAY, -n);

async function nextSeq(key: string) {
  const c = await db.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return c.value;
}

async function wipe() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

const FIRST_F = ["Priya", "Ananya", "Isha", "Kavya", "Riya", "Sneha", "Pooja", "Neha", "Aditi", "Meera", "Tanvi", "Shruti", "Nidhi", "Simran", "Aishwarya", "Divya", "Komal", "Sakshi", "Ritika", "Anjali", "Zara", "Fatima", "Sana", "Kritika", "Nikita", "Payal", "Radhika", "Swati", "Megha", "Bhavna", "Avni", "Diya", "Kiara", "Tara", "Mira", "Jhanvi", "Ishita", "Trisha", "Natasha", "Gauri"];
const FIRST_M = ["Rahul", "Arjun", "Karan", "Vikram", "Rohan", "Aditya", "Siddharth", "Nikhil", "Aman", "Kabir", "Yash", "Varun"];
const LAST = ["Sharma", "Mehta", "Iyer", "Kapoor", "Reddy", "Nair", "Patel", "Shah", "Joshi", "Desai", "Kulkarni", "Malhotra", "Bose", "Chopra", "Agarwal", "Singh", "Rao", "Menon", "Pillai", "Banerjee", "Khan", "Gupta", "Verma", "Saxena", "Bhatt", "Shetty", "Fernandes", "D'Souza"];
const SOURCES: LeadSource[] = ["INSTAGRAM", "INSTAGRAM", "INSTAGRAM", "GOOGLE", "GOOGLE", "REFERRAL", "REFERRAL", "WALK_IN", "FACEBOOK", "WEBSITE", "WHATSAPP"];
const METHODS: PaymentMethod[] = ["UPI", "UPI", "UPI", "CREDIT_CARD", "DEBIT_CARD", "CASH", "CASH", "BANK_TRANSFER"];
const mobile = () => `${pick(["98", "99", "97", "96", "88", "87", "70", "73", "81", "90"])}${pad(int(0, 99999999), 8)}`;

async function main() {
  console.log("Wiping database…");
  await wipe();

  // ── settings & roles ──
  await db.setting.createMany({
    data: [
      {
        key: "clinic",
        value: {
          clinicName: "SHRINA",
          legalName: "SHRINA Korean Beauty Aesthetic Clinic",
          tagline: "Korean Beauty Aesthetic Clinic",
          phone: "+91 98200 00000",
          email: "hello@shrina.in",
          website: "shrina.in",
          address: "Flagship clinic address (edit in Settings)",
          gstin: "27ABCDE1234F1Z5",
          state: "Maharashtra",
          stateCode: "27",
        },
      },
    ],
  });

  const roles: Record<string, string> = {};
  for (const key of ROLE_KEYS) {
    const r = await db.role.create({ data: { key, ...DEFAULT_ROLES[key] } });
    roles[key] = r.id;
  }

  // ── branches ──
  const flg = await db.branch.create({
    data: { code: "FLG", name: "SHRINA Flagship", city: "Mumbai", address: "Flagship clinic — update address in Branch Management", phone: "+91 98200 00001", email: "flagship@shrina.in", gstin: "27ABCDE1234F1Z5", openTime: "10:00", closeTime: "20:00" },
  });
  const ctc = await db.branch.create({
    data: { code: "CTC", name: "SHRINA City Centre", city: "Mumbai", address: "City Centre clinic — update address in Branch Management", phone: "+91 98200 00002", email: "citycentre@shrina.in", gstin: "27ABCDE1234F1Z5", openTime: "11:00", closeTime: "20:00" },
  });
  const branches = [flg, ctc];

  // ── suppliers ──
  const suppliers = await Promise.all(
    [
      ["K-Derma Distributors", "Hyun Park", "9820011122", "orders@kderma.example"],
      ["MediAesthetic Supplies", "Rakesh Jain", "9833344455", "sales@mediaesthetic.example"],
      ["Clinic Consumables Co.", "Sunita Rao", "9867788990", "hello@ccc.example"],
    ].map(([name, contactPerson, phone, email]) => db.supplier.create({ data: { name, contactPerson, phone, email, gstin: `27AAACK${int(1000, 9999)}Q1Z${int(1, 9)}` } })),
  );

  // ── staff ──
  type S = [string, string, string, StaffType, string, number, string, string, number[]];
  const staffDefs: S[] = [
    ["Dr. Ananya Rao", "Senior Aesthetic Physician", "Medical", "DOCTOR", "FLG", 150000, "10:00", "19:00", [0]],
    ["Dr. Kavya Menon", "Dermatologist", "Medical", "DOCTOR", "FLG", 130000, "11:00", "20:00", [1]],
    ["Dr. Rhea Kapoor", "Aesthetic Physician", "Medical", "DOCTOR", "CTC", 120000, "11:00", "20:00", [0]],
    ["Sunita Pillai", "Senior Therapist", "Therapy", "THERAPIST", "FLG", 32000, "10:00", "19:00", [2]],
    ["Meena Thapa", "Laser Therapist", "Therapy", "THERAPIST", "FLG", 28000, "10:00", "19:00", [3]],
    ["Grace Lalremruati", "Skin Therapist", "Therapy", "THERAPIST", "CTC", 26000, "11:00", "20:00", [4]],
    ["Jyoti Shinde", "Skin Therapist", "Therapy", "THERAPIST", "CTC", 24000, "11:00", "20:00", [1]],
    ["Ritu Nair", "Front Desk Executive", "Front Desk", "RECEPTIONIST", "FLG", 22000, "09:45", "19:00", [0]],
    ["Farah Shaikh", "Front Desk Executive", "Front Desk", "RECEPTIONIST", "CTC", 20000, "10:45", "20:00", [0]],
    ["Vikram Desai", "Branch Manager", "Management", "MANAGER", "FLG", 60000, "10:00", "19:00", [0]],
    ["Neha Kulkarni", "Branch Manager", "Management", "MANAGER", "CTC", 55000, "11:00", "20:00", [0]],
    ["Rajesh Gupta", "Accounts Executive", "Accounts", "ACCOUNTS", "FLG", 35000, "10:00", "18:30", [0]],
    ["Pallavi Joshi", "HR & Admin Executive", "HR / Admin", "HR_ADMIN", "FLG", 30000, "10:00", "18:30", [0]],
    ["Ramesh Yadav", "Housekeeping", "Housekeeping", "SUPPORT", "FLG", 15000, "09:30", "18:30", [0]],
  ];
  const staff: Record<string, Awaited<ReturnType<typeof db.staff.create>>> = {};
  const pinHash = await bcrypt.hash("1234", 8);
  for (const [fullName, designation, department, staffType, bcode, salary, s, e, off] of staffDefs) {
    const n = await nextSeq("staff");
    staff[fullName] = await db.staff.create({
      data: {
        code: `EMP-${pad(n, 3)}`,
        fullName,
        mobile: mobile(),
        email: `${fullName.toLowerCase().replace(/^dr\. /, "").split(" ")[0]}@shrina.in`,
        designation,
        department,
        staffType,
        joiningDate: fromIst(daysAgoKey(int(200, 1400))),
        branchId: bcode === "FLG" ? flg.id : ctc.id,
        monthlySalary: salary,
        shiftStart: s,
        shiftEnd: e,
        weeklyOff: off,
        bankName: pick(["HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "State Bank of India"]),
        bankAccount: `${int(1000, 9999)}${pad(int(0, 99999999), 8)}`,
        ifsc: `${pick(["HDFC", "ICIC", "UTIB", "KKBK", "SBIN"])}000${int(1000, 9999)}`,
        emergencyName: `${pick(FIRST_M)} ${fullName.split(" ").pop()}`,
        emergencyPhone: mobile(),
        attendancePinHash: pinHash,
        qrToken: `qr_${Math.random().toString(36).slice(2, 12)}`,
      },
    });
  }
  const doctorsBy = { FLG: [staff["Dr. Ananya Rao"]!, staff["Dr. Kavya Menon"]!], CTC: [staff["Dr. Rhea Kapoor"]!] };
  const therapistsBy = { FLG: [staff["Sunita Pillai"]!, staff["Meena Thapa"]!], CTC: [staff["Grace Lalremruati"]!, staff["Jyoti Shinde"]!] };

  // ── users (one per role) ──
  const pw = await bcrypt.hash("Shrina@123", 10);
  const mkUser = (name: string, email: string, role: string, opts: Partial<Prisma.UserUncheckedCreateInput> = {}) =>
    db.user.create({ data: { name, email, passwordHash: pw, roleId: roles[role]!, ...opts } });
  const owner = await mkUser("Shrina Owner", "owner@shrina.in", "OWNER", { allBranches: true, branchId: flg.id, phone: "9820000000" });
  const manager = await mkUser("Vikram Desai", "manager@shrina.in", "BRANCH_MANAGER", { branchId: flg.id, staffId: staff["Vikram Desai"]!.id });
  await mkUser("Neha Kulkarni", "manager.cc@shrina.in", "BRANCH_MANAGER", { branchId: ctc.id, staffId: staff["Neha Kulkarni"]!.id });
  const doctorUser = await mkUser("Dr. Ananya Rao", "doctor@shrina.in", "DOCTOR", { branchId: flg.id, extraBranchIds: [ctc.id], staffId: staff["Dr. Ananya Rao"]!.id });
  await mkUser("Dr. Rhea Kapoor", "doctor.cc@shrina.in", "DOCTOR", { branchId: ctc.id, staffId: staff["Dr. Rhea Kapoor"]!.id });
  const reception = await mkUser("Ritu Nair", "reception@shrina.in", "RECEPTIONIST", { branchId: flg.id, staffId: staff["Ritu Nair"]!.id });
  await mkUser("Sunita Pillai", "therapist@shrina.in", "THERAPIST", { branchId: flg.id, staffId: staff["Sunita Pillai"]!.id });
  await mkUser("Rajesh Gupta", "accounts@shrina.in", "ACCOUNTS", { branchId: flg.id, extraBranchIds: [ctc.id], staffId: staff["Rajesh Gupta"]!.id });
  await mkUser("Pallavi Joshi", "hr@shrina.in", "HR_ADMIN", { branchId: flg.id, extraBranchIds: [ctc.id], staffId: staff["Pallavi Joshi"]!.id });
  const writers = [owner.id, manager.id, reception.id, doctorUser.id];

  // ── products ──
  type P = [string, string, string, string, number, number, number, boolean, number];
  const productDefs: P[] = [
    ["Hyaluronic Acid Booster Serum", "Serum", "K-Derma", "ml", 18, 0, 200, false, 0],
    ["Vitamin C Brightening Serum", "Serum", "K-Derma", "ml", 22, 0, 150, false, 1],
    ["HydraFacial Tip Set (disposable)", "Consumable", "HydraTech", "pcs", 350, 0, 20, false, 1],
    ["Laser Cooling Gel", "Consumable", "MediCool", "ml", 1.2, 0, 2000, false, 2],
    ["Glycolic Peel Solution 35%", "Peel", "DermaPeel", "ml", 45, 0, 60, false, 0],
    ["Carbon Peel Lotion", "Peel", "K-Derma", "ml", 30, 0, 80, false, 0],
    ["PRP Kit", "Consumable", "RegenKit", "pcs", 1200, 0, 10, false, 1],
    ["Microneedling Cartridge 12-pin", "Consumable", "DermaPen", "pcs", 450, 0, 15, false, 2],
    ["Rejuran Healer 2ml", "Injectable", "Rejuran", "pcs", 9500, 0, 4, false, 0],
    ["Botulinum Toxin 100U", "Injectable", "Allergan", "pcs", 11000, 0, 3, false, 1],
    ["HA Dermal Filler 1ml", "Injectable", "Juvederm", "pcs", 13500, 0, 3, false, 1],
    ["Centella Calming Sheet Mask", "Retail", "SHRINA Skin", "pcs", 90, 250, 40, true, 2],
    ["Daily Sunscreen SPF 50+ PA++++", "Retail", "SHRINA Skin", "pcs", 420, 1150, 15, true, 0],
    ["Ceramide Barrier Moisturiser", "Retail", "SHRINA Skin", "pcs", 520, 1450, 12, true, 0],
    ["Gentle Low-pH Cleanser", "Retail", "SHRINA Skin", "pcs", 280, 850, 15, true, 2],
    ["Niacinamide 10% Serum (retail)", "Retail", "SHRINA Skin", "pcs", 480, 1350, 10, true, 0],
    ["Nitrile Gloves (box of 100)", "Clinic Supplies", "SafeHands", "pcs", 380, 0, 5, false, 2],
  ];
  const products: Record<string, Awaited<ReturnType<typeof db.product.create>>> = {};
  for (const [name, category, brand, unit, cost, sell, min, retail, sup] of productDefs) {
    const n = await nextSeq("product");
    products[name] = await db.product.create({
      data: {
        sku: `PRD-${pad(n, 4)}`,
        name,
        category,
        brand,
        unit,
        purchasePrice: cost,
        sellingPrice: sell || r2(cost * 2.2),
        gstRate: 18,
        hsnCode: retail ? "3304" : "3004",
        minStock: min,
        isRetail: retail,
        supplierId: suppliers[sup]!.id,
      },
    });
  }

  // stock: purchases per branch
  for (const b of branches) {
    const n = await nextSeq("purchase");
    const items = Object.values(products).map((p) => {
      const min = Number(p.minStock);
      const low = chance(0.18);
      const qty = low ? Math.max(1, Math.round(min * 0.6)) : Math.round(min * (2 + rnd() * 3)) || 10;
      const nearExpiry = chance(0.12);
      return {
        productId: p.id,
        batchNo: `B${int(2301, 2612)}-${int(10, 99)}`,
        expiryDate: fromIst(addDaysKey(TODAY, nearExpiry ? int(10, 55) : int(180, 720))),
        quantity: qty,
        unitCost: Number(p.purchasePrice),
      };
    });
    const total = r2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0));
    const purchase = await db.purchase.create({
      data: {
        number: `PUR-${pad(n, 5)}`,
        supplierId: suppliers[0]!.id,
        branchId: b.id,
        billNo: `INV-${int(10000, 99999)}`,
        purchaseDate: fromIst(daysAgoKey(40)),
        totalAmount: total,
        createdById: owner.id,
        items: { create: items },
      },
    });
    for (const it of items) {
      const batch = await db.productBatch.create({
        data: { productId: it.productId, branchId: b.id, batchNo: it.batchNo, expiryDate: it.expiryDate, purchaseDate: fromIst(daysAgoKey(40)), quantity: it.quantity, initialQty: it.quantity, purchasePrice: it.unitCost, supplierId: suppliers[0]!.id },
      });
      await db.inventoryTransaction.create({
        data: { productId: it.productId, branchId: b.id, batchId: batch.id, type: "PURCHASE", quantity: it.quantity, unitCost: it.unitCost, refType: "Purchase", refId: purchase.id, createdById: owner.id, createdAt: fromIst(daysAgoKey(40), "12:00") },
      });
    }
  }

  // ── treatments ──
  type T = [string, string, number, number, number, number, number];
  const treatmentDefs: T[] = [
    ["Doctor Consultation", "Consultation", 1000, 1, 0, 30, 30],
    ["Hydra Facial", "Facial", 4500, 1, 30, 60, 90],
    ["Hydra Luxe Facial", "Facial", 6500, 1, 30, 75, 90],
    ["Korean Glass Skin Facial", "Facial", 5500, 1, 30, 75, 90],
    ["Laser Hair Reduction – Full Body", "Laser", 12000, 6, 45, 120, 365],
    ["Laser Hair Reduction – Underarms", "Laser", 2500, 6, 30, 20, 365],
    ["Laser Hair Reduction – Face", "Laser", 3000, 6, 30, 30, 365],
    ["Chemical Peel", "Peel", 3500, 4, 21, 45, 180],
    ["Carbon Laser Peel", "Peel", 4000, 4, 21, 45, 180],
    ["Microneedling with PRP", "Skin Boosters", 7000, 4, 30, 60, 240],
    ["Rejuran Skin Healer", "Skin Boosters", 22000, 3, 30, 45, 180],
    ["Anti-wrinkle Injection (Botox)", "Injectables", 15000, 1, 120, 30, 180],
    ["Dermal Fillers", "Injectables", 25000, 1, 180, 45, 365],
    ["Q-Switch Pigmentation Laser", "Laser", 5000, 6, 21, 30, 240],
    ["Hair PRP Therapy", "Hair", 6000, 4, 30, 60, 240],
    ["Acne Scar Revision", "Skin Boosters", 6000, 4, 30, 60, 240],
  ];
  const treatments: Record<string, Awaited<ReturnType<typeof db.treatment.create>>> = {};
  for (const [name, category, price, sessions, gap, dur, validity] of treatmentDefs) {
    treatments[name] = await db.treatment.create({
      data: { name, category, defaultPrice: price, defaultSessions: sessions, sessionGapDays: gap || 30, durationMins: dur, validityDays: validity, gstRate: 18 },
    });
  }
  const usage: [string, string, number][] = [
    ["Hydra Facial", "Hyaluronic Acid Booster Serum", 5],
    ["Hydra Facial", "HydraFacial Tip Set (disposable)", 1],
    ["Hydra Luxe Facial", "Hyaluronic Acid Booster Serum", 6],
    ["Hydra Luxe Facial", "Vitamin C Brightening Serum", 3],
    ["Hydra Luxe Facial", "HydraFacial Tip Set (disposable)", 1],
    ["Korean Glass Skin Facial", "Hyaluronic Acid Booster Serum", 4],
    ["Korean Glass Skin Facial", "Centella Calming Sheet Mask", 1],
    ["Laser Hair Reduction – Full Body", "Laser Cooling Gel", 60],
    ["Laser Hair Reduction – Underarms", "Laser Cooling Gel", 10],
    ["Laser Hair Reduction – Face", "Laser Cooling Gel", 12],
    ["Chemical Peel", "Glycolic Peel Solution 35%", 3],
    ["Carbon Laser Peel", "Carbon Peel Lotion", 4],
    ["Microneedling with PRP", "PRP Kit", 1],
    ["Microneedling with PRP", "Microneedling Cartridge 12-pin", 1],
    ["Hair PRP Therapy", "PRP Kit", 1],
    ["Rejuran Skin Healer", "Rejuran Healer 2ml", 1],
    ["Anti-wrinkle Injection (Botox)", "Botulinum Toxin 100U", 0.5],
    ["Dermal Fillers", "HA Dermal Filler 1ml", 1],
    ["Acne Scar Revision", "Microneedling Cartridge 12-pin", 1],
  ];
  for (const [t, p, q] of usage) await db.treatmentProductUsage.create({ data: { treatmentId: treatments[t]!.id, productId: products[p]!.id, quantity: q } });

  // ── reminder rules ──
  await db.reminderRule.createMany({
    data: [
      { key: "APPOINTMENT_24H", name: "Appointment reminder – 24 hours before", offsetMinutes: -1440, channels: ["WHATSAPP"], template: "Hi {{name}}, this is a reminder of your {{treatment}} appointment at {{branch}} tomorrow at {{time}}. Reply to reschedule. – SHRINA" },
      { key: "APPOINTMENT_2H", name: "Appointment reminder – 2 hours before", offsetMinutes: -120, channels: ["WHATSAPP", "SMS"], template: "Hi {{name}}, see you at {{time}} today at {{branch}} for your {{treatment}}. – SHRINA" },
      { key: "SESSION_UPCOMING", name: "Upcoming package session (laser etc.)", offsetMinutes: -2880, channels: ["WHATSAPP"], template: "Hi {{name}}, your session {{session}} of {{package}} is due on {{date}}. Book your slot with us. – SHRINA" },
      { key: "FOLLOW_UP", name: "Pending treatment follow-up", offsetMinutes: 0, channels: ["WHATSAPP"], template: "Hi {{name}}, Dr. {{doctor}} recommended a follow-up around {{date}}. Shall we book it for you? – SHRINA" },
      { key: "PACKAGE_EXPIRY", name: "Package expiry reminder", offsetMinutes: -10080, channels: ["WHATSAPP", "EMAIL"], template: "Hi {{name}}, your {{package}} package expires on {{date}} with {{remaining}} session(s) left. Book soon so you don't miss out. – SHRINA" },
      { key: "PRODUCT_REORDER", name: "Product reorder alert (staff)", offsetMinutes: 0, channels: ["EMAIL"], template: "Low stock: {{product}} at {{branch}} — {{stock}} left (minimum {{min}})." },
      { key: "POST_TREATMENT", name: "Post-treatment care follow-up", offsetMinutes: 1440, channels: ["WHATSAPP"], template: "Hi {{name}}, hope you're feeling great after your {{treatment}} yesterday. Remember to follow your home-care routine and use sunscreen. Any questions? Just reply. – SHRINA" },
    ],
  });

  // ── patients & clinical / billing history ──
  console.log("Creating patients, packages, sessions, invoices…");
  const branchCode = (id: string) => (id === flg.id ? "FLG" : "CTC");
  let apptCountToday = 0;

  async function invoiceFor(o: {
    patientId: string;
    branchId: string;
    date: Date;
    lines: { kind: "TREATMENT" | "PACKAGE" | "PRODUCT" | "CONSULTATION"; description: string; qty: number; price: number; discount?: number; treatmentId?: string; productId?: string; packageId?: string }[];
    payRatio: number;
    userId: string;
  }) {
    const lines = o.lines.map((l) => {
      const gross = r2(l.qty * l.price);
      const taxable = r2(gross - (l.discount ?? 0));
      const tax = r2(taxable * 0.18);
      return { ...l, gross, taxable, tax, total: r2(taxable + tax) };
    });
    const subtotal = r2(lines.reduce((s, l) => s + l.gross, 0));
    const discountTotal = r2(lines.reduce((s, l) => s + (l.discount ?? 0), 0));
    const taxable = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const tax = r2(lines.reduce((s, l) => s + l.tax, 0));
    const exact = r2(taxable + tax);
    const total = Math.round(exact);
    const paid = o.payRatio >= 1 ? total : Math.round(total * o.payRatio);
    const code = branchCode(o.branchId);
    const fy = financialYear(o.date).replace("-", "");
    const n = await nextSeq(`invoice:${code}:${fy}`);
    const inv = await db.invoice.create({
      data: {
        number: `${code}/${fy}/${pad(n, 4)}`,
        branchId: o.branchId,
        patientId: o.patientId,
        date: o.date,
        subtotal,
        discountTotal,
        taxableAmount: taxable,
        cgst: r2(tax / 2),
        sgst: r2(tax - r2(tax / 2)),
        taxTotal: tax,
        roundOff: r2(total - exact),
        total,
        paidAmount: paid,
        balance: r2(total - paid),
        status: paid >= total ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID",
        createdById: o.userId,
        createdAt: o.date,
        items: {
          create: lines.map((l) => ({
            kind: l.kind,
            description: l.description,
            treatmentId: l.treatmentId,
            productId: l.productId,
            packageId: l.packageId,
            hsnSac: l.kind === "PRODUCT" ? "3304" : "999722",
            quantity: l.qty,
            unitPrice: l.price,
            discount: l.discount ?? 0,
            gstRate: 18,
            taxable: l.taxable,
            tax: l.tax,
            total: l.total,
          })),
        },
      },
    });
    if (paid > 0) {
      const rn = await nextSeq(`receipt:${code}`);
      await db.payment.create({
        data: { receiptNo: `RC-${code}-${pad(rn, 6)}`, invoiceId: inv.id, patientId: o.patientId, branchId: o.branchId, amount: paid, method: pick(METHODS), reference: chance(0.5) ? `UTR${int(100000000, 999999999)}` : null, paidAt: o.date, receivedById: o.userId, createdAt: o.date },
      });
    }
    return inv;
  }

  async function course(p: { id: string; branchId: string }, tName: string, startKey: string, opts: { bodyArea?: string; sessions?: number; doctorId: string; therapistId: string; forceCompleted?: number }) {
    const t = treatments[tName]!;
    const totalSessions = opts.sessions ?? t.defaultSessions;
    const unit = Number(t.defaultPrice);
    const price = totalSessions > 1 ? Math.round((unit * totalSessions * (totalSessions >= 6 ? 0.8 : 0.9)) / 100) * 100 : unit;
    const purchaseDate = at(startKey, `${int(11, 18)}:${pick(["00", "15", "30", "45"])}`);
    const n = await nextSeq("package");
    const pkg = await db.treatmentPackage.create({
      data: {
        code: `PKG-${pad(n, 6)}`,
        patientId: p.id,
        treatmentId: t.id,
        branchId: p.branchId,
        name: `${tName}${opts.bodyArea && !tName.includes(opts.bodyArea) ? ` – ${opts.bodyArea}` : ""}${totalSessions > 1 ? ` · ${totalSessions} sessions` : ""}`,
        bodyArea: opts.bodyArea,
        totalSessions,
        price,
        purchaseDate,
        expiryDate: new Date(purchaseDate.getTime() + t.validityDays * 86400000),
        doctorId: opts.doctorId,
        therapistId: opts.therapistId,
        createdById: pick(writers),
        createdAt: purchaseDate,
      },
    });
    const discount = chance(0.3) ? Math.round(price * pick([0.05, 0.1])) : 0;
    await invoiceFor({
      patientId: p.id,
      branchId: p.branchId,
      date: purchaseDate,
      lines: [{ kind: totalSessions > 1 ? "PACKAGE" : "TREATMENT", description: pkg.name, qty: 1, price, discount, treatmentId: t.id, packageId: pkg.id }],
      payRatio: chance(0.78) ? 1 : pick([0.5, 0.6, 0.4]),
      userId: pick(writers),
    });

    let completed = 0;
    let key = startKey;
    const notes = ["Tolerated well, mild erythema resolved in 20 min.", "Good response; advised SPF 50 and no actives for 48h.", "Slight sensitivity on cheeks — reduced intensity.", "Visible improvement in texture since last session.", "Patient comfortable; no adverse reaction.", "Hair density reduced ~40% vs baseline."];
    for (let s = 1; s <= totalSessions; s++) {
      const due = key;
      const isPast = due < TODAY;
      if (opts.forceCompleted !== undefined ? s <= opts.forceCompleted : isPast) {
        const missed = chance(0.06);
        const when = at(due, `${int(11, 18)}:${pick(["00", "30"])}`);
        const appt = await db.appointment.create({
          data: { patientId: p.id, branchId: p.branchId, treatmentId: t.id, packageId: pkg.id, doctorId: opts.doctorId, therapistId: opts.therapistId, startAt: when, endAt: new Date(when.getTime() + t.durationMins * 60000), status: missed ? "NO_SHOW" : "COMPLETED", source: "PHONE", completedAt: missed ? null : when, createdAt: new Date(when.getTime() - 3 * 86400000), createdById: pick(writers) },
        });
        if (missed) {
          await db.treatmentSession.create({ data: { packageId: pkg.id, patientId: p.id, treatmentId: t.id, branchId: p.branchId, appointmentId: appt.id, scheduledAt: when, status: "MISSED", therapistId: opts.therapistId, notes: "Patient did not show up." } });
          key = addDaysKey(key, 7);
          s--;
          continue;
        }
        completed++;
        await db.treatmentSession.create({
          data: { packageId: pkg.id, patientId: p.id, treatmentId: t.id, branchId: p.branchId, appointmentId: appt.id, sessionNumber: completed, scheduledAt: when, performedAt: when, status: "COMPLETED", doctorId: opts.doctorId, therapistId: opts.therapistId, observations: pick(notes), stockDeducted: true, approvedById: chance(0.5) ? doctorUser.id : null, approvedAt: chance(0.5) ? when : null, createdAt: when },
        });
        await db.patient.update({ where: { id: p.id }, data: { lastVisitAt: when } });
        key = addDaysKey(key, t.sessionGapDays + int(-3, 6));
      } else {
        // next upcoming session gets an appointment (sometimes today)
        let upKey = due < TODAY ? addDaysKey(TODAY, int(0, 12)) : due;
        if (apptCountToday < 14 && chance(0.25)) upKey = TODAY;
        const hh = int(Number((p.branchId === flg.id ? flg : ctc).openTime.slice(0, 2)), 18);
        const when = at(upKey, `${pad(hh, 2)}:${pick(["00", "30"])}`);
        const isToday = upKey === TODAY;
        if (isToday) apptCountToday++;
        const st = isToday ? pick(["BOOKED", "CONFIRMED", "CONFIRMED", "CHECKED_IN", "IN_TREATMENT", "COMPLETED"] as const) : pick(["BOOKED", "CONFIRMED"] as const);
        const appt = await db.appointment.create({
          data: { patientId: p.id, branchId: p.branchId, treatmentId: t.id, packageId: pkg.id, doctorId: opts.doctorId, therapistId: opts.therapistId, startAt: when, endAt: new Date(when.getTime() + t.durationMins * 60000), status: st === "COMPLETED" ? "CONFIRMED" : st, source: pick(["PHONE", "WHATSAPP", "INSTAGRAM", "WALK_IN"] as const), checkedInAt: st === "CHECKED_IN" || st === "IN_TREATMENT" ? when : null, createdById: pick(writers) },
        });
        await db.treatmentSession.create({ data: { packageId: pkg.id, patientId: p.id, treatmentId: t.id, branchId: p.branchId, appointmentId: appt.id, scheduledAt: when, status: "SCHEDULED", doctorId: opts.doctorId, therapistId: opts.therapistId } });
        break;
      }
    }
    const status = completed >= totalSessions ? "COMPLETED" : pkg.expiryDate! < new Date() ? "EXPIRED" : "ACTIVE";
    await db.treatmentPackage.update({ where: { id: pkg.id }, data: { completedSessions: completed, status } });
    return pkg;
  }

  async function consult(p: { id: string; branchId: string }, doctorId: string, dateKey: string, rec: string, extra: Partial<Prisma.ConsultationUncheckedCreateInput> = {}) {
    await db.consultation.create({
      data: {
        patientId: p.id,
        branchId: p.branchId,
        doctorId,
        consultationDate: at(dateKey, "11:30"),
        complaint: pick(["Dull skin and uneven tone", "Unwanted body hair", "Pigmentation on cheeks", "Acne scars on cheeks", "Fine lines around eyes", "Hair thinning at crown", "Open pores and oiliness", "Dehydrated skin, wants glass-skin glow"]),
        skinAssessment: pick(["Fitzpatrick III, mild PIH, good barrier", "Fitzpatrick IV, oily T-zone, enlarged pores", "Fitzpatrick III, dehydrated, fine lines", "Fitzpatrick IV, rolling acne scars grade 2", "Fitzpatrick II, sensitive, mild rosacea"]),
        skinType: pick(["Combination", "Oily", "Dry", "Sensitive", "Normal"]),
        treatmentRecommended: rec,
        productsRecommended: pick(["Daily Sunscreen SPF 50+, Ceramide Barrier Moisturiser", "Gentle Low-pH Cleanser, Niacinamide 10% Serum", "Daily Sunscreen SPF 50+, Centella Calming Sheet Mask (2/week)"]),
        homeCare: "Avoid sun exposure and actives (retinol/AHA) for 48 hours. Use SPF 50 every 3 hours outdoors.",
        doctorNotes: pick(["No contraindications. Patient counselled on realistic outcomes.", "History of mild sensitivity to fragrance — use fragrance-free post-care.", "Discussed combination plan; patient prefers gradual approach.", "On oral contraceptives — monitor for pigmentation."]),
        followUpDate: chance(0.6) ? fromIst(addDaysKey(dateKey, int(20, 45))) : null,
        createdAt: at(dateKey, "11:30"),
        ...extra,
      },
    });
  }

  // Priya Sharma — the spec's example lifetime history
  {
    const n = await nextSeq("patient");
    const priya = await db.patient.create({
      data: {
        code: `SHR-${pad(n, 6)}`, fullName: "Priya Sharma", mobile: "9876543210", email: "priya.sharma@example.com", dob: fromIst("1994-06-18"), gender: "FEMALE",
        address: "Bandra West, Mumbai", city: "Mumbai", registeredAt: at("2023-02-14", "11:00"), firstVisitAt: at("2023-02-14", "11:00"), source: "INSTAGRAM",
        assignedDoctorId: doctorsBy.FLG[0]!.id, branchId: flg.id, skinType: "Combination", allergies: "None known", medicalHistory: "Mild PCOS (managed). No history of keloids.",
        notes: "Prefers weekend evening slots. Loyal patient since 2023.", marketingConsent: true, createdById: reception.id, createdAt: at("2023-02-14", "11:00"),
      },
    });
    const p = { id: priya.id, branchId: flg.id };
    const d = doctorsBy.FLG[0]!.id, th = therapistsBy.FLG[0]!.id, laser = therapistsBy.FLG[1]!.id;
    await consult(p, d, "2023-02-14", "Hydra Facial for hydration; review in 4–6 weeks");
    await course(p, "Hydra Facial", "2023-02-14", { doctorId: d, therapistId: th });
    await consult(p, d, "2024-03-09", "Laser Hair Reduction – Full Body, 6 sessions");
    await course(p, "Laser Hair Reduction – Full Body", "2024-03-09", { doctorId: d, therapistId: laser, bodyArea: "Full Body", forceCompleted: 6 });
    await consult(p, d, "2025-01-20", "Chemical Peel ×4 for PIH on cheeks");
    await course(p, "Chemical Peel", "2025-01-20", { doctorId: d, therapistId: th, forceCompleted: 4 });
    await consult(p, d, "2026-09-12", "Hydra Luxe Facial monthly for glow maintenance");
    await course(p, "Hydra Luxe Facial", "2026-09-12", { doctorId: d, therapistId: th, sessions: 3, forceCompleted: 2 });
    await db.medicalHistoryEntry.createMany({
      data: [
        { patientId: priya.id, category: "CONDITION", description: "PCOS — on lifestyle management, no medication", recordedById: doctorUser.id, recordedAt: at("2023-02-14", "11:30") },
        { patientId: priya.id, category: "PROCEDURE", description: "No prior laser or injectable procedures before SHRINA", recordedById: doctorUser.id, recordedAt: at("2023-02-14", "11:30") },
      ],
    });
    await db.consentRecord.createMany({
      data: [
        { patientId: priya.id, type: "TREATMENT", signedAt: at("2023-02-14", "11:10"), notes: "General treatment consent signed", recordedById: reception.id },
        { patientId: priya.id, type: "PHOTO_CLINICAL", signedAt: at("2024-03-09", "12:00"), notes: "Clinical before/after photos allowed", recordedById: reception.id },
      ],
    });
  }

  const allPatients: { id: string; branchId: string; name: string; mobile: string }[] = [];
  for (let i = 0; i < 72; i++) {
    const female = chance(0.82);
    const fullName = `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
    const branch = chance(0.6) ? flg : ctc;
    const bk = branch.id === flg.id ? "FLG" : "CTC";
    const regKey = daysAgoKey(int(5, 1000));
    const n = await nextSeq("patient");
    const mob = mobile();
    const pat = await db.patient.create({
      data: {
        code: `SHR-${pad(n, 6)}`, fullName, mobile: mob, email: chance(0.7) ? `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}${int(1, 99)}@example.com` : null,
        dob: fromIst(`${int(1972, 2005)}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`), gender: female ? "FEMALE" : "MALE",
        address: `${pick(["Andheri West", "Juhu", "Powai", "Khar", "Worli", "Lower Parel", "Chembur", "Thane West", "Goregaon East", "Malad West"])}, Mumbai`, city: "Mumbai",
        registeredAt: at(regKey, "12:00"), firstVisitAt: at(regKey, "12:00"), source: pick(SOURCES), referredBy: null,
        assignedDoctorId: pick(doctorsBy[bk]).id, branchId: branch.id, skinType: pick(["Combination", "Oily", "Dry", "Sensitive", "Normal", "Acne-prone"]),
        allergies: chance(0.15) ? pick(["Lidocaine sensitivity", "Fragrance", "Sulfa drugs", "Latex"]) : null,
        medicalHistory: chance(0.25) ? pick(["Hypothyroidism (on thyroxine)", "Mild asthma", "History of cold sores", "Isotretinoin course completed 2024"]) : null,
        marketingConsent: chance(0.6), createdById: pick(writers), createdAt: at(regKey, "12:00"),
      },
    });
    const p = { id: pat.id, branchId: branch.id };
    allPatients.push({ ...p, name: fullName, mobile: mob });
    const doc = pick(doctorsBy[bk]).id;
    const th = pick(therapistsBy[bk]).id;
    const choices = female
      ? ["Hydra Facial", "Hydra Luxe Facial", "Korean Glass Skin Facial", "Laser Hair Reduction – Full Body", "Laser Hair Reduction – Underarms", "Laser Hair Reduction – Face", "Chemical Peel", "Carbon Laser Peel", "Microneedling with PRP", "Rejuran Skin Healer", "Anti-wrinkle Injection (Botox)", "Q-Switch Pigmentation Laser", "Acne Scar Revision", "Dermal Fillers"]
      : ["Hair PRP Therapy", "Carbon Laser Peel", "Acne Scar Revision", "Hydra Facial", "Laser Hair Reduction – Face", "Q-Switch Pigmentation Laser"];
    const courses = int(1, 3);
    let key = regKey;
    for (let c = 0; c < courses && key < TODAY; c++) {
      const tn = pick(choices);
      await consult(p, doc, key, tn);
      await course(p, tn, key, { doctorId: doc, therapistId: th, bodyArea: tn.includes("Full Body") ? "Full Body" : tn.includes("Underarms") ? "Underarms" : tn.includes("Face") && tn.includes("Laser") ? "Face" : undefined });
      // occasional product purchase
      if (chance(0.35)) {
        const prods = Object.values(products).filter((x) => x.isRetail);
        const pr = pick(prods);
        await invoiceFor({ patientId: p.id, branchId: p.branchId, date: at(key, "17:30"), lines: [{ kind: "PRODUCT", description: pr.name, qty: int(1, 2), price: Number(pr.sellingPrice), productId: pr.id }], payRatio: 1, userId: pick(writers) });
      }
      key = addDaysKey(key, int(90, 320));
    }
  }

  // ── day-to-day walk-in visits over the last 30 days (single-session treatments + retail) ──
  {
    const single = ["Hydra Facial", "Hydra Luxe Facial", "Korean Glass Skin Facial", "Doctor Consultation", "Carbon Laser Peel", "Anti-wrinkle Injection (Botox)", "Chemical Peel"];
    const retail = Object.values(products).filter((x) => x.isRetail);
    const nowIst = new Date();
    for (let d = 30; d >= 0; d--) {
      const k = daysAgoKey(d);
      const visits = d === 0 ? 4 : int(3, 8);
      for (let v = 0; v < visits; v++) {
        const p = pick(allPatients);
        const bk = p.branchId === flg.id ? "FLG" : "CTC";
        const tn = pick(single);
        const t = treatments[tn]!;
        const when = at(k, `${pad(int(11, 18), 2)}:${pick(["00", "15", "30", "45"])}`);
        if (when > nowIst) continue;
        const doctorId = pick(doctorsBy[bk]).id;
        const therapistId = tn === "Doctor Consultation" ? null : pick(therapistsBy[bk]).id;
        const appt = await db.appointment.create({
          data: { patientId: p.id, branchId: p.branchId, treatmentId: t.id, doctorId, therapistId, startAt: when, endAt: new Date(when.getTime() + t.durationMins * 60000), status: "COMPLETED", completedAt: when, source: pick(["PHONE", "WALK_IN", "WHATSAPP", "INSTAGRAM"] as const), createdById: pick(writers), createdAt: new Date(when.getTime() - 86400000) },
        });
        await db.treatmentSession.create({ data: { patientId: p.id, treatmentId: t.id, branchId: p.branchId, appointmentId: appt.id, sessionNumber: 1, scheduledAt: when, performedAt: when, status: "COMPLETED", doctorId, therapistId, observations: "Single session — no adverse reaction.", stockDeducted: true } });
        const lines: Parameters<typeof invoiceFor>[0]["lines"] = [{ kind: tn === "Doctor Consultation" ? "CONSULTATION" : "TREATMENT", description: tn, qty: 1, price: Number(t.defaultPrice), treatmentId: t.id }];
        if (chance(0.3)) {
          const pr = pick(retail);
          lines.push({ kind: "PRODUCT", description: pr.name, qty: 1, price: Number(pr.sellingPrice), productId: pr.id });
        }
        await invoiceFor({ patientId: p.id, branchId: p.branchId, date: when, lines, payRatio: chance(0.9) ? 1 : 0.5, userId: pick(writers) });
        await db.patient.update({ where: { id: p.id }, data: { lastVisitAt: when } });
      }
    }
  }
  // stock movements for everything since the opening purchase (40 days ago): retail sales + treatment usage,
  // so inventory history, product-profit and treatment-usage reports reflect real activity.
  {
    const since = fromIst(daysAgoKey(39));
    const takeFromBatch = async (productId: string, branchId: string, qty: number, type: "SALE" | "TREATMENT_USAGE", refType: string, refId: string, when: Date, unitPrice?: number) => {
      const batch = await db.productBatch.findFirst({ where: { productId, branchId, quantity: { gte: qty } }, orderBy: [{ expiryDate: "asc" }] });
      if (!batch) return;
      await db.productBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: qty } } });
      await db.inventoryTransaction.create({ data: { productId, branchId, batchId: batch.id, type, quantity: -qty, unitCost: batch.purchasePrice, unitPrice: unitPrice ?? null, refType, refId, createdById: owner.id, createdAt: when } });
    };
    const saleItems = await db.invoiceItem.findMany({ where: { kind: "PRODUCT", productId: { not: null }, invoice: { date: { gte: since } } }, include: { invoice: true } });
    for (const it of saleItems) await takeFromBatch(it.productId!, it.invoice.branchId, Number(it.quantity), "SALE", "Invoice", it.invoiceId, it.invoice.date, Number(it.unitPrice));
    const usages = await db.treatmentProductUsage.findMany();
    const done = await db.treatmentSession.findMany({ where: { status: "COMPLETED", performedAt: { gte: since } } });
    for (const s of done) {
      for (const u of usages.filter((x) => x.treatmentId === s.treatmentId)) {
        await takeFromBatch(u.productId, s.branchId, Number(u.quantity), "TREATMENT_USAGE", "Session", s.id, s.performedAt!);
      }
    }
  }

  // make a few consumables genuinely low in both branches (drives low-stock alerts)
  for (const name of ["PRP Kit", "Rejuran Healer 2ml", "Daily Sunscreen SPF 50+ PA++++"]) {
    const prod = products[name]!;
    const batches = await db.productBatch.findMany({ where: { productId: prod.id } });
    for (const b of batches) {
      const keep = Math.max(1, Math.floor(Number(prod.minStock) * 0.4));
      const used = Number(b.quantity) - keep;
      if (used <= 0) continue;
      await db.productBatch.update({ where: { id: b.id }, data: { quantity: keep } });
      await db.inventoryTransaction.create({ data: { productId: prod.id, branchId: b.branchId, batchId: b.id, type: "TREATMENT_USAGE", quantity: -used, unitCost: b.purchasePrice, refType: "Seed", notes: "Usage over the last weeks", createdById: owner.id, createdAt: at(daysAgoKey(int(1, 20)), "15:00") } });
    }
  }

  // a few brand-new patients registered today (new patients today)
  for (let i = 0; i < 3; i++) {
    const n = await nextSeq("patient");
    const fullName = `${pick(FIRST_F)} ${pick(LAST)}`;
    const branch = i === 2 ? ctc : flg;
    const pat = await db.patient.create({
      data: { code: `SHR-${pad(n, 6)}`, fullName, mobile: mobile(), gender: "FEMALE", source: pick(SOURCES), branchId: branch.id, registeredAt: at(TODAY, `${10 + i}:15`), assignedDoctorId: pick(doctorsBy[branch.id === flg.id ? "FLG" : "CTC"]).id, createdById: reception.id, createdAt: at(TODAY, `${10 + i}:15`) },
    });
    const when = at(TODAY, `${12 + i * 2}:00`);
    await db.appointment.create({
      data: { patientId: pat.id, branchId: branch.id, treatmentId: treatments["Doctor Consultation"]!.id, doctorId: pick(doctorsBy[branch.id === flg.id ? "FLG" : "CTC"]).id, startAt: when, endAt: new Date(when.getTime() + 30 * 60000), status: i === 0 ? "COMPLETED" : "CONFIRMED", source: "INSTAGRAM", notes: "First consultation", createdById: reception.id },
    });
  }
  // an advance payment
  {
    const p = allPatients[3]!;
    const rn = await nextSeq(`receipt:${branchCode(p.branchId)}`);
    await db.payment.create({ data: { receiptNo: `RC-${branchCode(p.branchId)}-${pad(rn, 6)}`, patientId: p.id, branchId: p.branchId, amount: 10000, method: "UPI", reference: "Advance for Rejuran course", paidAt: at(daysAgoKey(2), "16:00"), receivedById: reception.id } });
  }
  // duplicate-looking registration (same mobile) to demo duplicate detection
  {
    const src = allPatients[5]!;
    const n = await nextSeq("patient");
    await db.patient.create({ data: { code: `SHR-${pad(n, 6)}`, fullName: src.name.split(" ")[0] + " " + src.name.split(" ")[1]!.slice(0, 3) + ".", mobile: src.mobile, branchId: src.branchId, source: "WALK_IN", createdById: reception.id, notes: "Possible duplicate — registered at front desk" } });
  }

  // ── leads ──
  console.log("Leads, expenses, activities, attendance…");
  const leadStatuses = ["NEW", "NEW", "NEW", "CONTACTED", "CONTACTED", "CONSULTATION_BOOKED", "CONSULTATION_BOOKED", "TREATMENT_PURCHASED", "FOLLOW_UP", "LOST"] as const;
  const interest = ["Laser Hair Reduction", "Hydra Facial", "Korean Glass Skin Facial", "Botox", "Pigmentation treatment", "Acne scar treatment", "Hair PRP", "Rejuran", "Bridal skin package"];
  const leadUsers = [reception.id, manager.id];
  for (let i = 0; i < 38; i++) {
    const st = pick(leadStatuses);
    const n = await nextSeq("lead");
    const enquiry = daysAgoKey(int(0, 75));
    const name = `${pick(FIRST_F)} ${pick(LAST)}`;
    const converted = st === "TREATMENT_PURCHASED" ? pick(allPatients) : null;
    const lead = await db.lead.create({
      data: {
        code: `LD-${pad(n, 5)}`, name: converted?.name ?? name, mobile: converted?.mobile ?? mobile(), interestedTreatment: pick(interest), enquiryDate: at(enquiry, "13:00"), source: pick(SOURCES),
        branchId: chance(0.6) ? flg.id : ctc.id, assignedToId: pick(leadUsers), followUpDate: st === "LOST" || st === "TREATMENT_PURCHASED" ? null : fromIst(addDaysKey(TODAY, int(-3, 7))),
        status: st, lostReason: st === "LOST" ? pick(["Price too high", "Chose another clinic", "Not reachable", "Timing not suitable"]) : null,
        estimatedValue: pick([4500, 6500, 12000, 15000, 22000, 45000]), patientId: converted?.id ?? null, convertedAt: converted ? at(addDaysKey(enquiry, int(1, 10)), "15:00") : null,
        notes: pick(["Asked for pricing on WhatsApp", "Saw reel on Instagram", "Referred by existing patient", "Wants weekend slot", null]), createdById: reception.id, createdAt: at(enquiry, "13:00"),
      },
    });
    await db.leadActivity.create({ data: { leadId: lead.id, type: "NOTE", note: "Enquiry received", createdById: reception.id, createdAt: at(enquiry, "13:00") } });
    if (st !== "NEW") await db.leadActivity.create({ data: { leadId: lead.id, type: pick(["CALL", "WHATSAPP"]), note: pick(["Shared price list and before/after results", "Called — interested, will confirm date", "Explained session plan and offers"]), createdById: pick(leadUsers), createdAt: at(addDaysKey(enquiry, 1), "12:00") } });
  }

  // ── expenses ──
  const expenseDefs: [string, number, string][] = [
    ["RENT", 185000, "Landlord – monthly rent"], ["ELECTRICITY", 28000, "Adani Electricity"], ["INTERNET", 2400, "JioFiber Business"], ["MARKETING", 45000, "Meta Ads – Instagram campaign"],
    ["MARKETING", 18000, "Google Ads"], ["HOUSEKEEPING", 9000, "CleanPro Services"], ["OFFICE_SUPPLIES", 3200, "Stationery & printer ink"], ["EQUIPMENT_MAINTENANCE", 22000, "Laser machine AMC visit"],
    ["TRANSPORTATION", 1800, "Courier – supplier returns"], ["PRODUCT_PURCHASE", 38000, "K-Derma Distributors"], ["OTHER", 4500, "Pantry & refreshments"],
  ];
  for (let m = 0; m < 3; m++) {
    for (const b of branches) {
      for (const [cat, amt, to] of expenseDefs) {
        if (b.id === ctc.id && cat === "RENT") continue;
        const dKey = addDaysKey(TODAY, -(m * 30 + int(0, 27)));
        const n = await nextSeq("expense");
        const pending = m === 0 && chance(0.3);
        await db.expense.create({
          data: {
            code: `EXP-${pad(n, 5)}`, branchId: b.id, date: at(dKey, "12:00"), category: cat as never, amount: Math.round(amt * (b.id === ctc.id ? 0.7 : 1) * (0.85 + rnd() * 0.3)), paidTo: to,
            method: pick(["BANK_TRANSFER", "UPI", "CASH", "CREDIT_CARD"] as const), description: `${to} — ${m === 0 ? "this month" : "previous month"}`, addedById: pick([manager.id, reception.id]),
            status: pending ? "PENDING" : "APPROVED", approvedById: pending ? null : owner.id, approvedAt: pending ? null : at(dKey, "18:00"), createdAt: at(dKey, "12:00"),
          },
        });
      }
      if (b.id === ctc.id) {
        const dKey = addDaysKey(TODAY, -(m * 30 + 2));
        const n = await nextSeq("expense");
        await db.expense.create({ data: { code: `EXP-${pad(n, 5)}`, branchId: b.id, date: at(dKey, "12:00"), category: "RENT", amount: 140000, paidTo: "Landlord – monthly rent", method: "BANK_TRANSFER", addedById: manager.id, status: "APPROVED", approvedById: owner.id, approvedAt: at(dKey, "18:00") } });
      }
    }
  }
  {
    const n = await nextSeq("expense");
    await db.expense.create({ data: { code: `EXP-${pad(n, 5)}`, branchId: flg.id, date: at(daysAgoKey(1), "12:00"), category: "EQUIPMENT_MAINTENANCE", amount: 6500, paidTo: "HydraTech Service", method: "UPI", description: "HydraFacial handpiece repair", addedById: reception.id, status: "REJECTED", rejectionReason: "Covered under warranty — raise with vendor", approvedById: owner.id, approvedAt: at(daysAgoKey(1), "18:00") } });
  }

  // ── activities ──
  const checklistOpen = ["Reception & waiting area cleaned", "Treatment rooms sanitised", "Laser machine warm-up & test fire", "Autoclave cycle checked", "Today's appointments confirmed", "Cash drawer float counted"];
  const checklistClose = ["All machines switched off", "Consumables restocked", "Biomedical waste sealed", "Cash reconciled with billing", "Next day appointments confirmed", "AC & lights off, clinic locked"];
  for (let d = 0; d < 6; d++) {
    for (const b of branches) {
      const k = daysAgoKey(d);
      await db.activity.create({ data: { branchId: b.id, type: "OPENING_CHECKLIST", title: "Daily opening checklist", checklist: checklistOpen.map((label) => ({ label, done: d > 0 || chance(0.8) })), date: at(k, b.openTime), status: d > 0 ? "REVIEWED" : "OPEN", createdById: reception.id } });
      if (d > 0) await db.activity.create({ data: { branchId: b.id, type: "CLOSING_CHECKLIST", title: "Daily closing checklist", checklist: checklistClose.map((label) => ({ label, done: true })), date: at(k, "20:05"), status: "REVIEWED", createdById: reception.id } });
    }
  }
  await db.activity.createMany({
    data: [
      { branchId: flg.id, type: "MACHINE_MAINTENANCE", title: "Diode laser — quarterly service", description: "Engineer replaced filter, calibrated fluence. Next service in 90 days.", date: at(daysAgoKey(9), "15:00"), status: "RESOLVED", createdById: manager.id },
      { branchId: flg.id, type: "STOCK_RECEIVED", title: "K-Derma consignment received", description: "Serums & peel solutions received and entered in inventory (PUR).", date: at(daysAgoKey(40), "12:30"), status: "REVIEWED", createdById: reception.id },
      { branchId: ctc.id, type: "PATIENT_COMPLAINT", title: "Wait time complaint", description: "Patient waited 35 min past slot due to overrun. Apologised, offered complimentary sheet mask.", date: at(daysAgoKey(3), "17:40"), status: "OPEN", createdById: reception.id },
      { branchId: ctc.id, type: "EQUIPMENT_REPAIR", title: "Treatment chair hydraulic issue", description: "Chair in room 2 not lifting. Vendor visit scheduled.", date: at(daysAgoKey(1), "12:10"), status: "OPEN", createdById: manager.id },
    ],
  });

  // ── attendance (last 45 days) & leaves ──
  const allStaff = Object.values(staff);
  for (let d = 45; d >= 0; d--) {
    const k = daysAgoKey(d);
    const wd = weekdayOfKey(k);
    for (const s of allStaff) {
      if (s.weeklyOff.includes(wd)) {
        if (d > 0) await db.attendance.create({ data: { staffId: s.id, branchId: s.branchId, date: dbDate(k), status: "WEEK_OFF", method: "MANUAL" } });
        continue;
      }
      if (d === 0 && chance(0.15)) continue; // not yet checked in today
      if (chance(0.04)) {
        await db.attendance.create({ data: { staffId: s.id, branchId: s.branchId, date: dbDate(k), status: "ABSENT", method: "MANUAL", notes: "No intimation" } });
        continue;
      }
      const [sh, sm] = s.shiftStart.split(":").map(Number) as [number, number];
      const [eh, em] = s.shiftEnd.split(":").map(Number) as [number, number];
      const late = chance(0.18) ? int(11, 45) : int(-12, 8);
      const half = chance(0.03);
      const inAt = at(k, `${pad(sh, 2)}:${pad(sm, 2)}`);
      const checkIn = new Date(inAt.getTime() + late * 60000);
      const outPlanned = at(k, `${pad(eh, 2)}:${pad(em, 2)}`);
      const extra = half ? -int(240, 300) : chance(0.12) ? int(30, 90) : int(-10, 15);
      const checkOut = d === 0 ? null : new Date(outPlanned.getTime() + extra * 60000);
      const work = checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60000) : 0;
      const shiftMin = (outPlanned.getTime() - inAt.getTime()) / 60000;
      await db.attendance.create({
        data: {
          staffId: s.id, branchId: s.branchId, date: dbDate(k), checkIn, checkOut, workMinutes: Math.max(0, work), lateMinutes: Math.max(0, late), earlyMinutes: checkOut && extra < 0 ? -extra : 0,
          overtimeMinutes: checkOut && work - shiftMin >= 30 ? Math.round(work - shiftMin) : 0, status: half ? "HALF_DAY" : "PRESENT", method: pick(["PIN", "PIN", "QR", "MOBILE"] as const),
        },
      });
    }
  }
  const leaveStaff = [staff["Meena Thapa"]!, staff["Ritu Nair"]!, staff["Grace Lalremruati"]!, staff["Jyoti Shinde"]!];
  await db.leaveRequest.createMany({
    data: [
      { staffId: leaveStaff[0]!.id, type: "SICK", fromDate: dbDate(daysAgoKey(20)), toDate: dbDate(daysAgoKey(19)), days: 2, reason: "Viral fever", status: "APPROVED", reviewedById: manager.id, reviewedAt: at(daysAgoKey(21), "10:00") },
      { staffId: leaveStaff[1]!.id, type: "CASUAL", dayType: "HALF", fromDate: dbDate(daysAgoKey(8)), toDate: dbDate(daysAgoKey(8)), days: 0.5, reason: "Bank work", status: "APPROVED", reviewedById: manager.id, reviewedAt: at(daysAgoKey(9), "10:00") },
      { staffId: leaveStaff[2]!.id, type: "PAID", fromDate: dbDate(addDaysKey(TODAY, 6)), toDate: dbDate(addDaysKey(TODAY, 8)), days: 3, reason: "Family function in Aizawl", status: "PENDING" },
      { staffId: leaveStaff[3]!.id, type: "UNPAID", fromDate: dbDate(addDaysKey(TODAY, 2)), toDate: dbDate(addDaysKey(TODAY, 2)), days: 1, reason: "Personal", status: "PENDING" },
    ],
  });
  for (const lr of [{ s: leaveStaff[0]!, ks: [daysAgoKey(20), daysAgoKey(19)] }]) {
    for (const k of lr.ks) await db.attendance.upsert({ where: { staffId_date: { staffId: lr.s.id, date: dbDate(k) } }, create: { staffId: lr.s.id, branchId: lr.s.branchId, date: dbDate(k), status: "LEAVE", method: "MANUAL", notes: "Sick leave" }, update: { status: "LEAVE", checkIn: null, checkOut: null, workMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, notes: "Sick leave" } });
  }
  const thisMonth = TODAY.slice(0, 7);
  await db.payrollAdjustment.createMany({
    data: [
      { staffId: staff["Meena Thapa"]!.id, month: thisMonth, type: "ADVANCE", amount: 2000, note: "Salary advance", createdById: owner.id },
      { staffId: staff["Sunita Pillai"]!.id, month: thisMonth, type: "INCENTIVE", amount: 1500, note: "Package sales incentive", createdById: owner.id },
      { staffId: staff["Ritu Nair"]!.id, month: thisMonth, type: "INCENTIVE", amount: 1000, note: "Lead conversion incentive", createdById: owner.id },
    ],
  });
  await db.holiday.create({ data: { date: dbDate(addDaysKey(TODAY, 12)), name: "Clinic holiday (example)" } });

  // ── in-app notifications & audit ──
  await db.notification.createMany({
    data: [
      { channel: "IN_APP", recipient: owner.id, userId: owner.id, title: "Expenses awaiting approval", body: "New expense claims were submitted by branch staff.", link: "/expenses?status=PENDING", status: "SENT", sentAt: new Date() },
      { channel: "IN_APP", recipient: owner.id, userId: owner.id, title: "Leave requests pending", body: "2 leave requests need a decision.", link: "/leaves", status: "SENT", sentAt: new Date() },
    ],
  });
  await db.auditLog.create({ data: { userId: owner.id, action: "CREATE", entity: "System", summary: "Demo data initialised" } });

  const counts = await Promise.all([db.patient.count(), db.treatmentPackage.count(), db.treatmentSession.count(), db.appointment.count(), db.invoice.count(), db.payment.count(), db.lead.count(), db.expense.count(), db.attendance.count()]);
  console.log(`Done. patients=${counts[0]} packages=${counts[1]} sessions=${counts[2]} appointments=${counts[3]} invoices=${counts[4]} payments=${counts[5]} leads=${counts[6]} expenses=${counts[7]} attendance=${counts[8]}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
