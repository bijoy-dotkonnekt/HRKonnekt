"use client";
// Message bubbles and the cards HRKonnekt sends. A card brings its own title, lines, facts and buttons from the backend;
// tapping a button sends its action and value back to the no-AI button handlers.

import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { AgentFace, Button, Face, Toggle } from "@/components/ui";
import { empById, fmtTime, inr } from "@/lib/data";
import { agentInfo, balance, tapCard, type Msg, type State } from "@/lib/store";

export function Message({ m, pid, s, isDm }: { m: Msg; pid: string; s: State; isDm: boolean }) {
  if (m.from === pid && isDm)
    return (
      <div className="rise ml-auto w-fit max-w-[80%] rounded-[18px] rounded-br-md bg-raised px-4 py-2.5 text-sm whitespace-pre-line">
        {m.text}
      </div>
    );
  const bot = m.from === "bot";
  const agent = agentInfo(s, m.agent);
  const name = bot ? "HRKonnekt" : (empById(m.from)?.name ?? m.from);
  return (
    <div className="rise flex max-w-[44rem] gap-3">
      {bot ? <AgentFace agent={m.agent ?? ""} /> : <Face name={name} />}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
          <span className="text-sm font-medium text-ink">{name}</span>
          {bot && agent && <span className="text-violet">{agent.name}</span>}
          <span>{fmtTime(m.at)}</span>
        </div>
        {m.text && (bot ? <Markdown text={m.text} /> : <p className="text-sm leading-relaxed whitespace-pre-line">{m.text}</p>)}
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

function CardView({ m, pid, s }: { m: Msg; pid: string; s: State }) {
  const c = m.card!;
  const buttons = c.buttons ?? [];
  return (
    <div className="mt-3 space-y-3 rounded-[16px] border border-line bg-cell p-4">
      {(c.title || c.source_label) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {c.title && <span className="font-display font-semibold">{c.title}</span>}
          {c.source_label && <span className="text-xs text-muted">{c.source_label}</span>}
        </div>
      )}
      {c.lines?.map((l) => (
        <p key={l} className="text-sm">{l}</p>
      ))}
      {c.facts && c.facts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {c.facts.map(([k, v]) => (
            <Fact key={k} k={k} v={v} />
          ))}
        </div>
      )}

      {c.earnings && (
        <dl className="space-y-1 text-sm">
          {[...c.earnings, ...(c.deductions ?? []).map(([l, a]) => [l, -a] as [string, number])].map(([l, a]) => (
            <div key={l} className="flex justify-between gap-4">
              <dt className="text-muted">{l}</dt>
              <dd className="font-mono">{inr(a)}</dd>
            </div>
          ))}
          {c.net !== undefined && (
            <div className="flex justify-between border-t border-line pt-2 font-medium">
              <dt>Net pay</dt>
              <dd className="font-mono">{inr(c.net)}</dd>
            </div>
          )}
          {c.gross !== undefined && <p className="pt-1 text-xs text-muted">Gross {inr(c.gross)}</p>}
        </dl>
      )}

      {c.kind === "my_data" && <MyData s={s} pid={pid} m={m} />}

      {c.options ? (
        <Poll m={m} />
      ) : m.done ? (
        <p className="text-sm text-green">{m.done}</p>
      ) : buttons.length > 0 && c.kind !== "my_data" ? (
        m.canAct === false ? (
          <p className="text-xs text-muted">Waiting for the right person to answer.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {buttons.map((b, i) => (
              <Button key={`${b.action}-${b.value ?? i}`} variant={b.style === "primary" ? "primary" : "ghost"} onClick={() => tapCard(m, b.action, b.value)}>
                {b.label}
              </Button>
            ))}
          </div>
        )
      ) : null}

      {c.note && <p className="text-xs text-muted">{c.note}</p>}
      {c.link && (
        <Link href={c.link} className="inline-block text-sm text-gold">
          Open in KonnektHRMS
        </Link>
      )}
    </div>
  );
}

function Poll({ m }: { m: Msg }) {
  const c = m.card!;
  const options = c.options ?? [];
  const total = options.reduce((n, o) => n + o.votes, 0) || 1;
  const button = (label: string) => c.buttons?.find((b) => b.value === label);
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const b = button(o.label);
        return (
          <button
            key={o.label}
            onClick={() => b && tapCard(m, b.action, b.value)}
            disabled={m.canAct === false || !!m.done || !b}
            className="press relative block min-h-11 w-full overflow-hidden rounded-xl border border-line px-3 text-left text-sm hover:border-gold disabled:hover:border-line"
          >
            <span className="absolute inset-y-0 left-0 bg-gold-soft transition-all duration-200" style={{ width: `${(o.votes / total) * 100}%` }} />
            <span className="relative flex min-h-11 items-center justify-between gap-2">
              <span>{o.label}</span>
              <span className="text-muted">{o.votes}</span>
            </span>
          </button>
        );
      })}
      <p className="text-xs text-muted">{m.canAct === false ? "Only group members can vote." : "Tap a slot to vote. Tap another to change it."}</p>
    </div>
  );
}

// What HRKonnekt keeps about you: the facts come from the live state, the toggles from the card's buttons and prefs.
function MyData({ s, pid, m }: { s: State; pid: string; m: Msg }) {
  const groups = Object.entries(s.groups).filter(([, ids]) => ids.includes(pid)).map(([g]) => g);
  const action = m.card?.buttons?.[0]?.action;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Fact k="Profile, from KonnektHRMS" v={`${s.me.title}, ${s.me.dept}. Manager: ${empById(s.me.managerId)?.name ?? "none"}`} />
        <Fact k="Leave left" v={balance(s, pid).map((b) => `${b.left} ${b.type.toLowerCase()}`).join(", ")} />
        <Fact k="Groups" v={groups.join(", ") || "None"} />
        <Fact k="Reminders" v={s.prefs.reminders.join("; ") || "None"} />
      </div>
      {action &&
        s.prefs.toggles.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3">
            <span>{t.label}</span>
            <Toggle on={t.on} onChange={() => tapCard(m, action, t.key)} label={t.label} />
          </div>
        ))}
    </div>
  );
}
