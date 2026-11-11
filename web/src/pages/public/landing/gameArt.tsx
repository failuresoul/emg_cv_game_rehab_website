import type { ReactNode } from "react";

import type { GameId } from "@/types/api";

/** Original illustrations of the nine games, drawn from simple shapes on a 160 × 110 grid. */
export const GAME_ART: Readonly<Record<GameId, { background: string; art: ReactNode }>> = {
  reach_activate: {
    background: "#E9F4F2",
    art: (
      <>
        <circle cx="110" cy="45" r="30" fill="#F7C29F" fillOpacity="0.6" />
        <circle
          cx="110"
          cy="45"
          r="18"
          fill="none"
          stroke="#D9682B"
          strokeWidth="5"
          strokeDasharray="80 40"
          transform="rotate(-90 110 45)"
        />
        <path
          d="M30 90 L70 66 L100 52"
          stroke="#0F5C5C"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="30" cy="90" r="6" fill="#0F5C5C" />
      </>
    ),
  },
  balloon_pop: {
    background: "#EEF3FB",
    art: (
      <>
        <ellipse cx="60" cy="40" rx="20" ry="24" fill="#E57373" />
        <path d="M60 64 q-4 14 2 34" stroke="#90A4AE" strokeWidth="2" fill="none" />
        <ellipse cx="106" cy="30" rx="17" ry="21" fill="#64B5F6" />
        <path d="M106 51 q4 14 -2 40" stroke="#90A4AE" strokeWidth="2" fill="none" />
        <ellipse cx="128" cy="66" rx="13" ry="16" fill="#FFD54F" />
        <circle cx="36" cy="88" r="8" fill="#fff" />
        <circle cx="48" cy="86" r="10" fill="#fff" />
      </>
    ),
  },
  fruit_catch: {
    background: "#F1F8EC",
    art: (
      <>
        <circle cx="58" cy="24" r="11" fill="#E53935" />
        <path d="M58 13 q4 -6 9 -6" stroke="#558B2F" strokeWidth="3" fill="none" />
        <circle cx="104" cy="44" r="11" fill="#FFB300" />
        <path d="M40 78 h60 l-8 24 h-44z" fill="#A1887F" />
        <path d="M44 86 h52 M48 94 h44" stroke="#795548" strokeWidth="2" />
        <path
          d="M18 60 l10 0 M132 60 l10 0"
          stroke="#9CCC65"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </>
    ),
  },
  bloom: {
    background: "#FBF0F5",
    art: (
      <>
        <g transform="translate(80 46)">
          <ellipse rx="10" ry="24" fill="#F48FB1" />
          <ellipse rx="10" ry="24" fill="#F06292" transform="rotate(60)" />
          <ellipse rx="10" ry="24" fill="#F48FB1" transform="rotate(120)" />
          <circle r="9" fill="#FFD54F" />
        </g>
        <path d="M80 70 v36" stroke="#66BB6A" strokeWidth="4" />
        <ellipse cx="92" cy="88" rx="10" ry="5" fill="#81C784" transform="rotate(-30 92 88)" />
      </>
    ),
  },
  finger_piano: {
    background: "#F3EEF9",
    art: (
      <>
        <rect x="28" y="20" width="22" height="60" rx="6" fill="#26A69A" />
        <rect x="56" y="34" width="22" height="46" rx="6" fill="#42A5F5" />
        <rect x="84" y="14" width="22" height="66" rx="6" fill="#AB47BC" />
        <rect x="112" y="40" width="22" height="40" rx="6" fill="#FF7043" />
        <rect x="20" y="84" width="122" height="6" rx="3" fill="#B39DDB" />
        <circle cx="39" cy="10" r="4" fill="#26A69A" />
      </>
    ),
  },
  path_trace: {
    background: "#EAF4F3",
    art: (
      <>
        <path
          d="M18 84 C50 20 90 100 142 30"
          stroke="#B2DFDB"
          strokeWidth="20"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M18 84 C50 20 90 100 142 30"
          stroke="#0F5C5C"
          strokeWidth="3"
          fill="none"
          strokeDasharray="6 6"
        />
        <circle cx="96" cy="64" r="11" fill="#E53935" />
        <circle cx="92" cy="61" r="2" fill="#212121" />
        <circle cx="99" cy="67" r="2" fill="#212121" />
        <path d="M96 53 v22" stroke="#212121" strokeWidth="1.5" />
      </>
    ),
  },
  paint_wall: {
    background: "#FDF2EA",
    art: (
      <>
        <rect x="24" y="14" width="112" height="82" rx="6" fill="#fff" stroke="#F3D3BE" />
        <rect x="34" y="40" width="16" height="50" fill="#26A69A" />
        <rect x="56" y="24" width="16" height="66" fill="#FFB74D" />
        <rect x="78" y="34" width="16" height="56" fill="#E57373" fillOpacity="0.85" />
        <rect x="100" y="60" width="16" height="30" fill="#64B5F6" fillOpacity="0.6" />
        <rect x="104" y="44" width="8" height="18" rx="2" fill="#8D6E63" />
        <rect x="101" y="36" width="14" height="10" rx="3" fill="#64B5F6" />
      </>
    ),
  },
  pick_place: {
    background: "#EEF6EF",
    art: (
      <>
        <rect x="94" y="56" width="50" height="38" rx="5" fill="#A1887F" />
        <path d="M94 56 l10 -12 h30 l10 12" fill="#BCAAA4" />
        <rect x="28" y="30" width="26" height="26" rx="6" fill="#42A5F5" />
        <path
          d="M60 40 C74 26 90 28 104 40"
          stroke="#2E7D4F"
          strokeWidth="3"
          fill="none"
          strokeDasharray="5 6"
        />
        <path d="M104 40 l-8 -2 l4 8z" fill="#2E7D4F" />
      </>
    ),
  },
  grip_hold: {
    background: "#EAF3FB",
    art: (
      <>
        <rect x="0" y="34" width="160" height="26" fill="#C8E6C9" />
        <path d="M78 30 l16 16 l-16 16 l-16 -16z" fill="#FF7043" />
        <path d="M78 30 v32 M62 46 h32" stroke="#fff" strokeWidth="2" />
        <path d="M78 62 q8 14 -4 22 q-10 8 2 18" stroke="#90A4AE" strokeWidth="2" fill="none" />
        <circle cx="30" cy="20" r="9" fill="#fff" />
        <circle cx="40" cy="18" r="11" fill="#fff" />
      </>
    ),
  },
};
