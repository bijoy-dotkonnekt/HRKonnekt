"use client";

import { useState } from "react";
import { Button, Card, PageHeader, Stat, Table } from "@/components/ui";
import { avgGross, depts, employees, fmtDate, inr, iso } from "@/lib/data";

export default function PayrollPage() {
  const [locked, setLocked] = useState(false);
  const all = employees().filter((e) => e.status !== "exited");
  const rows = depts().map((d) => {
    const n = all.filter((e) => e.dept === d).length;
    const g = n * (avgGross[d] ?? 100000);
    return { d, n, g, net: Math.round(g * 0.84) };
  });
  const total = rows.reduce((a, r) => a + r.g, 0);
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
  const last = { label: lastDay.toLocaleDateString("en-US", { month: "long", year: "numeric" }), paidOn: iso(lastDay) };
  const now = new Date();
  const runDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const runIso = iso(runDay);
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader title="Payroll" sub={`${monthLabel} run, paid ${fmtDate(runIso)}`}>
        <Button onClick={() => setLocked(true)} disabled={locked}>
          {locked ? "Inputs locked" : "Lock payroll inputs"}
        </Button>
      </PageHeader>
      <div className="grid gap-4 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Gross this month" value={<span className="font-mono text-2xl">{inr(total)}</span>} />
          <Stat label="Net to pay" value={<span className="font-mono text-2xl">{inr(Math.round(total * 0.84))}</span>} />
          <Stat label="People on payroll" value={all.length} />
          <Stat label="Last run" value={last.label.split(" ")[0]} note={`Paid ${fmtDate(last.paidOn)}`} tone="green" />
        </div>
        <Card title="By department">
          <Table
            head={["Department", "People", "Gross", "Net"]}
            rows={rows.map((r) => [r.d, r.n, <span key="g" className="font-mono">{inr(r.g)}</span>, <span key="n" className="font-mono">{inr(r.net)}</span>])}
          />
          <p className="mt-3 text-xs text-muted">
            {locked ? <span className="text-red">Inputs are locked. Leave approved after this moves to next month&apos;s run. </span> : null}
            Department totals are illustrative (headcount from hrms.db × an average). Payroll figures stay inside KonnektHRMS. HRKonnekt shows payslips through card templates and never sends amounts to the AI model.
          </p>
        </Card>
      </div>
    </>
  );
}
