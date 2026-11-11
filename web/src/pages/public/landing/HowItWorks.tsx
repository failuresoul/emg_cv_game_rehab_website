import { Activity, Gamepad2, type LucideIcon, TrendingUp, Webcam } from "lucide-react";

import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";

import { Container, SECTION_IDS, SectionHeader } from "./shared";

const STEPS: { icon: LucideIcon; color: string; key: "camera" | "emg" | "games" | "progress" }[] = [
  { icon: Webcam, color: "text-primary", key: "camera" },
  { icon: Activity, color: "text-[#A84B18]", key: "emg" },
  { icon: Gamepad2, color: "text-primary", key: "games" },
  { icon: TrendingUp, color: "text-success", key: "progress" },
];

export function HowItWorks() {
  return (
    <section
      id={SECTION_IDS.how}
      aria-labelledby="how-title"
      className="scroll-mt-24 py-20 lg:py-28"
    >
      <Container>
        <SectionHeader
          id="how-title"
          center
          kicker={t("landing.how.kicker")}
          title={t("landing.how.title")}
          sub={t("landing.how.sub")}
        />
        <div className="relative">
          {/* The thin line joining the steps on wide screens. */}
          <div
            aria-hidden
            className="border-primary/30 absolute top-[39px] right-[12.5%] left-[12.5%] hidden border-t-2 border-dashed lg:block"
          />
          <ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7">
            {STEPS.map(({ icon: Icon, color, key }, index) => (
              <li key={key} className="relative text-center">
                <div className="relative mx-auto mb-5 grid h-[78px] w-[78px] place-items-center rounded-3xl border border-black/10 bg-white shadow-[0_18px_30px_-22px_rgba(10,40,45,0.5)]">
                  <Icon size={34} strokeWidth={1.8} aria-hidden className={color} />
                  <span
                    aria-hidden
                    className="bg-primary border-background absolute -top-2.5 -right-2.5 grid h-8 w-8 place-items-center rounded-full border-[3px] text-[0.7rem] font-bold text-white"
                  >
                    {formatNumber(index + 1, 0)}
                  </span>
                </div>
                <h3 className="mb-2 text-[1.1rem] font-bold">
                  <span className="sr-only">{t("landing.how.step", { n: index + 1 })} </span>
                  {t(`landing.how.${key}.title` as TranslationKey)}
                </h3>
                <p className="text-muted mx-auto max-w-xs text-[0.9rem]">
                  {t(`landing.how.${key}.text` as TranslationKey)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
