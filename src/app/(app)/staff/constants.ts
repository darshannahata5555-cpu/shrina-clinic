// Pure constants shared by server pages and client forms.
export const STAFF_TYPE_OPTIONS = [
  ["DOCTOR", "Doctor"],
  ["THERAPIST", "Therapist"],
  ["RECEPTIONIST", "Receptionist"],
  ["MANAGER", "Manager"],
  ["ACCOUNTS", "Accounts"],
  ["HR_ADMIN", "HR / Admin"],
  ["SUPPORT", "Support / Housekeeping"],
] as const;

export const DEPARTMENTS = ["Medical", "Therapy", "Front Desk", "Management", "Accounts", "HR / Admin", "Housekeeping", "Marketing"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
