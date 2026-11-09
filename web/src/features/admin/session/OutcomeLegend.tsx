import type { ReactNode } from "react";

import { MarkerShape } from "@/components/ReachMap";
import { t } from "@/i18n";
import type { GameId, TrialOutcome } from "@/types/api";

import { OUTCOME_ORDER, OUTCOME_STYLE, outcomeLabelKey } from "./outcomes";

function Item({ swatch, children }: { swatch: ReactNode; children: string }) {
  return (
    <li className="flex items-center gap-2">
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
        {swatch}
      </svg>
      <span>{children}</span>
    </li>
  );
}

/** A key for the outcomes that appear, in the game's own words, and the compensation ring. */
export function OutcomeLegend({
  gameId,
  outcomes,
  compensated,
}: {
  gameId: GameId;
  outcomes: readonly TrialOutcome[];
  compensated: boolean;
}) {
  const present = OUTCOME_ORDER.filter((outcome) => outcomes.includes(outcome));
  if (present.length === 0) return <p className="text-muted mt-2">{t("adminSession.noTargets")}</p>;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2" aria-label={t("adminSession.legend")}>
      {present.map((outcome) => (
        <Item
          key={outcome}
          swatch={
            <MarkerShape
              shape={OUTCOME_STYLE[outcome].shape}
              x={12}
              y={12}
              size={6}
              color={OUTCOME_STYLE[outcome].color}
            />
          }
        >
          {t(outcomeLabelKey(gameId, outcome))}
        </Item>
      ))}
      {compensated && (
        <Item
          swatch={
            <circle cx={12} cy={12} r={9} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
          }
        >
          {t("adminSession.legendCompensated")}
        </Item>
      )}
    </ul>
  );
}
