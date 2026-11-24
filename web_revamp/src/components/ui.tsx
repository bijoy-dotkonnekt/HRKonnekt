"use client";
// Shared Konnekt Noir building blocks for both frontends.

import { useState, useSyncExternalStore } from "react";
import type { Agent } from "@/lib/store";

const noop = () => () => {};
// Renders children only in the browser. The demo data counts from today and lives in localStorage,
// so nothing useful can be prerendered.
export function Hydrated({ children }: { children: React.ReactNode }) {
  const ready = useSyncExternalStore(noop, () => true, () => false);
  return ready ? children : (
    <div className="grid min-h-screen place-items-center" aria-label="Loading">
      <Mark state="working" size={40} />
    </div>
  );
}

// The mark: one ring and one dot. Working = violet and breathing, needs you = champagne, idle = only the dot lit.
export function Mark({ state = "idle", size = 28 }: { state?: "idle" | "working" | "needs"; size?: number }) {
  const c = state === "working" ? "var(--violet)" : state === "needs" ? "var(--gold-fill)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={state === "working" ? "breathe" : ""}>
      <path d="M23 7.2A11 11 0 1 0 23 24.8" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" opacity={state === "idle" ? 0.4 : 1} />
      <circle cx="24.5" cy="16" r="3.6" fill={state === "idle" ? "var(--gold-fill)" : c} />
    </svg>
  );
}

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("");

export function Face({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-raised font-display text-[0.8em] font-semibold text-ink ring-1 ring-line" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

export const agentName: Record<Agent, string> = { hr: "HR agent", bonding: "Bonding agent", wellness: "Wellness agent", guard: "Guard" };
const agentGlyph: Record<Agent, string> = { hr: "H", bonding: "B", wellness: "W", guard: "G" };

export function AgentFace({ agent, size = 32 }: { agent: Agent; size?: number }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-display font-semibold ${agent === "guard" ? "bg-gold-soft text-gold" : "bg-violet-soft text-violet"}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {agentGlyph[agent]}
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-6 pb-2 md:px-8 md:pt-8">
      <div>
        <h1 className="text-2xl md:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children}
    </header>
  );
}

export function Card({ title, aside, children, className = "" }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[20px] border border-line bg-cell p-5 ${className}`}>
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base">{title}</h2>
          {aside && <span className="text-xs text-muted">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: "gold" | "green" | "red" }) {
  const c = tone === "gold" ? "text-gold" : tone === "green" ? "text-green" : tone === "red" ? "text-red" : "";
  return (
    <div className="rounded-[24px] border border-line bg-cell p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold tracking-tight ${c}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet" };
export function Button({ variant = "primary", className = "", ...props }: BtnProps) {
  const style =
    variant === "primary"
      ? "bg-btn text-btn-ink hover:opacity-90"
      : variant === "ghost"
        ? "border border-line bg-transparent text-ink hover:bg-raised"
        : "text-muted hover:text-ink";
  return <button {...props} className={`press inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45 ${style} ${className}`} />;
}

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// One meaning, one shape: hollow ring = waiting on a person, check = done, cross = declined.
export function Status({ status, waitingOn }: { status: "pending" | "approved" | "rejected" | "open" | "resolved"; waitingOn?: string }) {
  if (status === "approved" || status === "resolved")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-green">
        <Check /> {status === "approved" ? "Approved" : "Resolved"}
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-red">
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Declined
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gold">
      <span className="h-2.5 w-2.5 rounded-full border-2 border-current" aria-hidden />
      {status === "open" ? "Waiting for HR" : waitingOn ? `Waiting for ${waitingOn}` : "Waiting"}
    </span>
  );
}

// Approve or reject that morphs into its result where the person clicked.
export function Decide({ status, onDecide, waitingOn }: { status: "pending" | "approved" | "rejected"; onDecide: (d: "approved" | "rejected") => void; waitingOn?: string }) {
  if (status !== "pending") return <Status status={status} />;
  return (
    <div className="flex gap-2">
      <Button onClick={() => onDecide("approved")}>Approve</Button>
      <Button variant="ghost" onClick={() => onDecide("rejected")} aria-label={waitingOn ? `Reject for ${waitingOn}` : "Reject"}>
        Reject
      </Button>
    </div>
  );
}

export function Table({ head, rows, empty = "Nothing here yet." }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[460px] text-left text-sm">
        <thead>
          <tr className="text-muted">
            {head.map((h) => (
              <th key={h} className="border-b border-line py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="py-6 text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className="py-2.5 pr-4 align-middle">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-btn" : "bg-raised ring-1 ring-line"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full transition-all duration-200 ${on ? "left-6 bg-btn-ink" : "left-1 bg-muted"}`} />
    </button>
  );
}

// `withLabel` = the plain text button used in the signed-in sidebar; without it, a sun or moon icon (sign-in page).
export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const [, force] = useState(0);
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme !== "light";
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("hrk-theme", next);
    } catch {}
    force((n) => n + 1);
  };
  if (withLabel)
    return (
      <Button variant="quiet" onClick={toggle}>
        {dark ? "Light theme" : "Dark theme"}
      </Button>
    );
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  // Shows where you'd go: a sun in dark mode, a moon in light mode.
  return (
    <button aria-label={label} title={label} onClick={toggle} className="press grid h-11 w-11 place-items-center rounded-full border border-line text-ink hover:bg-raised">
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
