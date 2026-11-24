"use client";

import { Card, PageHeader, Stat } from "@/components/ui";
import { fmtDate, parse } from "@/lib/data";
import { useFetch, useMe } from "@/lib/store";

type Day = { date: string; kind: string; label: string; check_in: string | null; check_out: string | null };
type Summary = { days: number; counts: Record<string, number>; legend: { kind: string; label: string }[]; notes: { wfh: string; no_leave: string | null } };
// Colour per kind is presentation only; which status counts as which kind is decided by KonnektHRMS.
const cls: Record<string, string> = {
  office: "bg-ink/75",
  wfh: "bg-ink/30",
  leave: "bg-gold-fill",
  holiday: "bg-green",
  weekend: "bg-raised ring-1 ring-inset ring-line",
  absent: "bg-red/70",
};

export default function AttendancePage() {
  const ME = useMe();
  const days = useFetch<Day[]>(`/hrms/attendance?emp_id=${ME}&days=90`);
  const sum = useFetch<Summary>(`/hrms/attendance/summary?emp_id=${ME}&days=90`);
  if (!days?.length || !sum) return <PageHeader title="Attendance" sub="Loading from KonnektHRMS" />;
  // Pad the start so columns are whole weeks, Monday on top.
  const pad = (parse(days[0].date).getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...days];
  const n = (k: string) => sum.counts[k] ?? 0;

  return (
    <>
      <PageHeader title="Attendance" sub={`Last ${sum.days} days, from KonnektHRMS`} />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Days in office" value={n("office")} />
          <Stat label="Days from home" value={n("wfh")} note={sum.notes.wfh} />
          <Stat label="Leave days" value={n("leave")} tone={sum.notes.no_leave ? "gold" : undefined} note={sum.notes.no_leave ?? undefined} />
          <Stat label="Holidays" value={n("holiday")} />
        </div>
        <Card title="Day by day">
          <div className="overflow-x-auto">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-1.5">
              {cells.map((d: Day | null, i) =>
                d ? (
                  <span key={d.date} title={`${fmtDate(d.date)}: ${d.label}${d.check_in ? `, ${d.check_in} to ${d.check_out}` : ""}`} className={`h-5 w-5 rounded-[5px] ${cls[d.kind] ?? ""}`} />
                ) : (
                  <span key={`p${i}`} className="h-5 w-5" />
                ),
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
            {sum.legend.map((l) => (
              <span key={l.kind} className="inline-flex items-center gap-2">
                <span className={`h-3.5 w-3.5 rounded-[4px] ${cls[l.kind] ?? ""}`} aria-hidden /> {l.label}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
