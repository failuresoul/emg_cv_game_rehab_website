import {
  ChevronDown,
  ChevronUp,
  Info,
  RotateCcw,
  Save,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import {
  draftFrom,
  formatValue,
  type GameDraft,
  isAdjustable,
  isCustomised,
  isDirty,
  MAX_TRIALS,
  MIN_TRIALS,
  parseTrials,
  snapToStep,
  toUpdate,
} from "@/features/admin/gameSettingsForm";
import { useAdminGames, useResetGameSetting, useUpdateGameSetting } from "@/features/admin/hooks";
import { GAMES, isGameId } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatRelativeTime } from "@/lib/format";
import type { AdminGameSetting, GameParamSpec } from "@/types/api";

/** The registry's label for a setting, so the words always come from the translation files. */
function labelKeyFor(game: AdminGameSetting, spec: GameParamSpec): TranslationKey {
  const id = game.spec.id;
  const local = isGameId(id) ? GAMES[id].params.find((item) => item.name === spec.name) : null;
  return local?.labelKey ?? (spec.label_key as TranslationKey);
}

function valueText(spec: GameParamSpec, value: number): string {
  const { key, params } = formatValue(spec, value);
  return t(key, params);
}

function ParamSlider({
  spec,
  labelKey,
  value,
  onChange,
}: {
  spec: GameParamSpec;
  labelKey: TranslationKey;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const HarderIcon = spec.harder === "higher" ? TrendingUp : TrendingDown;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {t(labelKey)}
        </label>
        <span className="text-lg font-bold tabular-nums">{valueText(spec, value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        aria-valuetext={valueText(spec, value)}
        onChange={(event) => onChange(snapToStep(spec, Number(event.target.value)))}
        className="accent-primary h-11 w-full cursor-pointer"
      />
      <div className="text-muted flex flex-wrap justify-between gap-2 text-base">
        <span>
          {valueText(spec, spec.min)} – {valueText(spec, spec.max)}
        </span>
        <span className="inline-flex items-center gap-1">
          <HarderIcon size={18} aria-hidden />
          {t(spec.harder === "higher" ? "adminGames.harderHigher" : "adminGames.harderLower")}
        </span>
        <span>{t("adminGames.gameDefault", { value: valueText(spec, spec.default) })}</span>
      </div>
    </div>
  );
}

function DefaultsPanel({
  id,
  game,
  draft,
  onChange,
}: {
  id: string;
  game: AdminGameSetting;
  draft: GameDraft;
  onChange: (draft: GameDraft) => void;
}) {
  const adjustable = game.spec.params.filter(isAdjustable);
  const others = game.spec.params.filter((spec) => !isAdjustable(spec));
  return (
    <div id={id} className="flex flex-col gap-5 border-t border-black/10 pt-4">
      {adjustable.map((spec) => (
        <ParamSlider
          key={spec.name}
          spec={spec}
          labelKey={labelKeyFor(game, spec)}
          value={draft.params[spec.name] ?? spec.default}
          onChange={(value) =>
            onChange({ ...draft, params: { ...draft.params, [spec.name]: value } })
          }
        />
      ))}
      {others.length > 0 && (
        <div>
          <h4 className="font-semibold">{t("adminGames.notAdjustable")}</h4>
          <ul className="text-muted mt-1 flex flex-col gap-1 text-base">
            {others.map((spec) => (
              <li key={spec.name}>
                {t(labelKeyFor(game, spec))}:{" "}
                {spec.min === spec.max
                  ? t("adminGames.fixed", { value: valueText(spec, spec.default) })
                  : t("adminGames.chosenPerTurn")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Textarea
        label={t("adminGames.notes")}
        value={draft.notes}
        maxLength={1000}
        rows={2}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
      />
    </div>
  );
}

function GameSettingCard({ game }: { game: AdminGameSetting }) {
  const showToast = useToast();
  const update = useUpdateGameSetting();
  const reset = useResetGameSetting();
  const [draft, setDraft] = useState(() => draftFrom(game));
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const id = game.spec.id;
  const definition = isGameId(id) ? GAMES[id] : null;
  const Icon = definition?.icon;
  const name = t(game.spec.name_key as TranslationKey);
  const trialsValid = parseTrials(draft.trials) !== null;
  const dirty = isDirty(game, draft);
  const busy = update.isPending || reset.isPending;

  function save() {
    const setting = toUpdate(game, draft);
    if (!setting) return;
    update.mutate(
      { gameId: id, setting },
      {
        onSuccess: (saved) => {
          setDraft(draftFrom(saved));
          showToast("success", t("adminGames.saved", { name }));
        },
      },
    );
  }

  function resetToDefaults() {
    reset.mutate(id, {
      onSuccess: (saved) => {
        setDraft(draftFrom(saved));
        showToast("success", t("adminGames.resetDone", { name }));
      },
    });
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {Icon && <Icon size={40} aria-hidden className="text-primary shrink-0" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">{name}</h2>
          <p className="text-muted">
            {t("adminGames.trains", { movement: t(game.spec.movement_key as TranslationKey) })}
          </p>
          {game.updated_at && (
            <p className="text-muted text-base">
              {t("adminGames.lastSaved", { when: formatRelativeTime(game.updated_at) })}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {!game.enabled && <Badge variant="warning">{t("adminGames.hidden")}</Badge>}
          {isCustomised(game) && <Badge>{t("adminGames.custom")}</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => setDraft({ ...draft, enabled })}
          label={t("adminGames.enabled")}
          ariaLabel={t("adminGames.enabledLabel", { name })}
        />
        <div className="w-40">
          <Input
            label={t("adminGames.trials")}
            type="number"
            inputMode="numeric"
            min={MIN_TRIALS}
            max={MAX_TRIALS}
            step={1}
            value={draft.trials}
            onChange={(event) => setDraft({ ...draft, trials: event.target.value })}
            error={
              trialsValid
                ? undefined
                : t("adminGames.trialsError", { min: MIN_TRIALS, max: MAX_TRIALS })
            }
          />
        </div>
        <p className="text-muted pb-2 text-base">
          {t("adminGames.trialsDefault", { value: game.spec.trials_default })}
        </p>
      </div>

      <Button
        variant="ghost"
        className="self-start"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronUp size={20} aria-hidden /> : <ChevronDown size={20} aria-hidden />}
        {t(open ? "adminGames.hideDefaults" : "adminGames.editDefaults")}
      </Button>
      {open && <DefaultsPanel id={panelId} game={game} draft={draft} onChange={setDraft} />}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy || !isCustomised(game)}
          loading={reset.isPending}
          onClick={resetToDefaults}
        >
          <RotateCcw size={20} aria-hidden />
          {t("adminGames.reset")}
        </Button>
        <Button disabled={busy || !dirty || !trialsValid} loading={update.isPending} onClick={save}>
          <Save size={20} aria-hidden />
          {t("adminGames.save")}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The game library: which games patients see, how many turns each has, and the settings each game
 * starts from. Per-patient programmes and the AI's limits come later (Day 14).
 */
export function AdminGamesPage() {
  const games = useAdminGames();
  return (
    <div>
      <PageHeader title={t("page.admin.games.title")} description={t("adminGames.intro")} />
      <Card className="mb-6 flex items-start gap-3">
        <Info size={24} aria-hidden className="text-primary mt-0.5 shrink-0" />
        <p>{t("adminGames.laterNote")}</p>
      </Card>
      {games.isPending && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      )}
      {games.isError && <QueryError onRetry={() => void games.refetch()} />}
      {games.data && (
        <ul className="grid items-start gap-4 lg:grid-cols-2">
          {games.data.map((game) => (
            <li key={game.spec.id}>
              <GameSettingCard game={game} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
