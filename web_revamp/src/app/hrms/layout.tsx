"use client";
// KonnektHRMS web: the dummy HRMS that stands in for the Razorpay dashboard.
// Each signed-in person sees only their own role's pages, plus HRKonnekt as a chat bubble.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChatWidget } from "@/components/ChatWidget";
import { Button, Face, Hydrated, Mark, ThemeToggle } from "@/components/ui";
import { signOut, useSession, useStore, useStoreError } from "@/lib/store";

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
  const session = useSession();
  // The pages this person may open come from the backend (meta.nav); anything else sends them home.
  const ready = !!session && !!s && s.me.id === session.id;
  const allowed = ready && s.meta.nav.some((n) => n.href === path);

  useEffect(() => {
    if (!session) router.replace("/");
    else if (ready && !allowed) router.replace(s.meta.home);
  }, [session, ready, allowed, s, router]);

  if (!ready || !allowed)
    return (
      <div className="grid min-h-screen place-items-center gap-3 px-4 text-center" aria-label="Loading">
        <Mark state="working" size={40} />
        {err && <p role="alert" className="max-w-md text-sm text-red">{err}</p>}
      </div>
    );

  const person = s.me;
  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row">
      <aside className="flex shrink-0 flex-col gap-5 border-line bg-cell p-4 md:w-64 md:overflow-y-auto md:border-r">
        <Link href={s.meta.home} className="flex items-center gap-2.5">
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

        {/* -m-1 p-1: room for the focus ring, which overflow-x-auto would otherwise clip. */}
        <nav className="-m-1 flex gap-1 overflow-x-auto p-1 md:flex-col" aria-label="Sections">
          {s.meta.nav.map((n) => {
            const c = n.badge ? (s.badges[n.badge] ?? 0) : 0;
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
      <ChatWidget key={s.me.id} pid={s.me.id} />
    </div>
  );
}
