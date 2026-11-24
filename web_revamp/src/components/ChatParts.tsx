"use client";
// Message bubbles and the button cards HRKonnekt sends. Card buttons call the backend's no-AI button handlers.

import Link from "next/link";
import { AgentFace, Button, Face, Toggle, agentName } from "@/components/ui";
import { empById, fmtTime, inr } from "@/lib/data";
import { balance, tapCard, type Msg, type State } from "@/lib/store";

export function Message({ m, pid, s, isDm }: { m: Msg; pid: string; s: State; isDm: boolean }) {
  if (m.from === pid && isDm)
    return (
      <div className="rise ml-auto w-fit max-w-[80%] rounded-[18px] rounded-br-md bg-raised px-4 py-2.5 text-sm whitespace-pre-line">
        {m.text}
      </div>
    );
  const bot = m.from === "bot";
  const name = bot ? "HRKonnekt" : (empById(m.from)?.name ?? m.from);
  return (
    <div className="rise flex max-w-[44rem] gap-3">
      {bot ? <AgentFace agent={m.agent ?? "hr"} /> : <Face name={name} />}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
          <span className="text-sm font-medium text-ink">{name}</span>
          {bot && m.agent && <span className="text-violet">{agentName[m.agent]}</span>}
          <span>{fmtTime(m.at)}</span>
        </div>
        {m.text && <p className="text-sm leading-relaxed whitespace-pre-line">{m.text}</p>}
        {m.card && <CardView m={m} pid={pid} s={s} />}
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{k}</div>
      <div className="text-sm font-medium">{v}</div>
    </div>
  );
}

function Done({ text }: { text: string }) {
  return <p className="text-sm text-green">{text}</p>;
}

const FactGrid = ({ facts }: { facts: [string, string][] }) => (
  <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
    {facts.map(([k, v]) => (
      <Fact key={k} k={k} v={v} />
    ))}
  </div>
);

