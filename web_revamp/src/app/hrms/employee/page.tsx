"use client";

import Link from "next/link";
import { Card, PageHeader, Stat, Status, Table, greeting } from "@/components/ui";
import { addDays, firstName, fmtDate, fmtShort, inr } from "@/lib/data";
import { balance, useFetch, useMe, useStore } from "@/lib/store";

export default function EmployeeHome() {
  const s = useStore();
  const ME = useMe();
  const bal = balance(s, ME);
  const nextHoliday = s.holidays.find((h) => h.date >= addDays(0));
  const slips = useFetch<{ payslips: { month: string; net_pay: number }[] }>(`/hrms/payslips?emp_id=${ME}`)?.payslips;
  const att = useFetch<{ date: string; status: string }[]>(`/hrms/attendance?emp_id=${ME}&days=31`);
  const month = addDays(0).slice(0, 7);
  const days = (att ?? []).filter((d) => d.date.startsWith(month) && !["weekend", "holiday"].includes(d.status));
  const present = days.filter((d) => ["present", "wfh", "half_day"].includes(d.status)).length;
  const mine = s.requests.filter((r) => r.empId === ME && r.status !== "cancelled").slice(0, 4);
  const mgr = s.me.managerId ? firstName(s.me.managerId) : "";
  const slipLabel = slips?.[0] && new Date(`${slips[0].month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader title={`${greeting()}, ${s.me.name.split(" ")[0]}`} sub={fmtDate(addDays(0))} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Casual leave left" value={bal[0].left} note={bal.slice(1).map((b) => `${b.left} ${b.type.toLowerCase()}`).join(", ")} />
          <Stat label="Next holiday" value={nextHoliday ? fmtShort(nextHoliday.date) : "None"} note={nextHoliday?.name} />
          <Stat label={`Net pay${slipLabel ? `, ${slipLabel}` : ""}`} value={<span className="font-mono text-2xl">{slips?.[0] ? inr(slips[0].net_pay) : "…"}</span>} note="From KonnektHRMS payroll" />
          <Stat label="Attendance this month" value={att ? `${present}/${days.length}` : "…"} note="Working days marked" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="My leave requests" aside={<Link href="/hrms/employee/leave" className="text-gold">Apply for leave</Link>}>
            <Table
              head={["Request", "Type", "Dates", "Status"]}
              rows={mine.map((r) => [
                <span key="id" className="font-mono text-xs">#{r.id}</span>,
                r.type,
                `${fmtShort(r.start)} to ${fmtShort(r.end)}`,
                <Status key="s" status={r.status === "cancelled" ? "rejected" : r.status} waitingOn={mgr} />,
              ])}
            />
          </Card>

          <Card title="Announcements">
            <ul className="divide-y divide-line">
              {s.announcements.map((a) => (
                <li key={a.title} className="py-2.5">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs text-muted">
                    {a.body} {fmtShort(a.at.slice(0, 10))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
