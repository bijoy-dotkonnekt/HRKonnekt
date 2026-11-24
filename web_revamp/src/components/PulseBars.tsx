"use client";

import { MIN_TEAM, addDays, fmtShort, parse } from "@/lib/data";
import type { Pulse } from "@/lib/store";

// "2026-W47" -> "Nov 16" (Monday of that ISO week)
export function weekLabel(w: string) {
  const [y, n] = w.split("-W").map(Number);
  const jan4 = parse(`${y}-01-04`);
  const mon = new Date(jan4.getTime() - ((jan4.getDay() + 6) % 7) * 86_400_000 + (n - 1) * 7 * 86_400_000);
  return fmtShort(addDays(0, mon));
}

export const thisWeek = () => {
  const d = new Date();
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const n = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(n).padStart(2, "0")}`;
};

export function rowsFor(pulse: Pulse[]) {
  const weeks = [...new Set([...pulse.map((p) => p.week), thisWeek()])].sort().slice(-7);
  return weeks.map((w) => {
    const ps = pulse.filter((p) => p.week === w);
    const n = ps.reduce((a, p) => a + p.n, 0);
    const shown = ps.filter((p) => p.avg != null);
    const k = shown.reduce((a, p) => a + p.n, 0);
    return { week: w === thisWeek() ? "This week" : weekLabel(w), avg: k ? shown.reduce((a, p) => a + p.avg! * p.n, 0) / k : 0, answers: k ? n : Math.min(n, MIN_TEAM - 1) };
  });
}


// Weekly pulse averages on a 1 to 5 scale. Weeks under `min` answers render as an empty dashed slot.
export function PulseBars({ rows, min = 0 }: { rows: { week: string; avg: number; answers: number }[]; min?: number }) {
  return (
    <div>
      <div className="flex h-48 items-end gap-3" role="img" aria-label={rows.map((r) => `${r.week}: ${r.answers >= min && r.answers ? r.avg.toFixed(1) : "hidden"}`).join(", ")}>
        {rows.map((r) => {
          const shown = r.answers >= min && r.answers > 0;
          return (
            <div key={r.week} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="font-display text-sm font-semibold">{shown ? r.avg.toFixed(1) : ""}</span>
              <div
                className={`w-full max-w-14 rounded-t-lg transition-all duration-200 ${shown ? "bg-violet" : "border border-dashed border-line"}`}
                style={{ height: shown ? `${(r.avg / 5) * 75}%` : "22%" }}
                title={shown ? `${r.answers} answers` : `Hidden: fewer than ${min} answers`}
              />
              <span className="whitespace-nowrap text-xs text-muted">{r.week}</span>
            </div>
          );
        })}
      </div>
      {min > 0 && <p className="mt-3 text-xs text-muted">Weeks with fewer than {min} answers stay hidden so no one can be singled out.</p>}
    </div>
  );
}
