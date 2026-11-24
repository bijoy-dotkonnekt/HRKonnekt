"use client";

import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { fmtShort } from "@/lib/data";
import { uploadPolicy, useFetch } from "@/lib/store";

type Policy = { slug: string; title: string; version: string; updated_at: string };
type Detail = Policy & { sections: { no: string; heading: string; text: string }[] };

function Sections({ slug, version }: { slug: string; version: string }) {
  const p = useFetch<Detail>(`/hrms/policies/${slug}?v=${version}`);
  if (!p) return <p className="text-sm text-muted">Loading</p>;
  return (
    <div className="mt-2 space-y-2">
      {p.sections.map((s) => (
        <div key={s.no} className="rounded-xl bg-raised p-3 text-sm">
          <div className="font-medium">
            Section {s.no}, {s.heading}
          </div>
          <p className="text-muted">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

export default function PoliciesPage() {
  const [tick, setTick] = useState(0);
  const list = useFetch<Policy[]>("/hrms/policies", tick);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setMsg(undefined);
    try {
      const p = await uploadPolicy(file.name, await file.text());
      setMsg({ ok: true, text: `${p.title} ${p.version} saved with ${p.sections} sections. HRKonnekt uses it from the next question.` });
      setTick((t) => t + 1);
    } catch (x) {
      setMsg({ ok: false, text: (x as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Policies" sub="The documents HRKonnekt searches. Every answer cites the section it used." />
      <div className="grid gap-4 px-4 md:px-8 lg:grid-cols-[2fr_1fr]">
        <Card title={`${list?.length ?? "…"} documents`}>
          <ul className="divide-y divide-line">
            {list?.map((p) => (
              <li key={p.slug}>
                <details className="group py-3" onToggle={(e) => setOpen((o) => ({ ...o, [p.slug]: (e.target as HTMLDetailsElement).open }))}>
                  <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3">
                    <span className="text-sm font-medium">{p.title}</span>
                    <span className="whitespace-nowrap text-xs text-muted">
                      {p.version}, updated {fmtShort(p.updated_at)}, {p.updated_at.slice(0, 4)}
                    </span>
                  </summary>
                  {open[p.slug] && <Sections slug={p.slug} version={p.version} />}
                </details>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add a policy">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-[16px] border border-dashed border-line p-4 text-center text-sm text-muted hover:border-gold">
            {busy ? "Uploading" : "Choose a Markdown file"}
            <span className="text-xs">A &ldquo;# Title&rdquo; line, then numbered sections like &ldquo;## 1. Leave year&rdquo;. Same file name replaces that policy.</span>
            <input
              type="file"
              accept=".md"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </label>
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm ${msg.ok ? "text-green" : "text-red"}`}>
              {msg.text}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
