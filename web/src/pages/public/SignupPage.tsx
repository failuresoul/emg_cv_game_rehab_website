import { useMutation } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { PatientForm } from "@/features/admin/PatientForm";
import { useAuth } from "@/features/auth/AuthContext";
import { AuthLoading, HOME_PATH } from "@/features/auth/guards";
import { t } from "@/i18n";
import type { PatientRegister } from "@/types/api";

export function SignupPage() {
  const { user, isLoading, register } = useAuth();
  const signup = useMutation({
    mutationFn: (payload: PatientRegister) => register(payload),
  });

  if (isLoading) return <AuthLoading />;
  if (user) return <Navigate to={HOME_PATH[user.role]} replace />;

  return (
    <Card className="mx-auto max-w-xl">
      <PageHeader title={t("signup.title")} />
      <PatientForm
        isSignup
        isPending={signup.isPending}
        serverError={signup.error}
        onSubmit={(payload) => {
          const registration = { ...payload };
          delete registration.notes;
          signup.mutate(registration);
        }}
      />
      <p className="mt-6 text-center">
        {t("signup.haveAccount")}{" "}
        <Link to="/login" className="text-primary font-semibold underline">
          {t("nav.login")}
        </Link>
      </p>
    </Card>
  );
}
