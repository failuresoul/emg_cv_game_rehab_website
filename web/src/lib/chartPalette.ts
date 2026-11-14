/**
 * Colours for charts with several series, safe for colour-blind readers: Okabe-Ito based, with
 * the purple darkened to 3:1 on white. Checked with the dataviz palette validator (lightness,
 * chroma, colour-blind separation, contrast: all pass). Every series also has its own dash
 * pattern, so the lines differ without colour too.
 */
export const CATEGORICAL = ["#0072B2", "#D55E00", "#009E73", "#A9488A"] as const;

/** Solid, long dash, dots, dash-dot: one per series, in the same order as CATEGORICAL. */
export const DASHES = ["0", "10 4", "3 3", "12 3 3 3"] as const;
