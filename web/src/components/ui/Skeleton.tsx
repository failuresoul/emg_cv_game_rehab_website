import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("bg-muted/20 animate-pulse rounded", className)} />;
}
