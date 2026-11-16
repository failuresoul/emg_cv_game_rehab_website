import { LogOut } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { t } from "@/i18n";

/** The user's name and role, and Log out; on phones only the Log out icon (its name stays for
 * screen readers). */
export function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
      <span className="hidden max-w-48 truncate font-medium lg:inline">{user.full_name}</span>
      <span className="hidden lg:inline-flex">
        <Badge>{t(user.role === "admin" ? "role.admin" : "role.patient")}</Badge>
      </span>
      <Button variant="ghost" onClick={logout} className="max-sm:px-2">
        <LogOut size={20} aria-hidden />
        <span className="sr-only sm:not-sr-only">{t("nav.logout")}</span>
      </Button>
    </div>
  );
}
