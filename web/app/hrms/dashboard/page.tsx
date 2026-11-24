"use client";
import { Any, fmtDate, usePoll } from "@/lib/api";
import { Stat, Status, Title } from "@/components/ui";

export default function Dashboard() {
  const [d] = usePoll<Any>("/hrms/dashboard/summary");
  const max = Math.max(1, ...(d?.by_department ?? []).map((x: Any) => x.headcount));
  return (
    <>
      <Title eyebrow="HR admin">HR dashboard</Title>
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Headcount" value={d?.headcount ?? "–"} sub="active, probation and notice" />
        <Stat label="On leave today" value={d?.on_leave_today?.length ?? "–"} sub={d?.on_leave_today?.map((e: Any) => e.name).join(", ") || "nobody"} />
        <Stat label="Pending leave" value={d?.pending_requests ?? "–"} sub="across all managers" />
        <Stat label="On probation" value={d?.probation ?? "–"} sub={`${d?.new_joiners?.length ?? 0} joined in the last 45 days`} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="card flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold">Headcount by department</h2>
          {d?.by_department?.map((x: Any) => (
            <div key={x.code} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm"><span>{x.name}</span><b>{x.headcount}</b></div>
              <div className="h-2 rounded-full bg-hair"><div className="h-2 rounded-full bg-purple" style={{ width: `${(x.headcount / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="card flex flex-col">
          <h2 className="m-0 mb-2 text-lg font-semibold">Latest leave activity</h2>
          {d?.recent_requests?.map((r: Any) => (
            <div key={r.id} className="flex justify-between gap-3 py-2 border-t border-hair text-sm">
              <span>{r.employee_name} · {r.leave_type} · {fmtDate(r.start_date)} · {r.days}d {r.source === "chat" && <span className="pill bg-lilac-soft text-plum">chat</span>}</span>
              <Status s={r.status} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
