import type { EmgSite } from "@/emg/emgFlow";
import { t } from "@/i18n";

/**
 * A simple forearm, elbow on the left and wrist on the right, with the three electrodes:
 * mid-muscle on the muscle belly (a third of the way from the elbow), end-muscle 2-3 cm towards the
 * wrist, and the reference on the elbow bone. Inner (palm side) for the flexors, outer for the
 * extensors.
 */
export function ElectrodeDiagram({ site }: { site: EmgSite }) {
  const fill = site === "flexors" ? "#f2d4c2" : "#e7c3ad";
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 320 140"
        className="w-full max-w-sm"
        role="img"
        aria-labelledby="electrode-title"
      >
        <title id="electrode-title">
          {t(site === "flexors" ? "emg.diagram.flexors" : "emg.diagram.extensors")}
        </title>
        {/* Forearm */}
        <path
          d="M30 50 Q 40 35 70 38 L 270 52 Q 300 55 300 70 Q 300 85 270 88 L 70 102 Q 40 105 30 90 Z"
          fill={fill}
          stroke="#8a6a58"
          strokeWidth="2"
        />
        {/* Muscle belly */}
        <ellipse cx="120" cy="70" rx="45" ry="18" fill="#d9682b" opacity="0.25" />
        {/* Elbow bone */}
        <circle cx="38" cy="70" r="9" fill="#ffffff" stroke="#8a6a58" strokeWidth="2" />
        {/* Electrodes */}
        <g fontSize="11" fill="#ffffff" fontWeight="bold" textAnchor="middle">
          <circle cx="38" cy="70" r="7" fill="#5e6b70" />
          <text x="38" y="74">
            R
          </text>
          <circle cx="115" cy="70" r="9" fill="#0f5c5c" />
          <text x="115" y="74">
            M
          </text>
          <circle cx="160" cy="72" r="9" fill="#0f5c5c" />
          <text x="160" y="76">
            E
          </text>
        </g>
        <g fontSize="11" fill="currentColor">
          <text x="38" y="125" textAnchor="middle">
            {t("emg.diagram.reference")}
          </text>
          <text x="115" y="22" textAnchor="middle">
            {t("emg.diagram.mid")}
          </text>
          <text x="175" y="125" textAnchor="middle">
            {t("emg.diagram.end")}
          </text>
          <text x="290" y="22" textAnchor="end">
            {t("emg.diagram.wrist")}
          </text>
        </g>
      </svg>
      <figcaption className="text-center text-sm opacity-80">
        {t(site === "flexors" ? "emg.diagram.flexors" : "emg.diagram.extensors")}
      </figcaption>
    </figure>
  );
}
