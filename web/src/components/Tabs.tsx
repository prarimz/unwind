import type { ReactNode } from "react";
import {
  Tabs as BeTabs, TabsContent, TabsList as BeTabsList, TabsTrigger as BeTabsTrigger,
} from "@/components/motion/tabs";
import { cn } from "@/lib/utils";

/*
 * beUI's tabs, in the house look.
 *
 * Three rows, one control. The default is text on a hairline, the selected
 * label underlined, which is how every ledger page and the venues people
 * already trade on switch between tables. `soft` is a quiet segmented
 * control for the settings beside data (the chart's timeframes, the book's
 * views): a tinted track with the chosen option a lighter block inside it.
 * `fill` is the same track with the chosen option filled solid, for the one
 * switch that has to shout, the ticket's long or short. Wrapped once so the
 * rows on /trade cannot drift apart from each other or from the site.
 */
type Look = "underline" | "soft" | "fill";

export function Tabs({
  value, defaultValue, onValueChange, children, className, look = "underline",
}: {
  value?: string; defaultValue?: string; onValueChange?: (v: string) => void;
  children: ReactNode; className?: string; look?: Look;
}) {
  return (
    <BeTabs variant={look === "underline" ? "underline" : "pill"} value={value}
      defaultValue={defaultValue} onValueChange={onValueChange} className={className}>
      {children}
    </BeTabs>
  );
}

const LIST: Record<Look, string> = {
  underline: "gap-0 border-0",
  soft: "rounded-[8px] bg-panel2 p-0.5 gap-0",
  fill: "rounded-[8px] border border-line p-0.5 gap-0",
};
const TRIGGER: Record<Look, string> = {
  underline: "min-h-[36px] px-3 pb-2 pt-2 text-[12.5px] font-medium first:pl-0",
  soft: "h-7 px-3 text-[12.5px] font-normal rounded-[6px] [&_[data-tabs-label]]:font-medium " +
    "[&_[data-tabs-label]]:text-foreground",
  fill: "h-9 px-3 text-[13.5px] font-normal rounded-[6px] [&_[data-tabs-label]]:font-medium " +
    "[&_[data-tabs-label]]:text-background",
};
const INDICATOR: Record<Look, string> = {
  underline: "bg-foreground",
  soft: "rounded-[6px] bg-panel3",
  fill: "rounded-[6px] bg-foreground",
};

/// `soft` is kept as a boolean for the rows that already ask for it.
const lookOf = (soft: boolean | undefined, look: Look | undefined): Look =>
  look ?? (soft ? "soft" : "underline");

export function TabsList({ children, className, soft, look }: {
  children: ReactNode; className?: string; soft?: boolean; look?: Look;
}) {
  return (
    <BeTabsList className={cn(LIST[lookOf(soft, look)], className)}>{children}</BeTabsList>
  );
}

/// `className` sizes a row that needs it (the ticket's full-width side
/// switch, the book's narrow column); the look itself stays the shared one.
export function TabsTrigger({ value, children, className, soft, look }: {
  value: string; children: ReactNode; className?: string; soft?: boolean; look?: Look;
}) {
  const l = lookOf(soft, look);
  return (
    <BeTabsTrigger value={value} className={cn(TRIGGER[l], className)} indicatorClassName={INDICATOR[l]}>
      {children}
    </BeTabsTrigger>
  );
}

export { TabsContent };
