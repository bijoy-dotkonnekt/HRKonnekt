"use client";
import { useState } from "react";
import { Any, post } from "@/lib/api";

const TONE: Record<string, string> = {
  nudge: "bg-gold-soft border-gold",
  checkin: "bg-gold-soft border-gold",
  handover: "bg-gold-soft border-gold",
  status: "bg-lilac-soft border-lilac",
};

export default function Card({ card, empId, onDone }: { card: Any; empId: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = card.state !== "closed";
  const total = (card.options ?? []).reduce((s: number, o: Any) => s + o.votes, 0);

  async function tap(b: Any) {
    setBusy(true);
    setErr("");
    try {
      await post("/bot/actions", { emp_id: empId, card_id: card.id, action: b.action, value: b.value ?? null });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-2 rounded-[6px_20px_20px_20px] border px-4 py-3 text-[15px] min-w-0 sm:min-w-[380px] max-w-[520px] ${TONE[card.kind] ?? "bg-paper border-hair"}`}>
      <span className="eb" style={{ fontSize: 10.5, color: card.kind === "nudge" ? "var(--gold-ink)" : "var(--plum)" }}>
        {card.kind.replace("_", " ")}
      </span>
      <b className="font-semibold">{card.title}</b>
      {card.lines?.map((l: string, i: number) => (
        <span key={i} className="leading-snug">{l}</span>
      ))}
      {card.facts?.length > 0 && (
        <div className="flex flex-col">
          {card.facts.map(([k, v]: string[], i: number) => (
            <div key={i} className={`flex justify-between gap-4 py-1.5 text-sm ${i ? "border-t border-hair" : ""}`}>
              <span className="text-muted">{k}</span>
              <b className="font-semibold text-right">{v}</b>
            </div>
          ))}
        </div>
      )}
      {card.options && (
        <div className="flex flex-col gap-2">
          {card.options.map((o: Any) => (
            <div key={o.label} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm"><span>{o.label}</span><b>{o.votes}</b></div>
              <div className="h-2 rounded-full bg-hair">
                <div className="h-2 rounded-full bg-purple transition-all" style={{ width: total ? `${(o.votes / total) * 100}%` : 0 }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {open && card.buttons?.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {card.buttons.map((b: Any) => (
            <button key={b.label} disabled={busy || !card.can_act} onClick={() => tap(b)}
              className={b.style === "primary" || card.kind === "poll" ? "btn" : b.style === "danger" ? "btn2 !text-danger" : "btn2"}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {open && !card.can_act && card.buttons?.length > 0 && <span className="text-xs text-muted">These buttons are for someone else.</span>}
      {!open && card.result && <span className="text-sm font-semibold text-plum">{card.result}</span>}
      {err && <span className="text-sm text-danger">{err}</span>}
    </div>
  );
}
