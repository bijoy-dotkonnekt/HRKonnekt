"use client";

import { useState } from "react";
import { Button, Card, PageHeader, Table } from "@/components/ui";
import { addDays, fmtDate } from "@/lib/data";
import { addHoliday, removeHoliday, useStore } from "@/lib/store";

const field = "min-h-11 rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-gold";

export default function HolidaysPage() {
  const s = useStore();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const t = addDays(0);

  return (
    <>
      <PageHeader title="Holidays" sub="HRKonnekt reads this list when people ask about holidays or apply for leave." />
      <div className="grid gap-4 px-4 md:px-8 lg:grid-cols-[1.5fr_1fr]">
        <Card title={`${s.holidays.length} holidays`}>
          <Table
            head={["Date", "Holiday", ""]}
            rows={s.holidays.map((h) => [
              <span key="d" className={h.date < t ? "text-muted" : ""}>{fmtDate(h.date)}, {h.date.slice(0, 4)}</span>,
              h.name,
              <Button
                key="x"
                variant="quiet"
                aria-label={`Remove ${h.name}`}
                onClick={() => removeHoliday(h.date).catch((x) => setErr((x as Error).message))}
              >
                Remove
              </Button>,
            ])}
          />
        </Card>
        <Card title="Add a holiday">
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr("");
              try {
                await addHoliday(date, name);
                setDate("");
                setName("");
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Date" className={field} />
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name, for example Diwali" aria-label="Name" className={field} />
            {err && <p role="alert" className="text-sm text-red">{err}</p>}
            <Button type="submit">Add holiday</Button>
            <p className="text-xs text-muted">Then ask HRKonnekt &ldquo;Upcoming holidays&rdquo; in chat to see it.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
