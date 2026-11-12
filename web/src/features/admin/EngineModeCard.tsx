import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { t, type TranslationKey } from "@/i18n";
import type { EngineMode, Patient } from "@/types/api";

import { useUpdatePatient } from "./hooks";

const MODES: { mode: EngineMode; labelKey: TranslationKey; descriptionKey: TranslationKey }[] = [
  { mode: "L0", labelKey: "adminLevels.mode.L0", descriptionKey: "adminEngine.describe.L0" },
  { mode: "L1", labelKey: "adminLevels.mode.L1", descriptionKey: "adminEngine.describe.L1" },
  { mode: "L2", labelKey: "adminLevels.mode.L2", descriptionKey: "adminEngine.describe.L2" },
];

/** Which engine sets this patient's difficulty, changed only after a confirmation. It applies
 * from the patient's next game. */
export function EngineModeCard({ patient }: { patient: Patient }) {
  const current: EngineMode = patient.engine_mode ?? "L1";
  const [chosen, setChosen] = useState<EngineMode>(current);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const update = useUpdatePatient(patient.id);

  function confirm() {
    update.mutate({ engine_mode: chosen }, { onSuccess: () => setConfirmOpen(false) });
  }

  return (
    <section aria-labelledby="engine-mode" className="flex flex-col gap-3">
      <h2 id="engine-mode" className="text-xl font-bold">
        {t("adminEngine.title")}
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted mb-1">{t("adminEngine.intro")}</legend>
        {MODES.map(({ mode, labelKey, descriptionKey }) => (
          <label
            key={mode}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-1 hover:bg-black/5"
          >
            <input
              type="radio"
              name="engine-mode"
              value={mode}
              checked={chosen === mode}
              onChange={() => setChosen(mode)}
              className="accent-primary mt-1 size-5"
            />
            <span>
              <span className="block font-semibold">
                {t(labelKey)}
                {mode === current && (
                  <span className="text-muted ml-2 font-normal">{t("adminEngine.current")}</span>
                )}
              </span>
              <span className="text-muted block">{t(descriptionKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button disabled={chosen === current} onClick={() => setConfirmOpen(true)}>
          {t("adminEngine.change")}
        </Button>
      </div>
      <p className="text-muted text-sm">{t("adminEngine.researchNote")}</p>

      <Modal
        open={confirmOpen}
        title={t("adminEngine.confirmTitle")}
        onClose={() => setConfirmOpen(false)}
      >
        <p>
          {t("adminEngine.confirmText", {
            from: t(MODES.find((m) => m.mode === current)!.labelKey),
            to: t(MODES.find((m) => m.mode === chosen)!.labelKey),
          })}
        </p>
        {update.isError && (
          <p role="alert" className="text-danger mt-3 font-medium">
            {t("adminEngine.error")}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={confirm} loading={update.isPending}>
            {t("adminEngine.confirm")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
