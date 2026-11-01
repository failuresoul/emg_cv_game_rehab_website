import { Activity } from "lucide-react";
import { Link } from "react-router";

import { t } from "@/i18n";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link
      to={to}
      className="text-primary inline-flex min-h-11 items-center gap-2 text-xl font-bold"
    >
      <Activity size={28} aria-hidden />
      {t("app.name")}
    </Link>
  );
}
