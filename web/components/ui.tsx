import { ReactNode } from "react";

export const STATUS: Record<string, string> = {
  pending: "bg-gold-soft text-gold-ink border border-gold",
  approved: "bg-lilac text-plum",
  rejected: "bg-red-50 text-danger",
  cancelled: "bg-hair text-muted",
  open: "bg-gold-soft text-gold-ink border border-gold",
  picked_up: "bg-lilac text-plum",
  resolved: "bg-hair text-muted",
};

export function Status({ s }: { s: string }) {
  return <span className={`pill ${STATUS[s] ?? "bg-hair"}`}>{s.replace("_", " ")}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card flex flex-col gap-1.5">
      <span className="eb">{label}</span>
      <span className="num text-3xl font-semibold leading-tight">{value}</span>
      {sub && <span className="text-muted text-[13px]">{sub}</span>}
    </div>
  );
}

export function Title({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eb">{eyebrow}</span>
      <h1 className="m-0 text-[32px] font-semibold tracking-tight">{children}</h1>
    </div>
  );
}
