// Shared types and helpers. People come from the backend (/bot/ui-state); store.ts fills the cache below.

export type Role = "employee" | "manager" | "newjoiner" | "hr" | "hradmin";
export type LeaveType = string; // label: "Casual", "Sick", "Earned", ...

export type Employee = {
  id: string; // backend emp_id, as a string
  name: string;
  title: string;
  dept: string;
  team: string; // department code, e.g. ENG (pulse is grouped by this)
  location: string;
  managerId?: string;
  joined: string; // ISO date
  birthday: string; // MM-DD
  status: string;
};
export type Persona = Employee & { role: Role };

// Leave types shown in the HRMS. Backend codes map to the revamp's labels.
export const LEAVE_TYPES = [
  { code: "CL", type: "Casual" },
  { code: "SL", type: "Sick" },
  { code: "EL", type: "Earned" },
];
export const leaveLabel = (code: string) => LEAVE_TYPES.find((l) => l.code === code)?.type ?? (code === "COMP" ? "Comp-off" : code === "LOP" ? "Unpaid" : code);

// ---------- dates ----------
const DAY = 86_400_000;
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const addDays = (n: number, from = today()) => iso(new Date(from.getTime() + n * DAY));
export const parse = (s: string) => new Date(`${s}T00:00:00`);
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
export const fmtDate = (s: string) => parse(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const fmtShort = (s: string) => parse(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return iso(d) === iso(today()) ? `Today, ${t}` : `${fmtShort(iso(d))}, ${t}`;
};
export const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

// Working days between two dates, skipping weekends and holidays (the HRMS re-checks on submit).
export function workingDays(start: string, end: string, holidayDates: string[]) {
  let n = 0;
  for (let d = parse(start); d <= parse(end); d = new Date(d.getTime() + DAY)) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && !holidayDates.includes(iso(d))) n++;
  }
  return n;
}

// ---------- people (cache filled by store.ts from /bot/ui-state) ----------
// The three sign-in accounts. Any password works: this is a demo login, not authentication.
export const ACCOUNTS = [
  { id: "10", name: "Shabarish N P", email: "shabarish@dotkonnekt.example", label: "Employee", home: "/hrms/employee" },
  { id: "8", name: "Lekha George", email: "lekha@dotkonnekt.example", label: "Manager", home: "/hrms/manager" },
  { id: "15", name: "Vaishali Umredkar", email: "vaishali@dotkonnekt.example", label: "HR", home: "/hrms/admin" },
] as const;

let people: Employee[] = [];
let demo: Persona[] = [];
export function setPeople(e: Employee[], p: Persona[]) {
  people = e;
  demo = p;
}
export const employees = () => people;
export const personas = () => demo;
export const empById = (id: string) => people.find((e) => e.id === id);
export const teamOf = (managerId: string) => people.filter((e) => e.managerId === managerId);
export const firstName = (id: string) => empById(id)?.name.split(" ")[0] ?? id;
export const depts = () => [...new Set(people.map((e) => e.dept))].sort();

// ---------- static bits with no backend table (kept as dummy data) ----------
// Average monthly gross per person by department, for the payroll page.
export const avgGross: Record<string, number> = { Engineering: 142000, Product: 150000, Design: 118000, Sales: 96000, Marketing: 98000, HR: 98000, Finance: 104000 };

export const reimbursements = [
  { id: "RB-311", what: "Client lunch, Indiranagar", amount: 2340, filed: -6, status: "approved" as const },
  { id: "RB-318", what: "Cab to airport", amount: 1180, filed: -2, status: "pending" as const },
];

export const MIN_TEAM = 5;
