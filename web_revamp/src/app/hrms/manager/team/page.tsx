"use client";

import { Card, Face, PageHeader, Stat, Table } from "@/components/ui";
import { useStore } from "@/lib/store";

const tone: Record<string, string> = { gold: "text-gold", red: "text-red", muted: "text-muted" };

export default function TeamPage() {
  const s = useStore();
  const team = s.team;
  if (!team) return <PageHeader title="Team" sub="Loading from KonnektHRMS" />;

  return (
    <>
      <PageHeader title="Team" sub={`${s.me.name}, ${s.me.dept}`} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="People" value={team.people.length} />
          <Stat label="On leave today" value={team.on_leave_today} />
          <Stat label="Approved leave ahead" value={team.approved_ahead} />
        </div>
        <Card title="Your team today">
          <Table
            head={["Name", "Title", "Location", "Today", "Leave left"]}
            rows={team.people.map((e) => [
              <span key="n" className="flex items-center gap-2.5 whitespace-nowrap">
                <Face name={e.name} size={28} /> {e.name}
              </span>,
              e.title,
              e.location,
              <span key="t" className={tone[e.today.tone] ?? ""}>{e.today.label}</span>,
              e.leave_left,
            ])}
          />
          <p className="mt-3 text-xs text-muted">{team.legend} Individual wellness and pulse answers are never shown here.</p>
        </Card>
      </div>
    </>
  );
}
