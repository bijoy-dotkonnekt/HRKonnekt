"use client";

import type { PulseRow } from "@/lib/store";

// Weekly pulse averages, already aggregated and anonymity-checked by the backend. Hidden weeks render as a dashed slot.
export function PulseBars({ rows, min, max }: { rows: PulseRow[]; min: number; max: number }) {
  return (
    <div>
      <div className="flex h-48 items-end gap-3" role="img" aria-label={rows.map((r) => `${r.label}: ${r.shown && r.avg !== null ? r.avg.toFixed(1) : "hidden"}`).join(", ")}>
        {rows.map((r) => (
          <div key={r.week} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="font-display text-sm font-semibold">{r.shown && r.avg !== null ? r.avg.toFixed(1) : ""}</span>
            <div
              className={`w-full max-w-14 rounded-t-lg transition-all duration-200 ${r.shown ? "bg-violet" : "border border-dashed border-line"}`}
              style={{ height: r.shown && r.avg !== null ? `${(r.avg / max) * 75}%` : "22%" }}
              title={r.shown ? `${r.answers} answers` : `Hidden: fewer than ${min} answers`}
            />
            <span className="whitespace-nowrap text-xs text-muted">{r.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Weeks with fewer than {min} answers stay hidden so no one can be singled out.</p>
    </div>
  );
}
