import clsx from "clsx";

import { PersonAvatar } from "@/components/brand/Identity";
import { type Person, project } from "@/config/project";
import { t } from "@/i18n";

import { Container, SECTION_IDS, SectionHeader } from "./shared";

const PHOTO = 160;

function PersonCard({ person, tone }: { person: Person; tone: "primary" | "accent" }) {
  return (
    <li className="flex flex-col items-center rounded-3xl border border-black/10 bg-white px-6 pt-8 pb-7 text-center shadow-[0_24px_40px_-36px_rgba(10,40,45,0.6)]">
      <div
        className={clsx(
          "mb-5 rounded-full p-[5px]",
          tone === "primary"
            ? "bg-[linear-gradient(135deg,#0F5C5C,#2A9D8F)]"
            : "bg-[linear-gradient(135deg,#D9682B,#F2A779)]",
        )}
      >
        <PersonAvatar
          person={person}
          size={PHOTO}
          alt={t("landing.team.photoOf", { name: person.name })}
          className="border-4 border-white"
        />
      </div>
      <h4 className="text-[1.15rem] leading-snug font-extrabold">{person.name}</h4>
      <p
        className={clsx(
          "mt-2.5 mb-1.5 rounded-full px-3 py-1 text-[0.7rem] font-bold tracking-[0.06em] uppercase",
          tone === "primary" ? "bg-primary-light text-primary" : "bg-[#FCEFE6] text-[#9C4515]",
        )}
      >
        {person.role}
      </p>
      <p className="text-muted text-[0.88rem]">{person.affiliation}</p>
    </li>
  );
}

function Group({
  titleId,
  title,
  people,
  tone,
}: {
  titleId: string;
  title: string;
  people: readonly Person[];
  tone: "primary" | "accent";
}) {
  return (
    <div className="mb-12 last:mb-0">
      <h3
        id={titleId}
        className="text-muted mb-6 text-center text-[0.78rem] font-bold tracking-[0.12em] uppercase"
      >
        {title}
      </h3>
      <ul
        aria-labelledby={titleId}
        className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2 sm:gap-8"
      >
        {people.map((person) => (
          <PersonCard key={person.name} person={person} tone={tone} />
        ))}
      </ul>
    </div>
  );
}

/** "Supervisors" and "Research team", with a card for each person in project.ts. */
export function TeamGroups({ idPrefix = "team" }: { idPrefix?: string }) {
  return (
    <>
      <Group
        titleId={`${idPrefix}-supervisors`}
        title={t("landing.team.supervisors")}
        people={project.supervisors}
        tone="primary"
      />
      <Group
        titleId={`${idPrefix}-researchers`}
        title={t("landing.team.researchers")}
        people={project.team}
        tone="accent"
      />
    </>
  );
}

export function Team() {
  return (
    <section
      id={SECTION_IDS.team}
      aria-labelledby="team-title"
      className="scroll-mt-24 bg-[linear-gradient(180deg,#FFFFFF,#F4F7F7)] py-20 lg:py-24"
    >
      <Container>
        <SectionHeader
          id="team-title"
          center
          kicker={t("landing.team.kicker")}
          title={t("landing.team.title")}
        />
        <TeamGroups />
      </Container>
    </section>
  );
}
