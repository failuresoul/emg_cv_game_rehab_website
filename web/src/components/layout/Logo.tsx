import { Link } from "react-router";

import { LogoMark } from "@/components/brand/LogoMark";
import { project } from "@/config/project";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link
      to={to}
      className="text-primary inline-flex min-h-11 items-center gap-2 text-xl font-bold"
    >
      <LogoMark size={32} />
      {project.name}
    </Link>
  );
}
