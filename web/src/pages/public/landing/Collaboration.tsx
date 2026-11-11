import { InstitutionLogo } from "@/components/brand/Identity";
import { project } from "@/config/project";
import { t } from "@/i18n";

import { Container } from "./shared";

function LogoTile({ which }: { which: "institution" | "collaborator" }) {
  return (
    <div className="grid h-[96px] w-[112px] place-items-center rounded-2xl bg-white p-2 sm:h-[104px] sm:w-[180px] sm:p-3">
      <InstitutionLogo
        institution={project[which]}
        height={72}
        fallbackClassName="text-ink text-center text-[0.8rem] leading-snug"
      />
    </div>
  );
}

/** "KUET × The University of Queensland" with both logos and a sentence about the work. */
export function CollaborationCard({ titleId = "collab-title" }: { titleId?: string }) {
  const title = t("landing.collab.title", {
    institution: project.institution.shortName,
    collaborator: project.collaborator.name,
  });
  return (
    <div className="relative grid items-center gap-8 overflow-hidden rounded-[26px] bg-[linear-gradient(120deg,#0F5C5C,#12706B_55%,#1B827B)] px-6 py-9 text-white sm:px-10 lg:grid-cols-[1fr_auto] lg:gap-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(242,167,121,0.35),transparent_65%)]"
      />
      <div className="relative">
        <p className="mb-2 text-[0.75rem] font-bold tracking-[0.12em] text-[#F7C29F] uppercase">
          {t("landing.collab.kicker")}
        </p>
        <h2 id={titleId} className="text-[1.5rem] leading-tight font-extrabold sm:text-[1.7rem]">
          {title}
        </h2>
        <p className="mt-2 max-w-xl text-[0.95rem] text-[#D5EBE8]">
          {t("landing.collab.text", {
            department: project.institution.department ?? "",
            institution: project.institution.shortName,
            collaborator: project.collaborator.name,
            country: project.collaborator.country,
          })}
        </p>
      </div>
      <div className="relative flex items-center justify-center gap-3 sm:gap-6">
        <LogoTile which="institution" />
        <span aria-hidden className="text-[1.8rem] font-extrabold text-[#F7C29F]">
          ×
        </span>
        <LogoTile which="collaborator" />
      </div>
    </div>
  );
}

export function Collaboration() {
  return (
    <section aria-labelledby="collab-title" className="pb-20 lg:pb-28">
      <Container>
        <CollaborationCard />
      </Container>
    </section>
  );
}
