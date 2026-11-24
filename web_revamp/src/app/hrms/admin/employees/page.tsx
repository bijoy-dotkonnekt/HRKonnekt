"use client";

import { useState } from "react";
import { EmployeeList } from "@/components/EmployeeList";
import { Button, Card, PageHeader } from "@/components/ui";
import { addDays } from "@/lib/data";
import { addEmployee, useFetch, useStore } from "@/lib/store";

const field = "min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-gold";
type Opt = { value: string; label: string };
type Options = {
  departments: { id: number; name: string }[];
  locations: { id: number; name: string }[];
  managers: { id: number; name: string; designation: string; department: string }[];
  grades: string[];
  employment_types: Opt[];
  genders: Opt[];
  email_domain: string;
};

function AddEmployee({ onDone }: { onDone: () => void }) {
  const o = useFetch<Options>("/bot/admin/employees/form-options");
  const [f, setF] = useState<Record<string, string | boolean>>({ date_of_joining: addDays(0) });
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  if (!o) return <p className="text-sm text-muted">Loading the form</p>;
  const v = (k: string, d = "") => String(f[k] ?? d);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sel = (k: string, items: Opt[], label: string) => (
    <label className="grid gap-1 text-sm">
      {label}
      <select value={v(k, items[0]?.value)} onChange={set(k)} className={field}>
        {items.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    </label>
  );
  const txt = (k: string, label: string, type = "text", required = true) => (
    <label className="grid gap-1 text-sm">
      {label}
      <input type={type} value={v(k)} onChange={set(k)} required={required} className={field} />
    </label>
  );

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const pick = (k: string, d?: string) => v(k, d);
        try {
          const r = await addEmployee({
            first_name: pick("first_name"), last_name: pick("last_name"), designation: pick("designation"),
            department_id: Number(pick("department_id", String(o.departments[0]?.id))),
            location_id: Number(pick("location_id", String(o.locations[0]?.id))),
            manager_id: Number(pick("manager_id", String(o.managers[0]?.id))),
            grade: pick("grade", o.grades[0]), employment_type: pick("employment_type", o.employment_types[0]?.value),
            gender: pick("gender", o.genders[0]?.value), date_of_joining: pick("date_of_joining"), dob: pick("dob"),
            phone: pick("phone"), is_hr_admin: f.is_hr_admin === true, annual_ctc: f.annual_ctc ? Number(f.annual_ctc) : null,
          });
          setDone(r.message);
          setF({ date_of_joining: addDays(0) });
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {txt("first_name", "First name")}
      {txt("last_name", "Last name")}
      {txt("designation", "Designation")}
      {sel("department_id", o.departments.map((d) => ({ value: String(d.id), label: d.name })), "Department")}
      {sel("manager_id", o.managers.map((m) => ({ value: String(m.id), label: `${m.name}, ${m.designation}` })), "Manager")}
      {sel("location_id", o.locations.map((l) => ({ value: String(l.id), label: l.name })), "Location")}
      {sel("grade", o.grades.map((g) => ({ value: g, label: g })), "Grade")}
      {sel("employment_type", o.employment_types, "Employment")}
      {txt("date_of_joining", "Joining date", "date")}
      {txt("dob", "Date of birth", "date")}
      {sel("gender", o.genders, "Gender")}
      {txt("phone", "Phone (optional)", "tel", false)}
      {txt("annual_ctc", "Annual CTC in rupees (optional)", "number", false)}
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" checked={f.is_hr_admin === true} onChange={(e) => setF((x) => ({ ...x, is_hr_admin: e.target.checked }))} />
        HR admin
      </label>
      <p className="text-xs text-muted sm:col-span-2">
        The work email is made from the name at {o.email_domain}. The account can sign in straight away with the demo password.
      </p>
      {err && <p role="alert" className="text-sm text-red sm:col-span-2">{err}</p>}
      {done && <p role="status" className="text-sm text-green sm:col-span-2">{done}</p>}
      <Button type="submit" disabled={busy} className="sm:col-span-2">
        {busy ? "Adding" : "Add employee"}
      </Button>
    </form>
  );
}

export default function EmployeesPage() {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Employees" sub={`${s.people.length} people at ${s.meta.company.name}`}>
        <Button variant={adding ? "ghost" : "primary"} onClick={() => setAdding(!adding)}>
          {adding ? "Close" : "Add employee"}
        </Button>
      </PageHeader>
      <div className="grid gap-4 px-4 md:px-8">
        {adding && (
          <Card title="Someone new joined">
            <AddEmployee onDone={() => {}} />
          </Card>
        )}
        <EmployeeList admin />
      </div>
    </>
  );
}
