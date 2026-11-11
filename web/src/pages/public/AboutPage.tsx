import {
  Activity,
  FileText,
  Gamepad2,
  Gauge,
  Info,
  Lock,
  type LucideIcon,
  Mail,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { project } from "@/config/project";
import { GAME_IDS } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";

import { CollaborationCard } from "./landing/Collaboration";
import { ACCENT_TEXT, SectionHeader } from "./landing/shared";
import { TeamGroups } from "./landing/Team";

const PARTS: {
  icon: LucideIcon;
  key: "sensing" | "games" | "adaptation" | "metrics" | "reports";
  soon?: boolean;
}[] = [
  { icon: Activity, key: "sensing" },
  { icon: Gamepad2, key: "games" },
  { icon: ShieldCheck, key: "adaptation" },
  { icon: Gauge, key: "metrics" },
  { icon: FileText, key: "reports", soon: true },
];

const DATA_POINTS: { icon: LucideIcon; key: "video" | "saved" | "access" | "research" }[] = [
  { icon: Lock, key: "video" },
  { icon: Activity, key: "saved" },
  { icon: Users, key: "access" },
  { icon: Info, key: "research" },
];

function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      {children}
    </section>
  );
}

/** What the project is, why, how the system works, who makes it and how data is handled.
 * Research prototype; no version number. */
export function AboutPage() {
  return (
    <article className="flex flex-col gap-16 pb-6 lg:gap-20">
      <header className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#E8F2F1,#FFFFFF)] px-6 py-10 sm:px-10 sm:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(rgba(15,92,92,0.12) 1px, transparent 1.2px)",
            backgroundSize: "26px 26px",
            maskImage: "linear-gradient(180deg, #000 0%, transparent 90%)",
            WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 90%)",
          }}
        />
        <div className="relative">
          <p className={`mb-3 text-[0.75rem] font-bold tracking-[0.12em] uppercase ${ACCENT_TEXT}`}>
            {t("about.kicker", { name: project.name })}
          </p>
          <h1 className="max-w-3xl text-[1.75rem] leading-tight font-extrabold tracking-tight sm:text-[2.4rem]">
            {project.researchTitle}
          </h1>
          <p className="text-muted mt-4 max-w-2xl text-[1.05rem]">
            {t("about.intro", {
              name: project.nameLong,
              department: project.institution.department ?? "",
              institution: project.institution.name,
              collaborator: project.collaborator.name,
            })}
          </p>
        </div>
      </header>

      <Section id="about-background">
        <SectionHeader
          id="about-background"
          kicker={t("about.background.kicker")}
          title={t("about.background.title")}
        />
        <div className="grid gap-6 md:grid-cols-2">
          {(["home", "multimodal"] as const).map((key) => (
            <div key={key} className="rounded-[22px] border border-black/10 bg-white p-7">
              <h3 className="mb-2 text-[1.15rem] font-bold">
                {t(`about.background.${key}.title`)}
              </h3>
              <p className="text-muted">{t(`about.background.${key}.text`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="about-system">
        <SectionHeader
          id="about-system"
          kicker={t("about.system.kicker")}
          title={t("about.system.title")}
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PARTS.map(({ icon: Icon, key, soon }) => (
            <li key={key} className="rounded-[22px] border border-black/10 bg-white p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="bg-primary-light grid h-12 w-12 place-items-center rounded-2xl">
                  <Icon size={24} aria-hidden className="text-primary" />
                </span>
                {soon && <Badge>{t("common.comingSoon")}</Badge>}
              </div>
              <h3 className="mb-1.5 text-[1.05rem] font-bold">
                {t(`about.system.${key}.title` as TranslationKey, { n: GAME_IDS.length })}
              </h3>
              <p className="text-muted text-[0.9rem]">
                {t(`about.system.${key}.text` as TranslationKey)}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="about-team">
        <SectionHeader
          id="about-team"
          center
          kicker={t("landing.team.kicker")}
          title={t("landing.team.title")}
        />
        <TeamGroups idPrefix="about-team" />
      </Section>

      <section aria-labelledby="about-collab">
        <CollaborationCard titleId="about-collab" />
      </section>

      <Section id="about-privacy">
        <SectionHeader
          id="about-privacy"
          kicker={t("landing.privacy.kicker")}
          title={t("about.privacy.title")}
        />
        <ul className="grid gap-4 md:grid-cols-2">
          {DATA_POINTS.map(({ icon: Icon, key }) => (
            <li key={key} className="flex gap-4 rounded-[18px] border border-black/10 bg-white p-5">
              <span className="bg-primary-light grid h-11 w-11 shrink-0 place-items-center rounded-xl">
                <Icon size={22} aria-hidden className="text-primary" />
              </span>
              <div>
                <h3 className="font-bold">{t(`about.privacy.${key}.title`)}</h3>
                <p className="text-muted text-[0.9rem]">{t(`about.privacy.${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <div className="flex flex-col gap-4">
        <p
          role="note"
          className="flex items-start gap-3 rounded-2xl border border-[#F3D3BE] bg-[#FCEFE6] px-5 py-4"
        >
          <Info size={24} aria-hidden className="mt-0.5 shrink-0 text-[#A84B18]" />
          <span>
            <strong>{t("landing.notice.title")}</strong> {t("landing.notice.text")}
          </span>
        </p>
        {project.contactEmail && (
          <p className="text-muted flex items-center gap-2">
            <Mail size={20} aria-hidden className="text-primary" />
            {t("about.contact")}{" "}
            <a
              href={`mailto:${project.contactEmail}`}
              className="text-primary font-semibold underline"
            >
              {project.contactEmail}
            </a>
          </p>
        )}
      </div>
    </article>
  );
}
