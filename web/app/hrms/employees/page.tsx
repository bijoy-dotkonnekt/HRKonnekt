"use client";
import { useState } from "react";
import { Any, fmtDate, usePoll } from "@/lib/api";
import { Title } from "@/components/ui";

export default function Employees() {
  const [q, setQ] = useState("");
  const [emps] = usePoll<Any[]>(`/hrms/employees?q=${encodeURIComponent(q)}`, 30000);
  return (
    <>
      <div className="flex justify-between items-end gap-4">
        <Title eyebrow="HR admin">Employees</Title>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, code" aria-label="Search employees"
          className="min-h-11 w-72 px-4 rounded-xl border border-ink/15 bg-paper text-sm" />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted">{["Code", "Name", "Department", "Designation", "Manager", "Location", "Joined", "Status"].map((h) => <th key={h} className="pb-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{emps?.map((e) => (
            <tr key={e.id} className="border-t border-hair">
              <td className="py-2 text-muted font-mono text-xs">{e.emp_code}</td>
              <td><span className="inline-flex w-6 h-6 rounded-full text-[10px] text-white items-center justify-center mr-2 align-middle" style={{ background: e.avatar_color }}>{e.first_name[0]}{e.last_name[0]}</span>{e.name}</td>
              <td>{e.department}</td><td>{e.designation}</td><td>{e.manager_name ?? "—"}</td><td>{e.location}</td><td>{fmtDate(e.date_of_joining)} {e.date_of_joining.slice(0, 4)}</td>
              <td><span className={`pill ${e.status === "active" ? "bg-lilac text-plum" : "bg-gold-soft text-gold-ink"}`}>{e.status}</span></td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
