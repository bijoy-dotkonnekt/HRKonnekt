"use client";

import { PulseBars } from "@/components/PulseBars";
import { Card, PageHeader } from "@/components/ui";
import { useStore } from "@/lib/store";

export default function PulsePage() {
  const s = useStore();
  const rows = s.pulse.team;
  const { min_answers: min, scale_max: max } = s.meta.pulse;
  const n = rows.at(-1)?.answers ?? 0;
  return (
    <>
      <PageHeader title="Team pulse" sub={`Weekly, anonymous, 1 to ${max}. Team averages only.`} />
      <div className="grid gap-4 px-4 md:px-8 lg:grid-cols-[2fr_1fr]">
        <Card title={`${s.me.dept}, last ${rows.length} weeks`}>
          <PulseBars rows={rows} min={min} max={max} />
        </Card>
        <Card title="This week">
          <p className="text-sm">
            {n} {n === 1 ? "answer" : "answers"} so far. {n < min ? `The average shows once ${min} people have answered.` : "Enough answers to show the average."}
          </p>
          <p className="mt-3 text-sm text-muted">HR runs the pulse job from the HRKonnekt Console; people answer in chat.</p>
        </Card>
      </div>
    </>
  );
}
