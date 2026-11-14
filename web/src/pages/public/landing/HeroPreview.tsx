import { Lock } from "lucide-react";

import { GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";

/** One period of a forearm EMG envelope (rest, a squeeze, rest), 270 units wide. It starts and
 * ends at the same height, so two copies side by side scroll without a seam. */
const EMG_ENVELOPE =
  "M0 62 C20 62 30 61 45 60 C60 58 70 50 85 38 C100 26 115 24 130 26 C145 28 150 22 165 25 " +
  "C180 28 190 26 200 30 C212 36 222 52 236 60 C248 62 260 62 270 62";

function GameScreen() {
  return (
    <svg viewBox="0 0 560 430" className="block h-auto w-full" aria-hidden focusable="false">
      <defs>
        <linearGradient id="hp-screen" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#10242A" />
          <stop offset="1" stopColor="#0A1517" />
        </linearGradient>
        <radialGradient id="hp-target" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#F7C29F" />
          <stop offset="0.6" stopColor="#D9682B" stopOpacity="0.55" />
          <stop offset="1" stopColor="#D9682B" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hp-arm" x1="0" x2="1">
          <stop offset="0" stopColor="#7FC6BF" />
          <stop offset="1" stopColor="#E6F2F0" />
        </linearGradient>
        <clipPath id="hp-clip">
          <rect width="560" height="430" rx="28" />
        </clipPath>
      </defs>
      <g clipPath="url(#hp-clip)">
        <rect width="560" height="430" fill="url(#hp-screen)" />
        {/* Title bar */}
        <text x="24" y="34" fill="#E6F2F0" fontSize="14" fontWeight="600">
          {t(GAMES.reach_activate.nameKey)}
          <tspan fill="#8FB3B0" fontWeight="400">
            {"  ·  "}
            {t("landing.preview.target", { n: 7, total: 20 })}
          </tspan>
        </text>
        <g fill="#28414A">
          <circle cx="500" cy="29" r="4.5" />
          <circle cx="515" cy="29" r="4.5" />
          <circle cx="530" cy="29" r="4.5" />
        </g>
        <g transform="translate(0 50)">
          {/* Grid */}
          <g stroke="#1E3A40" strokeWidth="1">
            {[80, 160, 240, 320].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2="560" y2={y} />
            ))}
            {[110, 220, 330, 440].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2="380" />
            ))}
          </g>
          {/* Reach map */}
          <polygon
            points="228,176 300,78 400,70 466,130 470,226 404,300 300,312 236,262"
            fill="#147A75"
            fillOpacity="0.22"
            stroke="#3FA39C"
            strokeWidth="1.5"
            strokeDasharray="6 6"
          />
          <text x="452" y="334" fill="#6FB0A9" fontSize="13" textAnchor="end">
            {t("landing.preview.reachMap")}
          </text>
          {/* Skeleton */}
          <circle cx="160" cy="112" r="30" fill="none" stroke="#7FC6BF" strokeWidth="4" />
          <g stroke="#7FC6BF" strokeWidth="6" strokeLinecap="round">
            <line x1="104" y1="176" x2="228" y2="176" />
            <line x1="166" y1="176" x2="166" y2="340" />
          </g>
          <line
            x1="104"
            y1="176"
            x2="88"
            y2="260"
            stroke="#4D8D88"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M228 176 L318 142 L398 108"
            stroke="url(#hp-arm)"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="228" cy="176" r="7" fill="#fff" />
          <circle cx="318" cy="142" r="7" fill="#fff" />
          <g fill="#fff">
            <circle cx="404" cy="104" r="4.5" />
            <circle cx="414" cy="92" r="3.2" />
            <circle cx="420" cy="100" r="3.2" />
            <circle cx="420" cy="109" r="3.2" />
            <circle cx="413" cy="117" r="3.2" />
          </g>
          <path
            d="M320 150 Q360 135 396 112"
            stroke="#F2A779"
            strokeOpacity="0.5"
            strokeWidth="2"
            strokeDasharray="3 6"
            fill="none"
          />
          {/* Target with its dwell ring */}
          <circle cx="424" cy="98" r="52" fill="url(#hp-target)" />
          <circle
            cx="424"
            cy="98"
            r="34"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.25"
            strokeWidth="5"
          />
          <circle
            cx="424"
            cy="98"
            r="34"
            fill="none"
            stroke="#fff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="160 214"
            transform="rotate(-90 424 98)"
          />
          <rect x="350" y="158" width="150" height="32" rx="16" fill="#D9682B" />
          <text x="425" y="179" fill="#fff" fontSize="14" fontWeight="700" textAnchor="middle">
            {t("landing.preview.hold")}
          </text>
        </g>
      </g>
    </svg>
  );
}

