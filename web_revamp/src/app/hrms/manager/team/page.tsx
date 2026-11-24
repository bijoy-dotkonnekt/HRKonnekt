"use client";

import { Card, Face, PageHeader, Stat, Table } from "@/components/ui";
import { addDays, fmtShort, teamOf } from "@/lib/data";
import { balance, useMe, useStore } from "@/lib/store";

const LOOK: Record<string, { label: string; cls: string }> = {
  present: { label: "In office", cls: "" },
  half_day: { label: "Half day", cls: "" },
  wfh: { label: "Working from home", cls: "" },
  weekend: { label: "Weekend", cls: "text-muted" },
  holiday: { label: "Holiday", cls: "text-muted" },
  absent: { label: "Absent", cls: "text-red" },
};

export default function TeamPage() {
  const s = useStore();
  const ME = useMe();
  const team = teamOf(ME).filter((e) => e.status !== "exited");
  const t = addDays(0);
  const today = (id: string) => {
    const leave = s.requests.find((r) => r.empId === id && r.status === "approved" && r.start <= t && r.end >= t);
    if (leave) return { label: `On leave until ${fmtShort(leave.end)}`, cls: "text-gold" };
    return LOOK[s.attendanceToday[id]] ?? { label: "Not marked yet", cls: "text-muted" };
  };
  const upcoming = s.requests.filter((r) => r.status === "approved" && r.start > t && team.some((e) => e.id === r.empId));
  const out = team.filter((e) => today(e.id).cls === "text-gold").length;

  return (
    <>
      <PageHeader title="Team" sub={`${s.me.name}, ${s.me.dept}`} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="People" value={team.length} />
          <Stat label="On leave today" value={out} />
          <Stat label="Approved leave ahead" value={upcoming.length} />
        </div>
        <Card title="Your team today">
          <Table
            head={["Name", "Title", "Location", "Today", "Leave left"]}
            rows={team.map((e) => {
              const st = today(e.id);
              return [
                <span key="n" className="flex items-center gap-2.5 whitespace-nowrap">
                  <Face name={e.name} size={28} /> {e.name}
                </span>,
                e.title,
                e.location,
                <span key="t" className={st.cls}>{st.label}</span>,
                balance(s, e.id).map((b) => `${b.left} ${b.type[0]}`).join(", "),
              ];
            })}
          />
          <p className="mt-3 text-xs text-muted">Leave left: C casual, S sick, E earned. Individual wellness and pulse answers are never shown here.</p>
        </Card>
      </div>
    </>
  );
}
