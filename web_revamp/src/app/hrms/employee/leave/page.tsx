"use client";

import { useEffect, useState } from "react";
import { Button, Card, PageHeader, Stat, Status, Table } from "@/components/ui";
import { addDays, fmtShort } from "@/lib/data";
import { applyLeave, balance, previewLeave, useMe, useStore, type Preview } from "@/lib/store";

const field = "min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-gold";

export default function LeavePage() {
  const s = useStore();
  const ME = useMe();
  const f = s.meta.leave_form;
  const [code, setCode] = useState(f.default_type ?? "");
  const [start, setStart] = useState(addDays(f.start_offset_days));
  const [end, setEnd] = useState(addDays(f.end_offset_days));
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // The HRMS counts working days, checks the balance and overlaps; the form just shows what it says.
  const [preview, setPreview] = useState<{ key: string; value: Preview }>();
  const key = `${code}|${start}|${end}|${s.balances[ME]?.map((b) => b.left).join()}`;
  useEffect(() => {
    let live = true;
    previewLeave(code, start, end)
      .then((value) => live && setPreview({ key, value }))
      .catch((x) => live && setPreview({ key, value: { ok: false, days: 0, left: null, message: (x as Error).message } }));
    return () => {
      live = false;
    };
  }, [code, start, end, key]);
  const p = preview?.key === key ? preview.value : undefined;
  const mgr = s.me.managerId ? (s.people.find((e) => e.id === s.me.managerId)?.name.split(" ")[0] ?? "your manager") : "your manager";

  return (
    <>
      <PageHeader title="Leave" sub="Balances update the moment a manager approves, in chat or here." />
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-3 gap-4">
          {balance(s, ME).map((b) => (
            <Stat key={b.code} label={`${b.type} leave`} value={b.left} note={`${b.taken} of ${b.entitled} used${b.pending ? `, ${b.pending} pending` : ""}`} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card title="Apply for leave">
            <form
              className="grid gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setErr("");
                try {
                  const r = await applyLeave(code, start, end, reason);
                  setSent(`Request #${r.id} sent to ${r.approver_name?.split(" ")[0] ?? mgr}. They'll see it in chat too.`);
                  setReason("");
                } catch (x) {
                  setErr((x as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              onChange={() => {
                setSent("");
                setErr("");
              }}
            >
              <label className="grid gap-1 text-sm">
                Type
                <select value={code} onChange={(e) => setCode(e.target.value)} className={field}>
                  {s.meta.leave_types.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  From
                  <input type="date" value={start} min={addDays(0)} onChange={(e) => setStart(e.target.value)} className={field} required />
                </label>
                <label className="grid gap-1 text-sm">
                  To
                  <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={field} required />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                Reason
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" className={field} />
              </label>
              {!sent && <p className={`text-sm ${p && !p.ok ? "text-red" : "text-muted"}`}>{p ? p.message : "Checking with KonnektHRMS"}</p>}
              {err && <p role="alert" className="text-sm text-red">{err}</p>}
              {sent && <p className="text-sm text-green">{sent}</p>}
              <Button type="submit" disabled={!p?.ok || busy || !!sent}>
                {busy ? "Sending" : `Send to ${p?.approver_name?.split(" ")[0] ?? mgr}`}
              </Button>
            </form>
          </Card>

          <Card title="My requests">
            <Table
              head={["Request", "Type", "Dates", "Days", "Via", "Status"]}
              rows={s.requests
                .filter((r) => r.empId === ME && r.status !== "cancelled")
                .map((r) => [
                  <span key="id" className="font-mono text-xs">#{r.id}</span>,
                  r.type,
                  `${fmtShort(r.start)} to ${fmtShort(r.end)}`,
                  r.days,
                  r.via === "chat" ? "Chat" : "KonnektHRMS",
                  <Status key="s" status={r.status} waitingOn={r.approverName?.split(" ")[0]} />,
                ])}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
