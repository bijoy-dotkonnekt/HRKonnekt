// Shared types and display helpers. All data comes from the backend (/bot/ui-state, /bot/meta, /hrms/*); store.ts fills the people cache.

export type Role = "employee" | "manager" | "hr_admin";

export type Employee = {
  id: string; // backend emp_id, as a string
  name: string;
  title: string;
  dept: string;
  team: string; // department code, e.g. ENG
  location: string;
  managerId?: string | null;
  joined?: string; // ISO date; HR only
  status: string;
};
export type Persona = Employee & { role: Role; email: string; home: string; is_new_joiner: boolean; location_id: number };

// ---------- dates (display only) ----------
const DAY = 86_400_000;
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const addDays = (n: number, from = today()) => iso(new Date(from.getTime() + n * DAY));
export const parse = (s: string) => new Date(`${s}T00:00:00`);
export const fmtDate = (s: string) => parse(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const fmtShort = (s: string) => parse(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return iso(d) === iso(today()) ? `Today, ${t}` : `${fmtShort(iso(d))}, ${t}`;
};
export const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

// ---------- people (cache filled by store.ts from /bot/ui-state) ----------
let people: Employee[] = [];
let byId = new Map<string, Employee>();
export const setPeople = (e: Employee[]) => {
  people = e;
  byId = new Map(e.map((p) => [p.id, p]));
};
export const employees = () => people;
export const empById = (id?: string | null) => (id ? byId.get(id) : undefined);
export const firstName = (id?: string | null) => empById(id)?.name.split(" ")[0] ?? "";
export const depts = () => [...new Set(people.map((e) => e.dept))].sort();
