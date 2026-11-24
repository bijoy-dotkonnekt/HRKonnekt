"use client";

import Link from "next/link";
import { Card, PageHeader, Stat, Status, Table } from "@/components/ui";
import { addDays, depts, empById, employees, fmtShort, parse } from "@/lib/data";
import { useStore } from "@/lib/store";

export default function HrDashboard() {
  const s = useStore();
  const t = addDays(0);
  const all = employees().filter((e) => e.status !== "exited");
  const onLeave = Object.values(s.attendanceToday).filter((v) => v === "leave").length;
  const pending = s.requests.filter((r) => r.status === "pending").length;
  const open = s.handovers.filter((h) => h.status === "open").length;
  const ds = depts();
  const max = Math.max(...ds.map((d) => all.filter((e) => e.dept === d).length));
  // Birthdays and work anniversaries in the next 14 days.
  const soon = all
    .flatMap((e) => {
      const out: { name: string; what: string; date: string }[] = [];
      for (let i = 0; i <= 14; i++) {
        const d = addDays(i);
        if (e.birthday === d.slice(5)) out.push({ name: e.name, what: "Birthday", date: d });
        const yrs = parse(d).getFullYear() - parse(e.joined).getFullYear();
        if (e.joined.slice(5) === d.slice(5) && yrs > 0) out.push({ name: e.name, what: `${yrs} ${yrs === 1 ? "year" : "years"} at DotKonnekt`, date: d });
      }
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  return (
    <>
      <PageHeader title="HR dashboard" sub={`${s.me.name}, ${s.me.title}`} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Headcount" value={all.length} note={`${ds.length} departments`} />
          <Stat label="On leave today" value={onLeave} />
          <Stat label="Leave waiting on managers" value={pending} />
          <Stat label="Open handovers" value={open} tone={open ? "gold" : undefined} note={open ? "In the HRKonnekt Console" : "You're up to date"} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Headcount by department">
            <ul className="space-y-2.5">
              {ds.map((d) => {
                const n = all.filter((e) => e.dept === d).length;
                return (
                  <li key={d} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 text-sm">
                    <span className="text-muted">{d}</span>
                    <span className="h-2.5 rounded-full bg-raised">
                      <span className="block h-full rounded-full bg-ink/70" style={{ width: `${(n / max) * 100}%` }} />
                    </span>
                    <span className="text-right font-display font-semibold">{n}</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Next two weeks">
            <ul className="divide-y divide-line">
              {soon.map((x) => (
                <li key={x.name + x.what} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    {x.name} <span className="text-muted">{x.what}</span>
                  </span>
                  <span className="whitespace-nowrap text-muted">{x.date === t ? "Today" : fmtShort(x.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card title="Latest leave requests" aside={<Link href="/hrms/admin/console" className="text-gold">Open the Console</Link>}>
          <Table
            head={["Request", "Who", "Type", "Dates", "Via", "Status"]}
            rows={s.requests
              .filter((r) => r.status !== "cancelled")
              .slice(0, 6)
              .map((r) => [
                <span key="id" className="font-mono text-xs">#{r.id}</span>,
                empById(r.empId)?.name,
                r.type,
                `${fmtShort(r.start)} to ${fmtShort(r.end)}`,
                r.via === "chat" ? "Chat" : "KonnektHRMS",
                <Status key="s" status={r.status as "pending" | "approved" | "rejected"} waitingOn={r.approverId ? empById(r.approverId)?.name.split(" ")[0] : undefined} />,
              ])}
          />
        </Card>
      </div>
    </>
  );
}
