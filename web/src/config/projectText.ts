import { t, type TranslationKey } from "@/i18n";

import { project } from "./project";

/**
 * The descriptive parts of project.ts in the interface language. Names (people, institutions,
 * the department, the research title) are shown as they are in project.ts; only words that
 * describe them are translated. English always comes from project.ts itself.
 */

const COUNTRY_KEYS: Record<string, TranslationKey> = {
  Bangladesh: "project.country.bangladesh",
  Australia: "project.country.australia",
};

const ROLE_KEYS: Record<string, TranslationKey> = {
  Supervisor: "project.role.supervisor",
  "Developer & Researcher": "project.role.developerResearcher",
};

export function taglineText(): string {
  return t("project.tagline");
}

export function expansionText(): string {
  return t("project.expansion");
}

/** A country from project.ts in the interface language; an unknown one as it is. */
export function countryText(country: string): string {
  const key = COUNTRY_KEYS[country];
  return key ? t(key) : country;
}

export function roleText(role: string): string {
  const key = ROLE_KEYS[role];
  return key ? t(key) : role;
}

/** Every country and role project.ts uses has a translation (checked by a test). */
export function untranslatedProjectWords(): string[] {
  const countries = [project.institution.country, project.collaborator.country];
  const roles = [...project.supervisors, ...project.team].map((person) => person.role);
  return [
    ...countries.filter((country) => !(country in COUNTRY_KEYS)),
    ...roles.filter((role) => !(role in ROLE_KEYS)),
  ];
}
