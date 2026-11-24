"use client";

import { useState } from "react";
import { Button, Card, PageHeader, Stat, Status, Table } from "@/components/ui";
import { LEAVE_TYPES, addDays, firstName, fmtShort, workingDays } from "@/lib/data";
import { applyLeave, balance, leftOf, useMe, useStore } from "@/lib/store";

const field = "min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-gold";

export default function LeavePage() {
  const s = useStore();
  const ME = useMe();
  const [code, setCode] = useState("CL");
  const [start, setStart] = useState(addDays(7));
  const [end, setEnd] = useState(addDays(8));
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const days = end >= start ? workingDays(start, end, s.holidays.map((h) => h.date)) : 0;
  const left = leftOf(s, ME, code);
  const label = LEAVE_TYPES.find((l) => l.code === code)!.type;
  const tooMany = days > left;
  const mgr = s.me.managerId ? firstName(s.me.managerId) : "your manager";

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
                  const r = await applyLeave(ME, code, start, end, reason);
                  setSent(`Request #${r.id} sent to ${mgr}. They'll see it in chat too.`);
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
                  {LEAVE_TYPES.map((l) => (
                    <option key={l.code} value={l.code}>{l.type}</option>
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
              {!sent && <p className={`text-sm ${tooMany ? "text-red" : "text-muted"}`}>
                {days} working {days === 1 ? "day" : "days"}. {tooMany ? `You only have ${left} ${label.toLowerCase()} days left.` : `${left - days} left after this.`}
              </p>}
              {err && <p role="alert" className="text-sm text-red">{err}</p>}
              {sent && <p className="text-sm text-green">{sent}</p>}
              <Button type="submit" disabled={days === 0 || tooMany || busy || !!sent}>
                {busy ? "Sending" : `Send to ${mgr}`}
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
                  <Status key="s" status={r.status === "cancelled" ? "rejected" : r.status} waitingOn={mgr} />,
                ])}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
