import clsx from "clsx";
import { type CSSProperties, useState } from "react";

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

/** An image that is shown only once the file is known to exist, and hidden again if it fails. */
function useShownImage(path: string): [boolean, () => void] {
  const exists = useAssetExists(path);
  const [failed, setFailed] = useState<string | null>(null);
  return [exists && failed !== path, () => setFailed(path)];
}

interface PersonAvatarProps {
  person: Person;
  size?: number;
  /** The photo's alt text; the name by default. */
  alt?: string;
  loading?: "lazy" | "eager";
  className?: string;
}

/** A person's photo, or their initials while the photo file is missing. Never a broken image. */
export function PersonAvatar({
  person,
  size = 96,
  alt,
  loading = "lazy",
  className,
}: PersonAvatarProps) {
  const [shown, onError] = useShownImage(person.photo);
  const style: CSSProperties = { width: size, height: size };
  if (shown) {
    return (
      <img
        src={person.photo}
        alt={alt ?? person.name}
        width={size}
        height={size}
        loading={loading}
        decoding="async"
        onError={onError}
        style={style}
        className={clsx("rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={alt ?? person.name}
      style={{ ...style, fontSize: size / 2.6 }}
      className={clsx(
        "bg-primary-light text-primary inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        className,
      )}
    >
      {initialsOf(person.name)}
    </span>
  );
}

interface InstitutionLogoProps {
  institution: Institution;
  /** The logo's height in pixels; its width follows the image's own proportions. */
  height?: number;
  /** "short" shows the short name (such as "KUET") while the logo is missing. */
  fallback?: "name" | "short";
  className?: string;
  fallbackClassName?: string;
}

/** An institution's logo, or its name as text while the logo file is missing. */
export function InstitutionLogo({
  institution,
  height = 64,
  fallback = "name",
  className,
  fallbackClassName,
}: InstitutionLogoProps) {
  const [shown, onError] = useShownImage(institution.logo);
  if (shown) {
    return (
      <img
        src={institution.logo}
        alt={institution.name}
        height={height}
        loading="lazy"
        decoding="async"
        onError={onError}
        style={{ height, width: "auto" }}
        className={clsx("object-contain", className)}
      />
    );
  }
  return (
    <span className={clsx("font-semibold", fallbackClassName ?? "text-lg")}>
      {fallback === "short" ? institution.shortName : institution.name}
    </span>
  );
}