function CardView({ m, pid, s }: { m: Msg; pid: string; s: State }) {
  const c = m.card!;
  const tap = (a: string) => tapCard(m, a, pid);
  const shell = (children: React.ReactNode) => <div className="mt-3 rounded-[16px] border border-line bg-cell p-4">{children}</div>;
  // Buttons only for the person the card is for; everyone else sees the outcome.
  const buttons = (opts: [string, string, ("primary" | "ghost")?][]) =>
    m.done ? (
      <Done text={m.done} />
    ) : m.canAct === false ? (
      <p className="text-xs text-muted">Waiting for the right person to answer.</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {opts.map(([a, label, v], i) => (
          <Button key={a} variant={v ?? (i === 0 ? "primary" : "ghost")} onClick={() => tap(a)}>
            {label}
          </Button>
        ))}
      </div>
    );

  switch (c.kind) {
    case "leaveConfirm":
      return shell(
        <>
          <FactGrid facts={c.facts} />
          {buttons([["yes", "Confirm"], ["change", "Cancel"]])}
        </>,
      );
    case "leaveApprove":
      return shell(
        <>
          <div className="mb-2 text-sm font-medium">{c.title}</div>
          <FactGrid facts={c.facts} />
          {buttons([["approved", "Approve"], ["rejected", "Reject"]])}
        </>,
      );
    case "payslip":
      return shell(
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-display font-semibold">{c.title}</span>
            <span className="text-xs text-muted">From KonnektHRMS</span>
          </div>
          <dl className="space-y-1 text-sm">
            {[...c.earnings, ...c.deductions.map(([l, a]) => [l, -a] as [string, number])].map(([l, a]) => (
              <div key={l} className="flex justify-between gap-4">
                <dt className="text-muted">{l}</dt>
                <dd className="font-mono">{inr(a)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 font-medium">
              <dt>Net pay</dt>
              <dd className="font-mono">{inr(c.net)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">Gross {inr(c.gross)}. Rendered by a card template from KonnektHRMS; never sent to the AI model.</p>
          <Link href="/hrms/employee/payslips" className="mt-2 inline-block text-sm text-gold">
            Open in KonnektHRMS
          </Link>
        </>,
      );
    case "poll": {
      const total = c.options.reduce((n, o) => n + o.votes, 0) || 1;
      return shell(
        <div className="space-y-2">
          <div className="text-sm font-medium">{c.title}</div>
          {c.options.map((o, i) => (
            <button
              key={o.label}
              onClick={() => tap(String(i))}
              disabled={m.canAct === false || !!m.done}
              className="press relative block min-h-11 w-full overflow-hidden rounded-xl border border-line px-3 text-left text-sm hover:border-gold disabled:hover:border-line"
            >
              <span className="absolute inset-y-0 left-0 bg-gold-soft transition-all duration-200" style={{ width: `${(o.votes / total) * 100}%` }} />
              <span className="relative flex min-h-11 items-center justify-between gap-2">
                <span>{o.label}</span>
                <span className="text-muted">{o.votes}</span>
              </span>
            </button>
          ))}
          <p className="text-xs text-muted">{m.canAct === false ? "Only group members can vote." : "Tap a slot to vote. Tap another to change it."}</p>
        </div>,
      );
    }
    case "pulse":
      return shell(
        m.done ? (
          <Done text={m.done} />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {["Rough", "Meh", "Okay", "Good", "Great"].map((l, i) => (
                <button key={l} onClick={() => tap(String(i + 1))} className="press flex min-h-11 min-w-16 flex-col items-center justify-center rounded-xl border border-line px-3 py-1.5 hover:border-gold">
                  <span className="font-display font-semibold">{i + 1}</span>
                  <span className="text-xs text-muted">{l}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Saved with your team and the week only. No name.</p>
          </>
        ),
      );
    case "checkin":
      return shell(buttons([["Settling in well", "Settling in well"], ["Okay so far", "Okay so far", "ghost"], ["Finding it hard", "Finding it hard", "ghost"]]));
    case "nudge":
      return shell(
        <>
          {c.lines.map((l) => (
            <p key={l} className="mb-2 text-sm">{l}</p>
          ))}
          {buttons([["find", "Find a day"], ["later", "Not now"], ["stop", "Stop these nudges"]])}
        </>,
      );
    case "handoverNotice":
      return shell(
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{c.from}</span>
            <span className="text-xs text-muted">{c.title}</span>
          </div>
          <blockquote className="mb-3 border-l-2 border-line pl-3 text-sm text-muted">{c.topic}</blockquote>
          {buttons([["resolve", "Mark resolved"]])}
        </>,
      );
    case "myData": {
      const groups = Object.entries(s.groups).filter(([, ids]) => ids.includes(pid)).map(([g]) => g);
      const prefs = s.prefs;
      return shell(
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact k="Profile, from KonnektHRMS" v={`${s.me.title}, ${s.me.dept}. Manager: ${s.me.managerId ? (empById(s.me.managerId)?.name ?? "none") : "none"}`} />
            <Fact k="Leave left" v={balance(s, pid).map((b) => `${b.left} ${b.type.toLowerCase()}`).join(", ")} />
            <Fact k="Groups" v={groups.join(", ") || "None"} />
            <Fact k="Reminders" v={prefs.reminders.join("; ") || "None"} />
          </div>
          {([["wellness", "Wellness features", prefs.wellness], ["nudges", "Leave nudges", prefs.nudges], ["birthday", "Birthday post in #general", prefs.birthday]] as const).map(([k, label, on]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span>{label}</span>
              <Toggle on={on} onChange={() => tap(k)} label={label} />
            </div>
          ))}
          <p className="text-xs text-muted">Not stored: PAN, Aadhaar, bank details, or your pulse answers with your name.</p>
        </div>,
      );
    }
    case "info":
      return shell(
        <>
          {c.title && <div className="mb-1 text-sm font-medium">{c.title}</div>}
          {c.lines.map((l) => (
            <p key={l} className="text-sm text-muted">{l}</p>
          ))}
          {c.facts.length > 0 && <div className="mt-2"><FactGrid facts={c.facts} /></div>}
          {m.done && <Done text={m.done} />}
        </>,
      );
  }
}
