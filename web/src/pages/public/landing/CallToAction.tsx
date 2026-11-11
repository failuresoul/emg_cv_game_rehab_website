import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { t } from "@/i18n";

import { Container } from "./shared";

export function CallToAction() {
  return (
    <section aria-labelledby="cta-title">
      <Container>
        <div className="flex flex-col items-start justify-between gap-6 rounded-[32px] bg-[radial-gradient(600px_300px_at_90%_0%,rgba(242,167,121,0.4),transparent_60%),linear-gradient(120deg,#0C4B4B,#0F5C5C_50%,#147A75)] px-6 py-12 text-white sm:px-12 sm:py-14 md:flex-row md:items-center">
          <div>
            <h2
              id="cta-title"
              className="text-[1.75rem] leading-tight font-extrabold sm:text-[2.2rem]"
            >
              {t("landing.cta.title")}
            </h2>
            <p className="mt-2 text-[1rem] text-[#D5EBE8]">{t("landing.cta.text")}</p>
          </div>
          <Link
            to="/login"
            className="text-primary inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-7 text-lg font-semibold transition-colors hover:bg-[#E8F2F1] focus-visible:outline-white"
          >
            {t("landing.login")}
            <ArrowRight size={22} aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
}
