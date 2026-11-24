"use client";

import { useState } from "react";
import { Card, PageHeader, Status, Table } from "@/components/ui";
import { addDays, fmtShort, inr, reimbursements } from "@/lib/data";
import { useFetch, useMe, useStore } from "@/lib/store";

type Slips = {
  structure: { basic: number; hra: number; special_allowance: number; employee_pf: number; professional_tax: number; tds: number };
  payslips: { month: string; gross: number; deductions: number; lop_days: number; lop_amount: number; net_pay: number }[];
};
const label = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function PayslipsPage() {
  const s = useStore();
  const ME = useMe();
  const data = useFetch<Slips>(`/hrms/payslips?emp_id=${ME}`);
  const [key, setKey] = useState("");
  if (!data) return <PageHeader title="Payslips" sub="Loading from KonnektHRMS" />;
  const slip = data.payslips.find((p) => p.month === key) ?? data.payslips[0];
  const st = data.structure;
  const earnings: [string, number][] = [["Basic", st.basic], ["House rent allowance", st.hra], ["Special allowance", st.special_allowance]];
  const deductions: [string, number][] = [["Provident fund", st.employee_pf], ["Professional tax", st.professional_tax], ["Income tax (TDS)", st.tds]];
  if (slip.lop_amount) deductions.push([`Loss of pay (${slip.lop_days} day)`, slip.lop_amount]);

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
                aria-pressed={m.month === slip.month}
                className={`press min-h-11 shrink-0 rounded-xl px-3 text-left text-sm ${m.month === slip.month ? "bg-raised font-medium" : "text-muted hover:text-ink"}`}
              >
                {label(m.month)}
              </button>
            ))}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card title={label(slip.month)} aside="Illustrative figures from hrms.db">
            <div className="grid gap-6 sm:grid-cols-2">
              {([["Earnings", earnings], ["Deductions", deductions]] as const).map(([title, rows]) => (
                <dl key={title} className="space-y-1.5 text-sm">
                  <dt className="mb-2 font-medium">{title}</dt>
                  {rows.map(([l, a]) => (
                    <div key={l} className="flex justify-between gap-4">
                      <span className="text-muted">{l}</span>
                      <span className="font-mono">{inr(a)}</span>
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

          <Card title="Reimbursements" aside="Sample data">
            <Table
              head={["Claim", "What", "Amount", "Filed", "Status"]}
              rows={reimbursements.map((r) => [
                <span key="id" className="font-mono text-xs">{r.id}</span>,
                r.what,
                <span key="a" className="font-mono">{inr(r.amount)}</span>,
                fmtShort(addDays(r.filed)),
                <Status key="s" status={r.status} waitingOn="Finance" />,
              ])}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
