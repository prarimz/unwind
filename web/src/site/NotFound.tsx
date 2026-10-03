import { OUTLINE, SOLID, Shell, SiteHeader } from "@/site/Chrome";

/// An address nobody claimed, in the unlocked site: says so, and offers the
/// two places people actually go.
export default function NotFound() {
  return (
    <div className="site min-h-full">
      <SiteHeader />
      <Shell className="py-24 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-.02em]">Nothing here.</h1>
        <p className="mt-3 text-[14px] text-muted-foreground">
          No page lives at <span className="font-mono text-[13px]">{location.pathname}</span>.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <a href="/markets" className={SOLID}>See markets</a>
          <a href="/" className={OUTLINE}>Front page</a>
        </div>
      </Shell>
    </div>
  );
}
