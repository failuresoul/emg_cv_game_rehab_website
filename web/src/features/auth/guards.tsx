import { Navigate, Outlet, useLocation } from "react-router";

import { Spinner } from "@/components/ui/Spinner";
import type { Role } from "@/types/user";

import { useAuth } from "./AuthContext";

export const HOME_PATH: Record<Role, string> = {
  admin: "/admin",
  patient: "/patient",
};

export function AuthLoading() {
  return (
    <div className="text-primary flex min-h-dvh items-center justify-center">
      <Spinner size={48} />
    </div>
  );
}

export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Use inside RequireAuth. */
export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();

  if (user && user.role !== role) return <Navigate to={HOME_PATH[user.role]} replace />;
  return <Outlet />;
}
