"use client";

import { Card, Decide, Face, PageHeader, Status, Table } from "@/components/ui";
import { decideLeave, leftOf, useMe, useStore } from "@/lib/store";
import { fmtShort } from "@/lib/data";

export default function ApprovalsPage() {
  const s = useStore();
  const ME = useMe();
  const team = s.requests.filter((r) => r.approverId === ME && r.status !== "cancelled");
  const pending = team.filter((r) => r.status === "pending");
  const decided = team.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader title="Approvals" sub="Requests from your team. Approving here or in chat does the same thing." />
      <div className="grid gap-4 px-4 md:px-8">
        <Card title="Waiting for you" aside={`${pending.length} open`}>
          {pending.length === 0 ? (
            <p className="py-4 text-sm text-muted">You&apos;re up to date.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((r) => {
                const name = r.employeeName;
                const left = leftOf(s, r.empId, r.code);
                return (
                  <li key={r.id} className="rise flex flex-wrap items-center gap-4 py-3">
                    <Face name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{name}</div>
                      <div className="text-sm text-muted">
                        {r.type}, {fmtShort(r.start)} to {fmtShort(r.end)}, {r.days} {r.days === 1 ? "day" : "days"}.{r.reason && <> &ldquo;{r.reason}&rdquo;</>}
                      </div>
                      <div className="text-xs text-muted">
                        {left ?? "?"} {r.type.toLowerCase()} left after this. Asked via {r.via === "chat" ? "chat" : "KonnektHRMS"}.
                      </div>
                    </div>
                    <Decide status="pending" onDecide={(d) => decideLeave(r.id, d)} waitingOn={name} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Decided">
          <Table
            head={["Who", "Type", "Dates", "Days", "Result"]}
            rows={decided.slice(0, 15).map((r) => [r.employeeName, r.type, `${fmtShort(r.start)} to ${fmtShort(r.end)}`, r.days, <Status key="s" status={r.status} />])}
          />
        </Card>
      </div>
    </>
  );
}
