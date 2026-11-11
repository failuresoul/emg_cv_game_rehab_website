import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import type { GameId } from "@/types/api";

import { GAME_ART } from "./gameArt";
import { Container, SECTION_IDS, SectionHeader } from "./shared";

type Tag = "reach" | "shoulder" | "elbow" | "hand" | "fingers" | "grip";

/** Dark text on a light tint: every pair passes WCAG AA. */
const TAG_STYLE: Record<Tag, string> = {
  reach: "bg-[#E6F2F0] text-[#0F5C5C]",
  shoulder: "bg-[#E8EFFA] text-[#2F5D8C]",
  elbow: "bg-[#FCEFE6] text-[#9C4515]",
  hand: "bg-[#F3EAF7] text-[#6B3B8C]",
  fingers: "bg-[#F3EAF7] text-[#6B3B8C]",
  grip: "bg-[#EAF5EC] text-[#276B43]",
};

const TAGS: Record<GameId, Tag> = {
  reach_activate: "reach",
  balloon_pop: "shoulder",
  fruit_catch: "reach",
  bloom: "hand",
  finger_piano: "fingers",
  path_trace: "shoulder",
  paint_wall: "elbow",
  pick_place: "grip",
  grip_hold: "grip",
};

export function Games() {
  return (
    <section
      id={SECTION_IDS.games}
      aria-labelledby="games-title"
      className="scroll-mt-24 border-y border-black/10 bg-white py-20 lg:py-28"
    >
      <Container>
        <SectionHeader
          id="games-title"
          kicker={t("landing.games.kicker")}
          title={t("landing.games.title", { n: GAME_IDS.length })}
          sub={t("landing.games.sub")}
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {GAME_IDS.map((id) => {
            const { background, art } = GAME_ART[id];
            const tag = TAGS[id];
            return (
              <li
                key={id}
                className="overflow-hidden rounded-[22px] border border-black/10 bg-white transition-shadow duration-200 hover:shadow-[0_24px_40px_-28px_rgba(10,40,45,0.55)] motion-safe:transition-[transform,box-shadow] motion-safe:hover:-translate-y-1"
              >
                <div className="grid h-40 place-items-center" style={{ background }}>
                  <svg viewBox="0 0 160 110" width="160" height="110" aria-hidden focusable="false">
                    {art}
                  </svg>
                </div>
                <div className="flex items-end justify-between gap-3 px-5 pt-4 pb-5">
                  <div>
                    <h3 className="text-[1.05rem] leading-snug font-bold">
                      {t(GAMES[id].nameKey)}
                    </h3>
                    <p className="text-muted text-[0.85rem]">
                      {t(`landing.games.${id}` as TranslationKey)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-bold tracking-wide ${TAG_STYLE[tag]}`}
                  >
                    {t(`landing.tag.${tag}` as TranslationKey)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
