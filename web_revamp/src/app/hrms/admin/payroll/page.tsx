"use client";

import { useState } from "react";
import { Button, Card, PageHeader, Stat, Table } from "@/components/ui";
import { fmtDate, inr } from "@/lib/data";
import { lockPayroll, useFetch } from "@/lib/store";

type Payroll = {
  run: { month: string; label: string; pay_date: string; status: string; locked_by: string | null } | null;
  departments: { department: string; people: number; gross: number; net: number }[];
  gross: number;
  net: number;
  people: number;
  last: { label: string; pay_date: string; net: number } | null;
  note: string;
};

export default function PayrollPage() {
  const fetched = useFetch<Payroll>("/hrms/payroll");
  const [updated, setUpdated] = useState<Payroll>();
  const [err, setErr] = useState("");
  const p = updated ?? fetched;
  if (!p) return <PageHeader title="Payroll" sub="Loading from KonnektHRMS" />;
  const run = p.run;
  const locked = run?.status !== "open";

  return (
    <>
      <PageHeader title="Payroll" sub={run ? `${run.label} run, paid ${fmtDate(run.pay_date)}` : "No open run"}>
        {run && (
          <Button
            disabled={locked}
            onClick={() =>
              lockPayroll(run.month)
                .then(setUpdated)
                .catch((x) => setErr((x as Error).message))
            }
          >
            {locked ? `Inputs locked${run.locked_by ? ` by ${run.locked_by.split(" ")[0]}` : ""}` : "Lock payroll inputs"}
          </Button>
        )}
      </PageHeader>
      <div className="grid gap-4 px-4 md:px-8">
        {err && <p role="alert" className="text-sm text-red">{err}</p>}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Gross this month" value={<span className="font-mono text-2xl">{inr(p.gross)}</span>} />
          <Stat label="Net to pay" value={<span className="font-mono text-2xl">{inr(p.net)}</span>} />
          <Stat label="People on payroll" value={p.people} />
          {p.last && <Stat label="Last run" value={p.last.label.split(" ")[0]} note={`Paid ${fmtDate(p.last.pay_date)}, ${inr(p.last.net)} net`} tone="green" />}
        </div>
        <Card title="By department">
          <Table
            head={["Department", "People", "Gross", "Net"]}
            rows={p.departments.map((r) => [r.department, r.people, <span key="g" className="font-mono">{inr(r.gross)}</span>, <span key="n" className="font-mono">{inr(r.net)}</span>])}
          />
          <p className="mt-3 text-xs text-muted">{p.note}</p>
        </Card>
      </div>
    </>
  );
}
