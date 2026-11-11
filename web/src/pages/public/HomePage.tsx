import { Gamepad2, type LucideIcon, ShieldCheck, TrendingUp, Video } from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { project } from "@/config/project";
import { t, type TranslationKey } from "@/i18n";

const FEATURES: { titleKey: TranslationKey; icon: LucideIcon }[] = [
  { titleKey: "landing.feature.warmup", icon: Video },
  { titleKey: "landing.feature.games", icon: Gamepad2 },
  { titleKey: "landing.feature.progress", icon: TrendingUp },
];

export function HomePage() {
  return (
    <div className="flex flex-col items-center gap-8 py-8 text-center">
      <div>
        <h1 className="text-primary text-4xl font-bold">{project.name}</h1>
        <p className="mt-3 max-w-2xl text-xl">{t("landing.tagline")}</p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/login" className={buttonClasses("primary", "lg")}>
          {t("nav.login")}
        </Link>
        <Link to="/signup" className={buttonClasses("secondary", "lg")}>
          {t("signup.action")}
        </Link>
      </div>

      <div className="grid w-full gap-4 md:grid-cols-3">
        {FEATURES.map(({ titleKey, icon: Icon }) => (
          <Card key={titleKey} className="flex flex-col items-center gap-3">
            <Icon size={40} aria-hidden className="text-primary" />
            <h2 className="text-lg font-semibold">{t(titleKey)}</h2>
          </Card>
        ))}
      </div>

      <p className="bg-primary-light text-primary flex items-center gap-2 rounded-lg px-4 py-3 font-medium">
        <ShieldCheck size={24} aria-hidden className="shrink-0" />
        {t("landing.privacy")}
      </p>
    </div>
  );
}
