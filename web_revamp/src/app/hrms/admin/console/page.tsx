"use client";

import { useState } from "react";
import { PulseBars } from "@/components/PulseBars";
import { AgentFace, Button, Card, PageHeader, Status } from "@/components/ui";
import { fmtTime } from "@/lib/data";
import { resetDemo, resolveHandover, runJob, setOffline, useStore } from "@/lib/store";

export default function ConsolePage() {
  const s = useStore();
  const [ran, setRan] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const open = s.handovers.filter((h) => h.status === "open");
  const config = s.config ?? { force_offline: false, agents: {} };
  const offline = config.force_offline;
  // The agents that can be external: every agent the backend has a URL setting for.
  const external = s.meta.agents.filter((a) => a.id in config.agents);

  return (
    <>
      <PageHeader title="HRKonnekt Console" sub="What the bot handed to people, what it couldn't answer, and the timed jobs.">
        <div className="flex flex-wrap items-center gap-2">
          {external.map((a) => (
            <span key={a.id} className={`rounded-full px-3 py-1 text-xs ${config.agents[a.id] && !offline ? "bg-violet-soft text-violet" : "bg-raised text-muted"}`}>
              {a.name}: {config.agents[a.id] && !offline ? "external" : "offline stub"}
            </span>
          ))}
          <Button variant="ghost" onClick={() => setOffline(!offline)}>
            {offline ? "Use external agents" : "Force offline"}
          </Button>
          {confirmReset ? (
            <>
              <Button
                disabled={busy === "reset"}
                onClick={async () => {
                  setBusy("reset");
                  await resetDemo().finally(() => setBusy(""));
                  setConfirmReset(false);
                  setRan({});
                }}
              >
                {busy === "reset" ? "Resetting" : "Yes, reset everything"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                Keep data
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmReset(true)}>
              Reset demo
            </Button>
          )}
        </div>
      </PageHeader>
      <div className="grid gap-4 px-4 md:px-8">
        <Card title="Run a job now" aside="The scheduler runs these on a timer. In the demo, run them here.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {s.meta.jobs.map((j) => (
              <div key={j.name} className="flex flex-col gap-2 rounded-[16px] bg-raised p-4">
                <div className="font-display font-semibold">{j.label}</div>
                <p className="flex-1 text-xs text-muted">{j.what}</p>
                {ran[j.name] && <p className="text-xs text-green">{ran[j.name]}</p>}
                <Button
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(j.name);
                    try {
                      const sent = await runJob(j.name);
                      setRan((r) => ({ ...r, [j.name]: sent.length ? `Sent: ${sent.slice(0, 3).join(", ")}${sent.length > 3 ? ` +${sent.length - 3}` : ""}` : "Nobody due today" }));
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  {busy === j.name ? "Running" : "Run now"}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Handovers" aside={`${open.length} open`}>
            <ul className="divide-y divide-line">
              {s.handovers.slice(0, 10).map((h) => (
                <li key={h.id} className="rise flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {h.sensitive ? <span className="text-red">Sensitive, the bot did not answer. </span> : null}
                      {h.topic}
                    </div>
                    <div className="text-xs text-muted">
                      {h.employeeName}, {fmtTime(h.at)}, {h.category}, <span className="font-mono">#{h.id}</span>
                      {h.assignedName && h.status !== "open" ? `, by ${h.assignedName}` : ""}
                    </div>
                  </div>
                  {h.status === "open" ? (
                    <Button variant="ghost" onClick={() => resolveHandover(h.id)}>
                      Mark resolved
                    </Button>
                  ) : (
                    <Status status="resolved" />
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Questions HRKonnekt couldn't answer" aside="Add these to a policy">
            <ul className="divide-y divide-line">
              {s.unanswered.map((u) => (
                <li key={u.q} className="flex justify-between gap-3 py-2.5 text-sm">
                  <span>
                    {u.q} <span className="text-xs text-muted">{u.team}</span>
                  </span>
                  <span className="whitespace-nowrap text-muted">
                    {u.count} {u.count === 1 ? "time" : "times"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Company pulse" aside="Team and week only, never names">
            <PulseBars rows={s.pulse.company} min={s.meta.pulse.min_answers} max={s.meta.pulse.scale_max} />
          </Card>

          <Card title="Usage">
            <ul className="space-y-3">
              {s.usage.map((u) => (
                <li key={u.agent} className="flex items-center gap-3 text-sm">
                  <AgentFace agent={u.agent} size={28} />
                  <span className="flex-1">
                    {u.name} <span className="text-xs text-muted">{u.what}</span>
                  </span>
                  <span className="font-display font-semibold">{u.count}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-5 mb-2 text-sm">Audit log</h3>
            <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
              {s.audit.map((a, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    <span className="font-medium">{a.who}</span> <span className="font-mono text-xs text-muted">{a.what}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted">{fmtTime(a.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
