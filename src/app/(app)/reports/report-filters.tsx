"use client";

import { DateParam, FilterBar, SegmentParam, SelectParam } from "@/components/ui/filters";

/** Shared filter row: date-range preset (+ custom dates) and granularity. Branch comes from the top bar. */
export function ReportFilters({ preset, autoGran, showGran }: { preset: string; autoGran: string; showGran: boolean }) {
  return (
    <FilterBar>
      <SelectParam
        name="preset"
        placeholder="This month"
        options={[
          ["today", "Today"],
          ["week", "This week"],
          ["lastmonth", "Last month"],
          ["quarter", "This quarter"],
          ["fy", "This financial year"],
          ["custom", "Custom range"],
        ]}
      />
      {preset === "custom" && (
        <>
          <DateParam name="from" label="From" />
          <DateParam name="to" label="To" />
        </>
      )}
      {showGran && (
        <SegmentParam
          name="gran"
          defaultValue={autoGran}
          options={[
            ["day", "Daily"],
            ["week", "Weekly"],
            ["month", "Monthly"],
            ["year", "Yearly"],
          ]}
        />
      )}
    </FilterBar>
  );
}