function LevelCard() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-[0_24px_50px_-24px_rgba(10,40,45,0.45)]">
      <svg viewBox="0 0 54 54" width="54" height="54" aria-hidden focusable="false">
        <circle cx="27" cy="27" r="22" fill="none" stroke="#E6F2F0" strokeWidth="6" />
        <circle
          cx="27"
          cy="27"
          r="22"
          fill="none"
          stroke="#0F5C5C"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="96 138"
          transform="rotate(-90 27 27)"
        />
        <text x="27" y="32.5" textAnchor="middle" fontSize="16" fontWeight="800" fill="#14222A">
          6
        </text>
      </svg>
      <div className="leading-tight">
        <span className="text-primary block text-[0.65rem] font-bold tracking-[0.08em] uppercase">
          {t("landing.preview.level", { n: 6 })}
        </span>
        <span className="block text-[1.05rem] font-extrabold">
          {t("landing.preview.justRight")}
        </span>
      </div>
    </div>
  );
}

function EmgCard() {
  return (
    <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-[0_24px_50px_-24px_rgba(10,40,45,0.45)] sm:w-[300px]">
      <div className="text-muted flex items-center justify-between text-[0.72rem] font-semibold">
        <span>{t("landing.preview.emg")}</span>
        <span className="flex items-center gap-1.5 text-[#A84B18] uppercase">
          <span className="bg-accent inline-block h-2 w-2 rounded-full" />
          {t("landing.preview.live")}
        </span>
      </div>
      <p className="text-[1.5rem] leading-tight font-extrabold">
        42
        <span className="text-muted ml-1 text-[0.8rem] font-semibold">
          {t("landing.preview.mvcUnit")}
        </span>
      </p>
      <svg viewBox="0 0 270 70" className="mt-1 block h-auto w-full" aria-hidden focusable="false">
        <defs>
          <clipPath id="hp-emg-clip">
            <rect width="270" height="70" />
          </clipPath>
        </defs>
        <rect x="0" y="16" width="270" height="22" rx="6" fill="#E6F2F0" />
        <text x="264" y="31" fill="#0F5C5C" fontSize="10" fontWeight="700" textAnchor="end">
          {t("landing.preview.targetBand")}
        </text>
        <g clipPath="url(#hp-emg-clip)">
          <g className="landing-emg-flow">
            {[0, 270].map((x) => (
              <path
                key={x}
                d={EMG_ENVELOPE}
                transform={`translate(${x} 0)`}
                fill="none"
                stroke="#D9682B"
                strokeWidth="3"
                strokeLinecap="round"
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

/** The hero's picture of a game in progress. Decorative, so it is one image to assistive
 * technology, described by its label. */
export function HeroPreview() {
  return (
    <div
      role="img"
      aria-label={t("landing.preview.label")}
      className="relative mx-auto w-full max-w-[600px] lg:pb-20"
    >
      <div className="relative rounded-[28px] shadow-[0_50px_90px_-40px_rgba(10,40,45,0.65)]">
        <GameScreen />
      </div>
      <div className="text-primary absolute -top-4 right-4 hidden items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-[0.75rem] font-semibold shadow-lg sm:flex">
        <Lock size={16} aria-hidden />
        {t("landing.preview.privacy")}
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:absolute lg:right-[-12px] lg:bottom-0 lg:left-[-24px] lg:mt-0">
        <LevelCard />
        <EmgCard />
      </div>
    </div>
  );
}
