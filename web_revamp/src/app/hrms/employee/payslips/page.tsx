"use client";

import { useState } from "react";
import { Card, PageHeader, Status, Table } from "@/components/ui";
import { fmtShort, inr } from "@/lib/data";
import { useFetch, useMe, useStore } from "@/lib/store";

type Line = { label: string; amount: number };
type Slips = { payslips: { month: string; label: string; gross: number; net_pay: number; earnings: Line[]; deductions: Line[] }[] };
type Claim = { id: number; code: string; description: string; amount: number; filed_on: string; status: string; handled_by: string };

export default function PayslipsPage() {
  const s = useStore();
  const ME = useMe();
  const data = useFetch<Slips>(`/hrms/payslips?emp_id=${ME}`);
  const claims = useFetch<Claim[]>("/hrms/reimbursements");
  const [key, setKey] = useState("");
  if (!data) return <PageHeader title="Payslips" sub="Loading from KonnektHRMS" />;
  const slip = data.payslips.find((p) => p.month === key) ?? data.payslips[0];

  return (
    <>
      <PageHeader title="Payslips" sub={`${s.me.name}, ${s.me.title}, ${s.me.dept}`} />
      <div className="grid gap-4 px-4 md:px-8 lg:grid-cols-[16rem_1fr]">
        <Card title="Months">
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {data.payslips.map((m) => (
              <button
                key={m.month}
                onClick={() => setKey(m.month)}
                aria-pressed={m.month === slip?.month}
                className={`press min-h-11 shrink-0 rounded-xl px-3 text-left text-sm ${m.month === slip?.month ? "bg-raised font-medium" : "text-muted hover:text-ink"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Card>

        <div className="grid gap-4">
          {slip ? (
            <Card title={slip.label} aside="From KonnektHRMS">
              <div className="grid gap-6 sm:grid-cols-2">
                {([["Earnings", slip.earnings], ["Deductions", slip.deductions]] as const).map(([title, rows]) => (
                  <dl key={title} className="space-y-1.5 text-sm">
                    <dt className="mb-2 font-medium">{title}</dt>
                    {rows.map((l) => (
                      <div key={l.label} className="flex justify-between gap-4">
                        <span className="text-muted">{l.label}</span>
                        <span className="font-mono">{inr(l.amount)}</span>
                      </div>
                    ))}
                  </dl>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4">
                <span className="text-sm text-muted">Gross {inr(slip.gross)}</span>
                <span className="font-display text-2xl font-semibold">
                  Net pay <span className="font-mono">{inr(slip.net_pay)}</span>
                </span>
              </div>
            </Card>
          ) : (
            <Card title="No payslips yet">
              <p className="text-sm text-muted">Your first payslip appears after your first payroll run.</p>
            </Card>
          )}

          <Card title="Reimbursements">
            <Table
              head={["Claim", "What", "Amount", "Filed", "Status"]}
              rows={(claims ?? []).map((r) => [
                <span key="id" className="font-mono text-xs">{r.code}</span>,
                r.description,
                <span key="a" className="font-mono">{inr(r.amount)}</span>,
                fmtShort(r.filed_on),
                <Status key="s" status={r.status} waitingOn={r.handled_by} />,
              ])}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
