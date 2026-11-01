import { LogOut } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { t } from "@/i18n";

export function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span className="font-medium">{user.full_name}</span>
      <Badge>{t(user.role === "admin" ? "role.admin" : "role.patient")}</Badge>
      <Button variant="ghost" onClick={logout}>
        <LogOut size={20} aria-hidden />
        {t("nav.logout")}
      </Button>
    </div>
  );
}
