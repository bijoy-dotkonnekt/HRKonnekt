"use client";

import { EmployeeList } from "@/components/EmployeeList";
import { PageHeader } from "@/components/ui";

export default function DirectoryPage() {
  return (
    <>
      <PageHeader title="Directory" sub="Everyone at the company" />
      <div className="px-4 md:px-8">
        <EmployeeList />
      </div>
    </>
  );
}
