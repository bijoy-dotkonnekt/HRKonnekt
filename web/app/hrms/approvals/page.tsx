"use client";
import { useState } from "react";
import { Any, fmtDate, post, usePoll } from "@/lib/api";
import { Status, Title } from "@/components/ui";
import { useRole } from "@/components/role";

export default function Approvals() {
  const { emp } = useRole();
  const [reqs, reload] = usePoll<Any[]>(`/hrms/leave/requests?approver_id=${emp}`);
  const [err, setErr] = useState("");
  const pending = reqs?.filter((r) => r.status === "pending") ?? [];
  const act = (id: number, verb: string) => post(`/hrms/leave/requests/${id}/${verb}`, { approver_id: emp }).then(reload).catch((e) => setErr(e.message));
  return (
    <>
      <Title eyebrow="Manager">Approvals <span className="pill bg-gold-soft text-gold-ink border border-gold align-middle">{pending.length} pending</span></Title>
      {err && <span className="text-danger text-sm">{err}</span>}
      <div className="flex flex-col gap-3">
        {pending.map((r) => (
          <div key={r.id} className="card flex justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <b className="font-semibold">{r.employee_name}</b>
              <span className="text-sm">{r.leave_type_name} · {fmtDate(r.start_date)}{r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`} · {r.days} day{r.days > 1 ? "s" : ""}</span>
              <span className="text-muted text-[12.5px]">{r.reason} · {r.source === "chat" ? "via HRKonnekt Chat" : "via KonnektHRMS"}</span>
            </div>
            <div className="flex gap-2"><button className="btn" onClick={() => act(r.id, "approve")}>Approve</button><button className="btn2" onClick={() => act(r.id, "reject")}>Reject</button></div>
          </div>
        ))}
        {!pending.length && <span className="text-muted">Nothing waiting for you. 🎉</span>}
      </div>
      <div className="card">
        <h2 className="m-0 mb-2 text-lg font-semibold">Recently decided</h2>
        {reqs?.filter((r) => r.status !== "pending").slice(0, 8).map((r) => (
          <div key={r.id} className="flex justify-between py-2 border-t border-hair text-sm">
            <span>{r.employee_name} · {r.leave_type} · {fmtDate(r.start_date)} · {r.days}d</span><Status s={r.status} />
          </div>
        ))}
      </div>
    </>
  );
}
