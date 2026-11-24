"use client";

import { PulseBars, rowsFor, thisWeek } from "@/components/PulseBars";
import { Card, PageHeader } from "@/components/ui";
import { MIN_TEAM } from "@/lib/data";
import { useStore } from "@/lib/store";

export default function PulsePage() {
  const s = useStore();
  const mine = s.pulse.filter((p) => p.team === s.me.team);
  const rows = rowsFor(mine);
  const n = mine.find((p) => p.week === thisWeek())?.n ?? 0;
  return (
    <>
      <PageHeader title="Team pulse" sub="Weekly, anonymous, 1 to 5. Team averages only." />
      <div className="grid gap-4 px-4 md:px-8 lg:grid-cols-[2fr_1fr]">
        <Card title={`${s.me.dept}, last ${rows.length} weeks`}>
          <PulseBars rows={rows} min={MIN_TEAM} />
        </Card>
        <Card title="This week">
          <p className="text-sm">
            {n} {n === 1 ? "answer" : "answers"} so far.{" "}
            {n < MIN_TEAM ? `The average shows once ${MIN_TEAM} people have answered.` : "Enough answers to show the average."}
          </p>
          <p className="mt-3 text-sm text-muted">HR runs the pulse job from the HRKonnekt Console; people answer in chat.</p>
        </Card>
      </div>
    </>
  );
}
