"use client";
import { useState } from "react";
import { Any, post, usePoll } from "@/lib/api";
import { Status, Title } from "@/components/ui";

const JOBS: [string, string][] = [
  ["birthdays", "Birthday posts → #general"],
  ["anniversaries", "Work anniversaries → #general"],
  ["checkins", "30-day check-ins → new joiner DM"],
  ["leave_nudges", "Leave nudges → opted-in DMs"],
  ["badminton_poll", "Activity poll → #badminton"],
];

export default function Console() {
  const [hand] = usePoll<Any[]>("/bot/admin/handovers");
  const [unans] = usePoll<Any[]>("/bot/admin/unanswered");
  const [pulse] = usePoll<Any[]>("/bot/admin/pulse", 10000);
  const [audit] = usePoll<Any[]>("/bot/admin/audit?limit=12");
  const [cfg, reloadCfg] = usePoll<Any>("/bot/admin/config", 10000);
  const [last, setLast] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  async function run(job: string) {
    setBusy(job);
    try {
      const r = await post(`/bot/jobs/${job}/run`);
      setLast((l) => ({ ...l, [job]: r.sent.length ? `Sent: ${r.sent.slice(0, 4).join(", ")}${r.sent.length > 4 ? ` +${r.sent.length - 4}` : ""}` : "Nobody due today" }));
    } finally {
      setBusy("");
    }
  }
  async function reset() {
    if (!confirm("Reset all demo data to the seed?")) return;
    setBusy("reset");
    await post("/bot/reset").finally(() => setBusy(""));
    setLast({});
  }

  const weeks = [...new Set((pulse ?? []).map((p) => p.week))].sort();
  const latest = weeks.at(-1);
  const teams = (pulse ?? []).filter((p) => p.week === latest);
  const open = hand?.filter((h) => h.status === "open") ?? [];

  return (
    <>
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <Title eyebrow="HR only · reads /bot/admin">HRKonnekt Console</Title>
        <div className="flex gap-2 items-center flex-wrap">
          {cfg && ["hr", "bonding", "wellness"].map((a) => (
            <span key={a} className={`pill ${cfg.agents[a] && !cfg.force_offline ? "bg-lilac text-plum" : "bg-hair text-muted"}`}>
              {a} agent · {cfg.agents[a] && !cfg.force_offline ? "external" : "offline stub"}
            </span>
          ))}
          <button className="btn2 !min-h-8 !text-xs" onClick={() => post("/bot/admin/offline", { force_offline: !cfg?.force_offline }).then(reloadCfg)}>
            {cfg?.force_offline ? "Use external agents" : "Force offline"}
          </button>
          <button className="btn2 !min-h-8 !text-xs !text-danger" disabled={busy === "reset"} onClick={reset}>Reset demo</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={`card flex flex-col gap-2 ${open.length ? "!border-[#D9A514]" : ""}`}>
          <div className="flex justify-between items-center">
            <h2 className="m-0 text-lg font-semibold">Handovers</h2>
            <span className="pill bg-gold-soft text-gold-ink border border-gold">{open.length} open</span>
          </div>
          {hand?.slice(0, 6).map((h) => (
            <div key={h.id} className={`p-3.5 rounded-2xl flex flex-col gap-1 ${h.status === "open" ? "bg-gold-soft" : "border-t border-hair rounded-none"}`}>
              <div className="flex justify-between gap-2 flex-wrap text-sm">
                <b className="font-semibold">{h.employee_name} · {h.department}</b>
                <span className="flex gap-2 items-center text-muted text-[12.5px]">{h.created_at.slice(5, 16).replace("T", " ")} · {h.category} <Status s={h.status} /></span>
              </div>
              <p className="m-0 text-sm leading-normal">&ldquo;{h.summary}&rdquo;</p>
              {h.assigned_name && <span className="text-muted text-[12.5px]">Picked up by {h.assigned_name}</span>}
            </div>
          ))}
          <span className="text-muted text-xs">Pick up handovers from the #hr-private channel in chat (as Ananya).</span>
        </div>
        <div className="card flex flex-col">
          <h2 className="m-0 mb-2 text-lg font-semibold">Questions the bot couldn&apos;t answer</h2>
          {unans?.map((u) => (
            <div key={u.id} className="flex justify-between gap-3 py-2.5 border-t border-hair text-sm">
              <span>{u.question} <span className="text-muted text-xs">· {u.team}</span></span><b className="font-semibold whitespace-nowrap">asked {u.times_asked}×</b>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="card col-span-2 flex flex-col gap-3">
          <div className="flex justify-between items-center"><h2 className="m-0 text-lg font-semibold">Pulse by team</h2><span className="text-muted text-[12.5px]">{latest} · anonymous</span></div>
          {teams.map((t) => (
            <div key={t.team} className="flex flex-col gap-1">
              <div className="flex justify-between text-[13px]"><span>{t.team} · {t.n} answers</span><b>{t.avg ? `${t.avg} / 5` : "Not enough answers"}</b></div>
              <div className="h-2 rounded-full bg-hair">{t.avg && <div className="h-2 rounded-full bg-purple" style={{ width: `${(t.avg / 5) * 100}%` }} />}</div>
            </div>
          ))}
          <span className="text-muted text-xs">Teams with fewer than 5 answers are hidden, so no one can be identified.</span>
        </div>
        <div className="card col-span-3 flex flex-col gap-3">
          <div className="flex justify-between items-center"><h2 className="m-0 text-lg font-semibold">Run a job now</h2><span className="text-muted text-[12.5px] font-mono">POST /bot/jobs/&#123;name&#125;/run</span></div>
          <div className="grid grid-cols-2 gap-2.5">
            {JOBS.map(([k, label]) => (
              <button key={k} onClick={() => run(k)} disabled={!!busy}
                className="flex flex-col items-start gap-1 min-h-[72px] px-3.5 py-3 rounded-2xl border border-ink/15 bg-bg text-left disabled:opacity-50">
                <span className="font-semibold text-sm">{busy === k ? "Running…" : `▶ ${label}`}</span>
                <span className="font-mono text-xs text-muted">{k}</span>
                {last[k] && <span className="text-xs text-plum font-semibold">{last[k]}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="m-0 mb-2 text-lg font-semibold">Audit log</h2>
        {audit?.map((a) => (
          <div key={a.id} className="grid grid-cols-[150px_160px_1fr] gap-3 py-1.5 border-t border-hair text-xs font-mono">
            <span className="text-muted">{a.created_at.slice(5, 19).replace("T", " ")}</span><span>{a.actor}</span><span>{a.action} {a.target}</span>
          </div>
        ))}
      </div>
    </>
  );
}
