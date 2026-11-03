/** Soft-deletable record types shown in the recycle bin. */
export const RECYCLE_TYPES = [
  { key: "patient", model: "patient", entity: "Patient", label: "Patient", labelField: "fullName", sub: "code", href: (id: string) => `/patients/${id}`, branch: true },
  { key: "appointment", model: "appointment", entity: "Appointment", label: "Appointment", labelField: "id", sub: null, href: (id: string) => `/appointments/${id}`, branch: true },
  { key: "package", model: "treatmentPackage", entity: "TreatmentPackage", label: "Treatment package", labelField: "name", sub: "code", href: (id: string) => `/treatments/packages/${id}`, branch: true },
  { key: "consultation", model: "consultation", entity: "Consultation", label: "Consultation", labelField: "complaint", sub: null, href: null, branch: true },
  { key: "photo", model: "patientPhoto", entity: "PatientPhoto", label: "Patient photo", labelField: "caption", sub: "kind", href: null, branch: false },
  { key: "invoice", model: "invoice", entity: "Invoice", label: "Invoice", labelField: "number", sub: null, href: (id: string) => `/billing/${id}`, branch: true },
  { key: "treatment", model: "treatment", entity: "Treatment", label: "Treatment (catalogue)", labelField: "name", sub: "category", href: (id: string) => `/treatments/catalog/${id}`, branch: false },
  { key: "product", model: "product", entity: "Product", label: "Product", labelField: "name", sub: "sku", href: (id: string) => `/inventory/${id}`, branch: false },
  { key: "supplier", model: "supplier", entity: "Supplier", label: "Supplier", labelField: "name", sub: null, href: null, branch: false },
  { key: "expense", model: "expense", entity: "Expense", label: "Expense", labelField: "code", sub: "paidTo", href: null, branch: true },
  { key: "activity", model: "activity", entity: "Activity", label: "Activity", labelField: "title", sub: "type", href: null, branch: true },
  { key: "staff", model: "staff", entity: "Staff", label: "Employee", labelField: "fullName", sub: "code", href: (id: string) => `/staff/${id}`, branch: true },
  { key: "lead", model: "lead", entity: "Lead", label: "Lead", labelField: "name", sub: "code", href: (id: string) => `/leads/${id}`, branch: true },
] as const;
