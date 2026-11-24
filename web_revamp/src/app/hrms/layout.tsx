"use client";
// KonnektHRMS web: the dummy HRMS that stands in for the Razorpay dashboard.
// Each signed-in person sees only their own role's pages, plus HRKonnekt as a chat bubble.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChatWidget } from "@/components/ChatWidget";
import { Button, Face, Hydrated, Mark, ThemeToggle } from "@/components/ui";
import { ACCOUNTS } from "@/lib/data";
import { signOut, useSession, useStore, useStoreError, type State } from "@/lib/store";

type Nav = { href: string; label: string; count?: (s: State) => number };
const navFor: Record<string, Nav[]> = {
  "/hrms/employee": [
    { href: "/hrms/employee", label: "Home" },
    { href: "/hrms/employee/leave", label: "Leave" },
    { href: "/hrms/employee/payslips", label: "Payslips" },
    { href: "/hrms/employee/attendance", label: "Attendance" },
    { href: "/hrms/employee/directory", label: "Directory" },
  ],
  "/hrms/manager": [
    { href: "/hrms/manager", label: "Approvals", count: (s) => s.requests.filter((r) => r.status === "pending" && r.approverId === s.me.id).length },
    { href: "/hrms/manager/team", label: "Team" },
    { href: "/hrms/manager/pulse", label: "Pulse" },
  ],
  "/hrms/admin": [
    { href: "/hrms/admin", label: "HR dashboard" },
    { href: "/hrms/admin/employees", label: "Employees" },
    { href: "/hrms/admin/payroll", label: "Payroll" },
    { href: "/hrms/admin/holidays", label: "Holidays" },
    { href: "/hrms/admin/policies", label: "Policies" },
    { href: "/hrms/admin/console", label: "HRKonnekt Console", count: (s) => s.handovers.filter((h) => h.status === "open").length },
  ],
};

export default function HrmsLayout({ children }: LayoutProps<"/hrms">) {
  return (
    <Hydrated>
      <Shell>{children}</Shell>
    </Hydrated>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const s = useStore();
  const err = useStoreError();
  const user = useSession();
  const acc = ACCOUNTS.find((a) => a.id === user);
  const allowed = !!acc && (path === acc.home || path.startsWith(`${acc.home}/`));

  // Not signed in: back to the login page. Signed in but on another role's page: back to your own home.
  useEffect(() => {
    if (!acc) router.replace("/");
    else if (!allowed) router.replace(acc.home);
  }, [acc, allowed, router]);

  if (!acc || !allowed || !s || s.me.id !== acc.id)
    return (
      <div className="grid min-h-screen place-items-center gap-3 px-4 text-center" aria-label="Loading">
        <Mark state="working" size={40} />
        {err && <p role="alert" className="max-w-md text-sm text-red">{err} Start it with: cd backend &amp;&amp; uvicorn main:app --port 8000</p>}
      </div>
    );

  const person = s.me;
  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row">
      <aside className="flex shrink-0 flex-col gap-5 border-line bg-cell p-4 md:w-64 md:overflow-y-auto md:border-r">
        <Link href={acc.home} className="flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-lg font-semibold">KonnektHRMS</span>
        </Link>

        <div className="flex items-center gap-2.5">
          <Face name={person.name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{person.name}</div>
            <div className="truncate text-xs text-muted">
              {person.title}
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Sections">
          {navFor[acc.home].map((n) => {
            const c = n.count?.(s) ?? 0;
            const on = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`press flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm ${on ? "bg-raised font-medium" : "text-muted hover:bg-raised hover:text-ink"}`}
              >
                <span className="flex-1 whitespace-nowrap">{n.label}</span>
                {c > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gold-fill px-1.5 text-xs font-semibold text-[#0b0b0d]">{c}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-wrap items-start gap-1 border-t border-line pt-4 md:flex-col">
          <ThemeToggle withLabel />
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 pb-28 md:overflow-y-auto">{children}</main>
      <ChatWidget key={acc.id} pid={acc.id} />
    </div>
  );
}
