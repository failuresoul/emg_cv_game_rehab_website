/** Where "Back to home" goes from an address: the patient or admin home, or the public page. */
export function homeForPath(pathname: string): string {
  if (pathname.startsWith("/admin")) return "/admin";
  if (pathname.startsWith("/patient") || pathname.startsWith("/session")) return "/patient";
  return "/";
}
