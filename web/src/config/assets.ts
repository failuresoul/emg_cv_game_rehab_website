import { useEffect, useState } from "react";

/**
 * Whether an image under web/public exists, checked once per path. A missing file comes back as
 * the app's HTML page (the server's fallback for unknown paths), so only an image response
 * counts. Never rejects.
 */
const checked = new Map<string, Promise<boolean>>();

export function assetExists(path: string): Promise<boolean> {
  let result = checked.get(path);
  if (!result) {
    result = fetch(path, { method: "HEAD" })
      .then(
        (response) =>
          response.ok && (response.headers.get("content-type") ?? "").startsWith("image/"),
      )
      .catch(() => false);
    checked.set(path, result);
  }
  return result;
}

/** For tests: forget earlier checks. */
export function resetAssetChecks(): void {
  checked.clear();
}

/** True once the image is known to exist; false while checking or when it is missing. */
export function useAssetExists(path: string): boolean {
  const [found, setFound] = useState<{ path: string; exists: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void assetExists(path).then((exists) => {
      if (active) setFound({ path, exists });
    });
    return () => {
      active = false;
    };
  }, [path]);
  return found?.path === path && found.exists;
}
