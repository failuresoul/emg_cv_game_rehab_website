import clsx from "clsx";

import { project } from "@/config/project";
import { t } from "@/i18n";

/** "MuVi Rehab · Dept. of CSE, KUET · in collaboration with The University of Queensland". */
export function creditText(): string {
  const { institution, collaborator } = project;
  return t("credit.line", {
    name: project.name,
    department: [institution.departmentShort, institution.shortName].filter(Boolean).join(", "),
    collaborator: collaborator.name,
  });
}

/** The small grey credit at the foot of the admin and patient areas and the login page. */
export function CreditLine({ className }: { className?: string }) {
  return (
    <p className={clsx("text-muted text-[0.8rem]", className)} data-testid="credit-line">
      {creditText()}
    </p>
  );
}
