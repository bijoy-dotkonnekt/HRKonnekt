"use client";

import { Card, PageHeader, Stat } from "@/components/ui";
import { fmtDate, parse } from "@/lib/data";
import { useFetch, useMe } from "@/lib/store";

type Kind = "office" | "wfh" | "leave" | "holiday" | "weekend" | "absent";
const look: Record<Kind, { label: string; cls: string }> = {
  office: { label: "Office", cls: "bg-ink/75" },
  wfh: { label: "Home", cls: "bg-ink/30" },
  leave: { label: "Leave", cls: "bg-gold-fill" },
  holiday: { label: "Holiday", cls: "bg-green" },
  weekend: { label: "Weekend", cls: "bg-raised ring-1 ring-inset ring-line" },
  absent: { label: "Absent", cls: "bg-red/70" },
};
const kindOf = (s: string): Kind => (s === "present" || s === "half_day" ? "office" : s in look ? (s as Kind) : "absent");

export default function AttendancePage() {
  const ME = useMe();
  const rows = useFetch<{ date: string; status: string; check_in: string | null; check_out: string | null }[]>(`/hrms/attendance?emp_id=${ME}&days=90`);
  if (!rows?.length) return <PageHeader title="Attendance" sub="Loading the last 90 days from hrms.db" />;
  const days = rows.map((d) => ({ ...d, kind: kindOf(d.status) }));
  // Pad the start so columns are whole weeks, Monday on top.
  const pad = (parse(days[0].date).getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...days];
  const n = (k: Kind) => days.filter((d) => d.kind === k).length;

  return (
    <>
      <PageHeader title="Attendance" sub="Last 90 days, from hrms.db" />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Days in office" value={n("office")} />
          <Stat label="Days from home" value={n("wfh")} note="Up to 2 a week" />
          <Stat label="Leave days" value={n("leave")} tone={n("leave") === 0 ? "gold" : undefined} note={n("leave") === 0 ? "No day off in 90 days" : undefined} />
          <Stat label="Holidays" value={n("holiday")} />
        </div>
        <Card title="Day by day">
          <div className="overflow-x-auto">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-1.5">
              {cells.map((d, i) =>
                d ? (
                  <span key={d.date} title={`${fmtDate(d.date)}: ${look[d.kind as Kind].label}${d.check_in ? `, ${d.check_in} to ${d.check_out}` : ""}`} className={`h-5 w-5 rounded-[5px] ${look[d.kind as Kind].cls}`} />
                ) : (
                  <span key={`p${i}`} className="h-5 w-5" />
                ),
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
            {Object.values(look).map((l) => (
              <span key={l.label} className="inline-flex items-center gap-2">
                <span className={`h-3.5 w-3.5 rounded-[4px] ${l.cls}`} aria-hidden /> {l.label}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
