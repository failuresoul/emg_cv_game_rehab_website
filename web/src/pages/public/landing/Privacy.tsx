import { HeartPulse, Info, Lock, type LucideIcon, UserCheck } from "lucide-react";

import { t, type TranslationKey } from "@/i18n";

import { Container, SectionHeader } from "./shared";

const CARDS: { icon: LucideIcon; tint: string; color: string; key: string }[] = [
  { icon: Lock, tint: "bg-primary-light", color: "text-primary", key: "video" },
  { icon: HeartPulse, tint: "bg-[#FCEFE6]", color: "text-[#A84B18]", key: "safe" },
  { icon: UserCheck, tint: "bg-[#EAF5EC]", color: "text-success", key: "therapist" },
];

export function Privacy() {
  return (
    <section aria-labelledby="privacy-title" className="pb-20 lg:pb-28">
      <Container>
        <SectionHeader
          id="privacy-title"
          center
          kicker={t("landing.privacy.kicker")}
          title={t("landing.privacy.title")}
        />
        <ul className="grid gap-5 md:grid-cols-3 lg:gap-6">
          {CARDS.map(({ icon: Icon, tint, color, key }) => (
            <li key={key} className="rounded-[22px] border border-black/10 bg-white p-7">
              <span className={`mb-4 grid h-13 w-13 place-items-center rounded-2xl ${tint}`}>
                <Icon size={26} aria-hidden className={color} />
              </span>
              <h3 className="mb-2 text-[1.1rem] font-bold">
                {t(`landing.privacy.${key}.title` as TranslationKey)}
              </h3>
              <p className="text-muted text-[0.9rem]">
                {t(`landing.privacy.${key}.text` as TranslationKey)}
              </p>
            </li>
          ))}
        </ul>
        <p
          role="note"
          className="mt-6 flex items-start gap-3 rounded-2xl border border-[#F3D3BE] bg-[#FCEFE6] px-5 py-4 text-[0.95rem]"
        >
          <Info size={24} aria-hidden className="mt-0.5 shrink-0 text-[#A84B18]" />
          <span>
            <strong>{t("landing.notice.title")}</strong> {t("landing.notice.text")}
          </span>
        </p>
      </Container>
    </section>
  );
}
