"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { fmtShort } from "@/lib/data";
import { get, useFetch } from "@/lib/store";

type Policy = { slug: string; title: string; version: string; updated_at: string };

// "## 2. Casual leave\n..." -> [{ title: "Section 2, Casual leave", text }]
const sections = (md: string) =>
  md
    .split(/\n## /)
    .slice(1)
    .map((chunk) => {
      const [head, ...rest] = chunk.split("\n");
      const m = head.match(/^(\d+)\.\s*(.+)$/);
      return { title: m ? `Section ${m[1]}, ${m[2]}` : head, text: rest.join(" ").trim() };
    });

export default function PoliciesPage() {
  const list = useFetch<Policy[]>("/hrms/policies");
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [file, setFile] = useState("");
  useEffect(() => {
    list?.forEach((p) => get(`/hrms/policies/${p.slug}`).then((d) => setBodies((b) => ({ ...b, [p.slug]: d.body_md }))).catch(() => {}));
  }, [list]);

  return (
    <>
      <PageHeader title="Policies" sub="The documents HRKonnekt searches. Every answer cites the section it used." />
      <div className="grid gap-4 px-4 md:px-8 lg:grid-cols-[2fr_1fr]">
        <Card title={`${list?.length ?? "…"} documents`}>
          <ul className="divide-y divide-line">
            {list?.map((p) => (
              <li key={p.slug}>
                <details className="group py-3">
                  <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3">
                    <span className="text-sm font-medium">{p.title}</span>
                    <span className="whitespace-nowrap text-xs text-muted">
                      {p.version}, updated {fmtShort(p.updated_at)}, {p.updated_at.slice(0, 4)}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {sections(bodies[p.slug] ?? "").map((s) => (
                      <div key={s.title} className="rounded-xl bg-raised p-3 text-sm">
                        <div className="font-medium">{s.title}</div>
                        <p className="text-muted">{s.text}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add a policy">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-[16px] border border-dashed border-line p-4 text-center text-sm text-muted hover:border-gold">
            {file ? <span className="text-ink">{file}</span> : "Choose a Markdown or PDF file"}
            <span className="text-xs">{file ? "Upload isn't wired in the hackathon build. Add .md files to policies/ and reset the demo." : "It gets split into sections and indexed for search."}</span>
            <input type="file" accept=".md,.pdf,.docx" className="sr-only" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} />
          </label>
        </Card>
      </div>
    </>
  );
}
