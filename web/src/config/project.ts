/**
 * The project's identity: the only place its name, research title, institutions and people are
 * written. Pages, layouts, the tab title and the favicon read from here.
 *
 * Internal identifiers keep the code name "motionlab" (storage keys, package names, the database
 * file); nothing a user sees should.
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
  department?: string;
  country: string;
  /** Under web/public; the name is shown as text while it is missing. */
  logo: string;
}

export const project = {
  name: "MuVi Rehab",
  nameLong: "MuVi Rehab — Muscle + Vision Rehabilitation",
  tagline: "EMG and vision-guided home rehabilitation for stroke",
  /** The browser tab title. */
  tabTitle: "MuVi Rehab — EMG & vision rehabilitation",
  researchTitle:
    "Multimodal EMG and Webcam-Based Hand Posture Recognition for Real-Time Adaptive Rehabilitation Gaming",
  institution: {
    name: "Khulna University of Engineering & Technology (KUET)",
    department: "Department of Computer Science and Engineering",
    country: "Bangladesh",
    logo: "/logos/kuet.png",
  } satisfies Institution,
  collaborator: {
    name: "The University of Queensland",
    country: "Australia",
    logo: "/logos/uq.png",
  } satisfies Institution,
  supervisors: [
    {
      name: "Dr. Muhammad Aminul Haque Akhand",
      role: "Supervisor",
      affiliation: "Dept. of CSE, KUET",
      photo: "/team/akhand.jpg",
    },
    {
      name: "Dr. Md. Abdul Awal",
      role: "Supervisor",
      affiliation: "Postdoctoral Research Fellow, The University of Queensland",
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
  /** From package.json. Shown only on the admin System page, never on public pages. */
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
} as const;
