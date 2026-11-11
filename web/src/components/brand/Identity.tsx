import clsx from "clsx";

import { useAssetExists } from "@/config/assets";
import type { Institution, Person } from "@/config/project";

/** "Dr. Md. Abdul Awal" → "AA": the first letters of the first and last names, titles skipped. */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word && !/^(dr|md|mr|mrs|ms|prof)\.?$/i.test(word));
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

/** A person's photo, or their initials while the photo file is missing. Never a broken image. */
export function PersonAvatar({ person, size = 96 }: { person: Person; size?: number }) {
  const exists = useAssetExists(person.photo);
  const style = { width: size, height: size };
  if (exists) {
    return (
      <img
        src={person.photo}
        alt={person.name}
        style={style}
        className="rounded-full object-cover"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={person.name}
      style={{ ...style, fontSize: size / 2.6 }}
      className="bg-primary-light text-primary inline-flex items-center justify-center rounded-full font-bold"
    >
      {initialsOf(person.name)}
    </span>
  );
}

/** An institution's logo, or its name as text while the logo file is missing. */
export function InstitutionLogo({
  institution,
  className,
}: {
  institution: Institution;
  className?: string;
}) {
  const exists = useAssetExists(institution.logo);
  if (exists) {
    return (
      <img
        src={institution.logo}
        alt={institution.name}
        className={clsx("h-16 w-auto object-contain", className)}
      />
    );
  }
  return <span className={clsx("text-lg font-semibold", className)}>{institution.name}</span>;
}
