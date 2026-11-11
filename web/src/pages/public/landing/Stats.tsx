import { GAME_IDS } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { EXERCISES } from "@/warmup/exercises";

import { ACCENT_TEXT, Container } from "./shared";

const STATS: { value: number; labelKey: TranslationKey; accent?: boolean }[] = [
  { value: GAME_IDS.length, labelKey: "landing.stats.games" },
  { value: Object.keys(EXERCISES).length, labelKey: "landing.stats.warmup" },
  { value: 2, labelKey: "landing.stats.modalities" },
  { value: 0, labelKey: "landing.stats.video", accent: true },
];

export function Stats() {
  return (
    <section aria-label={t("landing.stats.label")} className="relative z-10 -mt-20 lg:-mt-24">
      <Container>
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {STATS.map((stat) => (
            <li
              key={stat.labelKey}
              className="flex flex-col items-center rounded-2xl border border-black/10 bg-white px-3 py-6 text-center shadow-[0_30px_60px_-40px_rgba(10,40,45,0.45)] sm:px-5"
            >
              <span
                className={`text-[2.2rem] leading-none font-extrabold tracking-tight sm:text-[2.5rem] ${
                  stat.accent ? ACCENT_TEXT : "text-primary"
                }`}
              >
                {formatNumber(stat.value, 0)}
              </span>
              <span className="text-muted mt-2 text-[0.85rem] font-medium sm:text-[0.9rem]">
                {t(stat.labelKey)}
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
