"use client";
import { Any, fmtDate, usePoll, useToday } from "@/lib/api";
import { Stat, Status, Title } from "@/components/ui";
import { useRole } from "@/components/role";

const ATT: Record<string, string> = { present: "bg-purple", wfh: "bg-lilac", leave: "bg-success", half_day: "bg-purple/50", absent: "bg-danger/60", holiday: "bg-gold", weekend: "bg-hair" };

export default function EmployeeHome() {
  const { emp } = useRole();
  const [me] = usePoll<Any>(`/hrms/employees/${emp}`, 30000);
  const [bal] = usePoll<Any[]>(`/hrms/leave/balances?emp_id=${emp}`);
  const [reqs] = usePoll<Any[]>(`/hrms/leave/requests?emp_id=${emp}`);
  const [hol] = usePoll<Any[]>("/hrms/holidays?upcoming=true", 60000);
  const [pay] = usePoll<Any>(`/hrms/payslips?emp_id=${emp}`, 60000);
  const [att] = usePoll<Any[]>(`/hrms/attendance?emp_id=${emp}&days=30`);
  const [emps] = usePoll<Any[]>("/hrms/employees", 60000);
  const [ann] = usePoll<Any[]>("/hrms/announcements", 60000);
  const b = (c: string) => bal?.find((x) => x.leave_type === c);
  const now = useToday();
  const today = now?.toISOString().slice(5, 10);
  const year = now?.getFullYear() ?? 0;
  const todays = (now ? emps ?? [] : []).flatMap((e) => {
    const out = [];
    if (e.dob.slice(5) === today) out.push({ k: e.id + "b", t: `${e.name}'s birthday 🎂`, s: e.department });
    if (e.date_of_joining.slice(5) === today && +e.date_of_joining.slice(0, 4) < year)
      out.push({ k: e.id + "a", t: `${e.name} · ${year - +e.date_of_joining.slice(0, 4)} years`, s: e.department });
    const days = Math.round((now!.getTime() - new Date(e.date_of_joining).getTime()) / 864e5);
    if (days >= 29 && days <= 31) out.push({ k: e.id + "j", t: `${e.name} · 1 month in`, s: e.designation });
    return out;
  });
  const slip = pay?.payslips?.[0];
  const late = att?.filter((a) => a.check_out && a.check_out >= "21:00").length ?? 0;

  return (
    <>
      <Title eyebrow={now?.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" }) ?? "Today"}>
        Hello, {me?.first_name ?? "…"}.
      </Title>
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Casual leave left" value={<>{b("CL")?.available ?? "–"}<span className="text-muted text-base font-normal"> / {b("CL")?.accrued ?? 12} days</span></>}
          sub={`SL ${b("SL")?.available ?? "–"} · EL ${b("EL")?.available ?? "–"} · pending ${b("CL")?.pending ?? 0} CL`} />
        <Stat label="Manager" value={<span className="text-2xl">{me?.manager_name ?? "—"}</span>} sub={`${me?.designation ?? ""} · ${me?.department ?? ""}`} />
        <Stat label="Next holiday" value={<span className="text-2xl">{hol?.[0]?.name ?? "—"}</span>} sub={hol?.[0] && fmtDate(hol[0].date)} />
        <Stat label={slip ? `${slip.month} payslip` : "Payslip"} value={<span className="text-2xl">{slip ? `₹${slip.net_pay.toLocaleString("en-IN")}` : "—"}</span>} sub="Net pay · illustrative" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 flex flex-col">
          <h2 className="m-0 mb-2 text-lg font-semibold">My requests</h2>
          {reqs?.slice(0, 5).map((r) => (
            <div key={r.id} className="flex justify-between gap-3 py-2.5 border-t border-hair text-sm">
              <span><b className="font-semibold">{r.leave_type_name}</b> · {fmtDate(r.start_date)}{r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`} · {r.days} day{r.days > 1 ? "s" : ""}<br />
                <span className="text-muted text-[12.5px]">{r.source === "chat" ? "Applied via HRKonnekt Chat" : "Applied in KonnektHRMS"} · approver {r.approver_name}</span></span>
              <span className="self-center"><Status s={r.status} /></span>
            </div>
          ))}
        </div>
        <div className="card flex flex-col gap-2">
          <h2 className="m-0 text-lg font-semibold">Today at DotKonnekt</h2>
          {todays.map((t) => <div key={t.k} className="text-sm py-1.5 border-t border-hair first:border-0">{t.t}<br /><span className="text-muted text-[12.5px]">{t.s}</span></div>)}
          {ann?.[0] && <div className="p-3.5 rounded-2xl bg-bg text-[13px] leading-normal"><span className="eb block mb-1">Announcement</span><b>{ann[0].title}.</b> {ann[0].body}</div>}
        </div>
      </div>
      <div className="card flex flex-col gap-3">
        <div className="flex justify-between items-center"><h2 className="m-0 text-lg font-semibold">Last 30 days attendance</h2>
          <span className="text-muted text-[13px]">{att?.filter((a) => a.status === "present").length ?? 0} present · {att?.filter((a) => a.status === "wfh").length ?? 0} WFH · {att?.filter((a) => a.status === "leave").length ?? 0} leave · {late} late log-offs</span></div>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(30,minmax(0,1fr))" }}>
          {att?.map((a) => <div key={a.date} title={`${a.date} · ${a.status}${a.check_out ? ` · out ${a.check_out}` : ""}`}
            className={`h-7 rounded-md ${a.check_out >= "21:00" ? "bg-[#D9A514]" : ATT[a.status]}`} />)}
        </div>
        <div className="flex gap-4 text-xs text-muted flex-wrap">
          {[["bg-purple", "Present"], ["bg-lilac", "WFH"], ["bg-success", "Leave"], ["bg-[#D9A514]", "Logged off after 9 pm"], ["bg-gold", "Holiday"], ["bg-hair", "Weekend"]].map(([c, l]) =>
            <span key={l}><span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1.5 ${c}`} />{l}</span>)}
        </div>
      </div>
    </>
  );
}
