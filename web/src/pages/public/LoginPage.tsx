import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, type Location, Navigate, useLocation } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/features/auth/AuthContext";
import { AuthLoading, HOME_PATH } from "@/features/auth/guards";
import { t } from "@/i18n";
import { SILENT } from "@/lib/apiErrors";

function errorMessage(error: unknown): string {
  const invalid = axios.isAxiosError(error) && error.response?.status === 401;
  return t(invalid ? "login.error.invalid" : "login.error.generic");
}

export function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useMutation({
    mutationFn: () => login(email, password),
    // The form explains the error next to the field, so no toast.
    meta: SILENT,
  });

  if (isLoading) return <AuthLoading />;

  if (user) {
    // RequireRole sends a remembered page of the wrong role to this user's own home.
    const from = (location.state as { from?: Location } | null)?.from;
    const target = from ? `${from.pathname}${from.search}${from.hash}` : HOME_PATH[user.role];
    return <Navigate to={target} replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  return (
    <Card className="mx-auto max-w-md">
      <PageHeader title={t("page.public.login.title")} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label={t("login.email")}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label={t("login.password")}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          trailing={
            <button
              type="button"
              aria-label={t(showPassword ? "login.hidePassword" : "login.showPassword")}
              onClick={() => setShowPassword((shown) => !shown)}
              className="text-muted hover:text-ink inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
            >
              {showPassword ? <EyeOff size={22} aria-hidden /> : <Eye size={22} aria-hidden />}
            </button>
          }
        />
        {loginMutation.isError && (
          <p role="alert" className="text-danger font-medium">
            {errorMessage(loginMutation.error)}
          </p>
        )}
        <Button type="submit" size="lg" loading={loginMutation.isPending}>
          {t("login.submit")}
        </Button>
      </form>
      <p className="mt-6 text-center">
        {t("login.noAccount")}{" "}
        <Link to="/signup" className="text-primary font-semibold underline">
          {t("signup.action")}
        </Link>
      </p>
    </Card>
  );
}
