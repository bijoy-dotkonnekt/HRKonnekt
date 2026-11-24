"use client";

import { EmployeeList } from "@/components/EmployeeList";
import { PageHeader } from "@/components/ui";

export default function EmployeesPage() {
  return (
    <>
      <PageHeader title="Employees" sub="Seeded with 60 people, dates counted from today" />
      <div className="px-4 md:px-8">
        <EmployeeList admin />
      </div>
    </>
  );
}
