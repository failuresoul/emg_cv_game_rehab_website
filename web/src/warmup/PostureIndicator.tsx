import { t } from "@/i18n";

export type PostureStatus = "waiting" | "good" | "check";

const STYLES: Record<PostureStatus, { dot: string; key: Parameters<typeof t>[0] }> = {
  waiting: { dot: "bg-muted", key: "warmup.posture.waiting" },
  good: { dot: "bg-success", key: "warmup.posture.good" },
  check: { dot: "bg-warning", key: "warmup.posture.check" },
};

/** A coloured dot with words, so the colour is never the only signal. */
export function PostureIndicator({ status }: { status: PostureStatus }) {
  const { dot, key } = STYLES[status];
  return (
    <p aria-live="polite" className="flex items-center justify-center gap-2 font-semibold">
      <span aria-hidden className={`inline-block size-4 shrink-0 rounded-full ${dot}`} />
      {t(key)}
    </p>
  );
}
