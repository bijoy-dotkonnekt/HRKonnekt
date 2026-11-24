"use client";
// Directory (everyone) and Employees (HR admin) are the same list; HR also sees joining date and today's attendance.

import { useState } from "react";
import { Card, Face, Table } from "@/components/ui";
import { depts, firstName, fmtShort } from "@/lib/data";
import { useStore } from "@/lib/store";

const field = "min-h-11 rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-gold";

export function EmployeeList({ admin = false }: { admin?: boolean }) {
  const s = useStore();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const list = s.people.filter((e) => (!dept || e.dept === dept) && `${e.name} ${e.title}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Card title={`${list.length} of ${s.people.length} people`}>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or title" aria-label="Search" className={`${field} min-w-0 flex-1`} />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" className={field}>
          <option value="">All departments</option>
          {depts().map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      <Table
        head={admin ? ["Name", "Title", "Department", "Location", "Manager", "Joined", "Today"] : ["Name", "Title", "Department", "Location", "Manager"]}
        rows={list.map((e) => {
          const row: React.ReactNode[] = [
            <span key="n" className="flex items-center gap-2.5 whitespace-nowrap">
              <Face name={e.name} size={28} /> {e.name}
            </span>,
            e.title,
            e.dept,
            e.location,
            firstName(e.managerId),
          ];
          if (admin) {
            const today = s.attendanceToday[e.id];
            row.push(
              e.joined ? `${fmtShort(e.joined)}, ${e.joined.slice(0, 4)}` : "",
              <span key="l" className={today?.status === "leave" ? "text-gold" : "text-muted"}>{today?.label ?? "Not marked yet"}</span>,
            );
          }
          return row;
        })}
      />
    </Card>
  );
}
