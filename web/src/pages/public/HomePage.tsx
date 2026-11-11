import { t } from "@/i18n";

import { CallToAction } from "./landing/CallToAction";
import { Collaboration } from "./landing/Collaboration";
import { Games } from "./landing/Games";
import { Hero } from "./landing/Hero";
import { HowItWorks } from "./landing/HowItWorks";
import { LandingFooter } from "./landing/LandingFooter";
import { LandingNavbar } from "./landing/LandingNavbar";
import { Privacy } from "./landing/Privacy";
import { Research } from "./landing/Research";
import { Stats } from "./landing/Stats";
import { Team } from "./landing/Team";

/** The public landing page: what the project is, who makes it, and the way in. It has its own
 * navbar and footer, outside the public layout. No version number. */
export function HomePage() {
  return (
    <div className="bg-background min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="bg-primary sr-only z-50 rounded-lg px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("landing.skip")}
      </a>
      <LandingNavbar />
      <main id="main">
        <Hero />
        <Stats />
        <HowItWorks />
        <Games />
        <Research />
        <Team />
        <Collaboration />
        <Privacy />
        <CallToAction />
      </main>
      <LandingFooter />
    </div>
  );
}
