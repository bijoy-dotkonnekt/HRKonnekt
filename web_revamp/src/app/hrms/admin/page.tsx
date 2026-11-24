"use client";

import Link from "next/link";
import { Card, PageHeader, Stat, Status, Table } from "@/components/ui";
import { fmtShort } from "@/lib/data";
import { useFetch, useStore } from "@/lib/store";

type Summary = { headcount: number; departments: number; on_leave_today: unknown[]; pending_requests: number; by_department: { code: string; name: string; headcount: number }[] };
type Event = { date: string; name: string; what: string; today: boolean };

export default function HrDashboard() {
  const s = useStore();
  const open = s.badges.open_handovers ?? 0;
  // Refetch when the live poll sees new requests or handovers, so the counts stay current.
  const tick = s.requests.length + open;
  const sum = useFetch<Summary>("/hrms/dashboard/summary", tick);
  const soon = useFetch<Event[]>("/hrms/events?days=14");
  const max = Math.max(1, ...(sum?.by_department ?? []).map((d) => d.headcount));

  return (
    <>
      <PageHeader title="HR dashboard" sub={`${s.me.name}, ${s.me.title}`} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Headcount" value={sum?.headcount ?? "…"} note={sum ? `${sum.departments} departments` : undefined} />
          <Stat label="On leave today" value={sum?.on_leave_today.length ?? "…"} />
          <Stat label="Leave waiting on managers" value={sum?.pending_requests ?? "…"} />
          <Stat label="Open handovers" value={open} tone={open ? "gold" : undefined} note={open ? "In the HRKonnekt Console" : "You're up to date"} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Headcount by department">
            <ul className="space-y-2.5">
              {sum?.by_department.map((d) => (
                <li key={d.code} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 text-sm">
                  <span className="text-muted">{d.name}</span>
                  <span className="h-2.5 rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-ink/70" style={{ width: `${(d.headcount / max) * 100}%` }} />
                  </span>
                  <span className="text-right font-display font-semibold">{d.headcount}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Next two weeks">
            <ul className="divide-y divide-line">
              {(soon ?? []).slice(0, 6).map((x) => (
                <li key={x.name + x.what} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    {x.name} <span className="text-muted">{x.what}</span>
                  </span>
                  <span className="whitespace-nowrap text-muted">{x.today ? "Today" : fmtShort(x.date)}</span>
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
                r.employeeName,
                r.type,
                `${fmtShort(r.start)} to ${fmtShort(r.end)}`,
                r.via === "chat" ? "Chat" : "KonnektHRMS",
                <Status key="s" status={r.status} waitingOn={r.approverName?.split(" ")[0]} />,
              ])}
          />
        </Card>
      </div>
    </>
  );
}
