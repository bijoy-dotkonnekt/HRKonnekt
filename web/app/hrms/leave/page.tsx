"use client";
import { Any, fmtDate, post, usePoll } from "@/lib/api";
import { Status, Title } from "@/components/ui";
import { useRole } from "@/components/role";

export default function Leave() {
  const { emp } = useRole();
  const [bal] = usePoll<Any[]>(`/hrms/leave/balances?emp_id=${emp}`);
  const [reqs, reload] = usePoll<Any[]>(`/hrms/leave/requests?emp_id=${emp}`);
  return (
    <>
      <Title eyebrow="Leave">My leave</Title>
      <div className="card">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted">{["Type", "Opening", "Accrued", "Used", "Pending", "Available", "Note"].map((h) => <th key={h} className="pb-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{bal?.filter((b) => b.leave_type !== "LOP").map((b) => (
            <tr key={b.leave_type} className="border-t border-hair">
              <td className="py-2.5 font-semibold">{b.name}</td><td className="num">{b.opening}</td><td className="num">{b.accrued}</td>
              <td className="num">{b.used}</td><td className="num">{b.pending}</td><td className="num font-semibold text-plum">{b.available}</td><td className="text-muted">{b.note}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className="card">
        <h2 className="m-0 mb-2 text-lg font-semibold">Requests</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted">{["#", "Type", "Dates", "Days", "Reason", "Source", "Status", ""].map((h) => <th key={h} className="pb-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{reqs?.map((r) => (
            <tr key={r.id} className="border-t border-hair">
              <td className="py-2.5 text-muted">{r.id}</td><td>{r.leave_type}</td>
              <td>{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`}</td><td className="num">{r.days}</td>
              <td>{r.reason}</td><td>{r.source === "chat" ? <span className="pill bg-lilac-soft text-plum">chat</span> : "hrms"}</td><td><Status s={r.status} /></td>
              <td>{r.status === "pending" && <button className="btn2 !min-h-8 !text-xs" onClick={() => post(`/hrms/leave/requests/${r.id}/cancel?emp_id=${emp}`).then(reload)}>Cancel</button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
