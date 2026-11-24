"use client";

import Link from "next/link";
import { Card, PageHeader, Stat, Status, Table, greeting } from "@/components/ui";
import { addDays, fmtDate, fmtShort, inr } from "@/lib/data";
import { balance, useFetch, useMe, useStore } from "@/lib/store";

type Summary = { month: { present: number; working: number } };

export default function EmployeeHome() {
  const s = useStore();
  const ME = useMe();
  const [first, ...rest] = balance(s, ME);
  const nextHoliday = s.holidays.find((h) => h.date >= addDays(0));
  const slips = useFetch<{ payslips: { label: string; net_pay: number }[] }>(`/hrms/payslips?emp_id=${ME}`)?.payslips;
  const slip = slips?.[0];
  const att = useFetch<Summary>(`/hrms/attendance/summary?emp_id=${ME}&days=31`);
  const mine = s.requests.filter((r) => r.empId === ME && r.status !== "cancelled").slice(0, 4);

  return (
    <>
      <PageHeader title={`${greeting()}, ${s.me.name.split(" ")[0]}`} sub={fmtDate(addDays(0))} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label={first ? `${first.type} leave left` : "Leave left"} value={first?.left ?? "…"} note={rest.map((b) => `${b.left} ${b.type.toLowerCase()}`).join(", ")} />
          <Stat label="Next holiday" value={nextHoliday ? fmtShort(nextHoliday.date) : "None"} note={nextHoliday?.name} />
          <Stat label={`Net pay${slip ? `, ${slip.label}` : ""}`} value={<span className="font-mono text-2xl">{slip ? inr(slip.net_pay) : slips ? "None yet" : "…"}</span>} note={slips && !slip ? "After your first payroll run" : "From KonnektHRMS payroll"} />
          <Stat label="Attendance this month" value={att ? `${att.month.present}/${att.month.working}` : "…"} note="Working days marked" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="My leave requests" aside={<Link href="/hrms/employee/leave" className="text-gold">Apply for leave</Link>}>
            <Table
              head={["Request", "Type", "Dates", "Status"]}
              rows={mine.map((r) => [
                <span key="id" className="font-mono text-xs">#{r.id}</span>,
                r.type,
                `${fmtShort(r.start)} to ${fmtShort(r.end)}`,
                <Status key="s" status={r.status} waitingOn={r.approverName?.split(" ")[0]} />,
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
