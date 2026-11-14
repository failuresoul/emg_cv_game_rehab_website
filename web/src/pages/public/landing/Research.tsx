import { Gauge, type LucideIcon, ScanEye, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { InstitutionLogo } from "@/components/brand/Identity";
import { project } from "@/config/project";
import { t, type TranslationKey } from "@/i18n";

import { ACCENT_TEXT, Container, SECTION_IDS } from "./shared";
import { countryText } from "@/config/projectText";

const AIMS: { icon: LucideIcon; tint: string; color: string; key: string }[] = [
  { icon: ScanEye, tint: "bg-primary-light", color: "text-primary", key: "sensing" },
  { icon: ShieldCheck, tint: "bg-[#FCEFE6]", color: "text-[#A84B18]", key: "adaptation" },
  { icon: Gauge, tint: "bg-[#EAF5EC]", color: "text-success", key: "outcomes" },
];

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[170px_1fr] sm:gap-4">
      <dt className="text-muted pt-0.5 text-[0.75rem] font-semibold tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Research() {
  const { institution, collaborator, supervisors } = project;
  return (
    <section
      id={SECTION_IDS.research}
      aria-labelledby="research-title"
      className="scroll-mt-24 py-20 lg:py-28"
    >
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div>
            <p
              className={`mb-3 text-[0.75rem] font-bold tracking-[0.12em] uppercase ${ACCENT_TEXT}`}
            >
              {t("landing.research.kicker")}
            </p>
            <h2
              id="research-title"
              className="mb-8 text-[1.5rem] leading-tight font-extrabold tracking-tight sm:text-[1.75rem]"
            >
              {project.researchTitle}
            </h2>
            <dl className="flex flex-col gap-5">
              <MetaRow label={t("landing.research.institution")}>
                {institution.department}, {institution.name}, {countryText(institution.country)}
              </MetaRow>
              <MetaRow label={t("landing.research.collaboration")}>
                {t("landing.research.collaborationText", {
                  name: collaborator.name,
                  country: countryText(collaborator.country),
                })}
              </MetaRow>
              <MetaRow label={t("landing.research.supervisedBy")}>
                <ul>
                  {supervisors.map((person) => (
                    <li key={person.name}>
                      <span className="font-semibold">{person.name}</span>
                      <span className="text-muted">, {person.affiliation}</span>
                    </li>
                  ))}
                </ul>
              </MetaRow>
              <MetaRow label={t("landing.research.status")}>
                {t("landing.research.statusText")}
              </MetaRow>
            </dl>
          </div>

          <div className="flex flex-col gap-4">
            <h3 className="sr-only">{t("landing.research.aims")}</h3>
            <ul className="flex flex-col gap-4">
              {AIMS.map(({ icon: Icon, tint, color, key }) => (
                <li
                  key={key}
                  className="flex gap-4 rounded-[18px] border border-black/10 bg-white p-5"
                >
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tint}`}>
                    <Icon size={24} aria-hidden className={color} />
                  </span>
                  <div>
                    <h4 className="text-[1rem] font-bold">
                      {t(`landing.research.aim.${key}.title` as TranslationKey)}
                    </h4>
                    <p className="text-muted text-[0.88rem]">
                      {t(`landing.research.aim.${key}.text` as TranslationKey)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div
              className="bg-primary-light/70 mt-2 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 rounded-[18px] border border-black/5 px-6 py-6"
              aria-label={t("landing.research.logos")}
              role="group"
            >
              <InstitutionLogo
                institution={institution}
                height={72}
                fallbackClassName="text-primary text-base"
              />
              <InstitutionLogo
                institution={collaborator}
                height={72}
                fallbackClassName="text-[#51247A] text-base"
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
