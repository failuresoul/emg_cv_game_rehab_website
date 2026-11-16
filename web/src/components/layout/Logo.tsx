import { Link } from "react-router";

import { LogoMark } from "@/components/brand/LogoMark";
import { project } from "@/config/project";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link
      to={to}
      className="text-primary inline-flex min-h-11 shrink-0 items-center gap-1.5 text-base font-bold whitespace-nowrap sm:gap-2 sm:text-xl"
    >
      <LogoMark size={32} />
      {project.name}
    </Link>
  );
}
