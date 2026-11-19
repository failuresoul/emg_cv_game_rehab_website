/**
 * The project's identity: the only place its name, research title, institutions and people are
 * written. Pages, layouts, the tab title and the favicon read from here.
 *
 * Internal identifiers use "muvi" (storage keys, the database file). The old internal code name
 * is gone; config/branding.test.ts makes sure it never appears in anything a user sees.
 */

/** Set by Vite from package.json; absent when vite.config.ts itself reads this file. */
declare const __APP_VERSION__: string;

export interface Person {
  name: string;
  role: string;
  affiliation: string;
  /** Under web/public; initials are shown while it is missing. */
  photo: string;
}

export interface Institution {
  name: string;
  /** For tight spaces, such as "KUET × UniSQ". */
  shortName: string;
  department?: string;
  /** As in "Dept. of CSE, KUET". */
  departmentShort?: string;
  country: string;
  /** Under web/public; the name is shown as text while it is missing. */
  logo: string;
}

export const project = {
  name: "MuVi Rehab",
  nameLong: "MuVi Rehab — Muscle + Vision Rehabilitation",
  /** What "MuVi" stands for. */
  expansion: "Muscle + Vision Rehabilitation",
  tagline: "EMG and vision-guided home rehabilitation for stroke",
  /** The browser tab title. */
  tabTitle: "MuVi Rehab — EMG & vision rehabilitation",
  researchTitle:
    "Multimodal EMG and Webcam-Based Hand Posture Recognition for Real-Time Adaptive Rehabilitation Gaming",
  institution: {
    name: "Khulna University of Engineering & Technology (KUET)",
    shortName: "KUET",
    department: "Department of Computer Science and Engineering",
    departmentShort: "Dept. of CSE",
    country: "Bangladesh",
    logo: "/logos/kuet.png",
  } satisfies Institution,
  collaborator: {
    name: "University of Southern Queensland",
    shortName: "UniSQ",
    country: "Australia",
    logo: "/logos/unisq.svg",
  } satisfies Institution,
  supervisors: [
    {
      name: "Dr. Muhammad Aminul Haque Akhand",
      role: "Supervisor",
      affiliation: "Professor, Dept. of CSE, KUET",
      photo: "/team/akhand.jpg",
    },
    {
      name: "Dr. Md. Abdul Awal",
      role: "Supervisor",
      affiliation:
        "Lecturer, Electrical and Electronic Engineering, University of Southern Queensland",
      photo: "/team/awal.jpg",
    },
  ] satisfies Person[],
  team: [
    {
      name: "Nurul Absar Shadik",
      role: "Developer & Researcher",
      affiliation: "Dept. of CSE, KUET",
      photo: "/team/shadik.jpg",
    },
    {
      name: "Nafis Ahammad",
      role: "Developer & Researcher",
      affiliation: "Dept. of CSE, KUET",
      photo: "/team/nafis.jpg",
    },
  ] satisfies Person[],
  /** Shown on the About page when set; none yet. */
  contactEmail: null as string | null,
  /** From package.json. Shown only on the admin System page, never on public pages. */
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
} as const;
