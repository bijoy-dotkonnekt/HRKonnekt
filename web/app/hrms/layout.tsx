"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RoleCtx } from "@/components/role";
import { useStored } from "@/lib/api";

// Demo shortcut: the role switcher stands in for company sign-in.
const ROLES = [
  { key: "employee", label: "Employee", emp: 10, name: "Priya Sharma" },
  { key: "manager", label: "Manager", emp: 8, name: "Rahul Verma" },
  { key: "hr", label: "HR", emp: 15, name: "Ananya Iyer" },
];
const NAV: Record<string, [string, string][]> = {
  employee: [["Home", "/hrms"], ["Leave", "/hrms/leave"]],
  manager: [["Home", "/hrms"], ["Leave", "/hrms/leave"], ["Approvals", "/hrms/approvals"]],
  hr: [["Home", "/hrms"], ["HR dashboard", "/hrms/dashboard"], ["Employees", "/hrms/employees"], ["HRKonnekt Console", "/hrms/console"]],
};

export default function HrmsLayout({ children }: { children: React.ReactNode }) {
  const [idx, setIdx] = useStored("hrms-role", 0);
  const role = ROLES[idx] ?? ROLES[0];
  const path = usePathname();
  const router = useRouter();
  return (
    <RoleCtx.Provider value={{ emp: role.emp, role: role.key, name: role.name }}>
      <div className="flex min-h-screen">
        <nav aria-label="HRMS" className="w-[232px] shrink-0 bg-paper border-r border-hair px-4 py-6 flex flex-col gap-5">
          <div className="flex gap-2.5 items-center px-2">
            <span className="w-9 h-9 rounded-xl bg-plum text-gold flex items-center justify-center font-semibold">K</span>
            <div className="flex flex-col"><span className="font-semibold text-[15px]">KonnektHRMS</span><span className="text-muted text-xs">DotKonnekt</span></div>
          </div>
          <div role="group" aria-label="Role" className="flex gap-1 p-1 rounded-full bg-bg border border-hair">
            {ROLES.map((r, i) => (
              <button key={r.key} onClick={() => { setIdx(i); if (!NAV[r.key].some(([, h]) => h === path)) router.push("/hrms"); }}
                className={`flex-1 min-h-8 rounded-full text-xs font-semibold ${i === idx ? "bg-black text-bg" : ""}`}>{r.label}</button>
            ))}
          </div>
          <span className="text-xs text-muted px-2 -mt-3">as {role.name}</span>
          <div className="flex flex-col gap-0.5">
            {NAV[role.key].map(([label, href]) => (
              <Link key={href} href={href} className={`px-3 py-2.5 rounded-xl text-sm ${path === href ? "bg-lilac-soft font-semibold" : ""}`}>{label}</Link>
            ))}
          </div>
          <Link href="/chat" target="_blank" className="mt-auto flex flex-col gap-1 p-3.5 rounded-2xl bg-ink text-bg">
            <span className="eb !text-gold">Ask HRKonnekt</span>
            <span className="text-[13px]">Open the chat app →</span>
          </Link>
        </nav>
        <main className="flex-1 min-w-0 px-10 pt-7 pb-12 flex flex-col gap-6">{children}</main>
      </div>
    </RoleCtx.Provider>
  );
}
