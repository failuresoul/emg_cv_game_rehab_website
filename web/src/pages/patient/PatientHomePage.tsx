import {
  Camera,
  Flame,
  Gamepad2,
  type LucideIcon,
  MessageSquareText,
  Move,
  Play,
  Sparkles,
  Target,
} from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { usePatientDashboard } from "@/features/patient/usePatientDashboard";
import { t, type TranslationKey } from "@/i18n";
import type { TodayPlanStep } from "@/types/api";

const STEP_DISPLAY: Partial<Record<string, { labelKey: TranslationKey; icon: LucideIcon }>> = {
  camera_check: { labelKey: "patient.step.cameraCheck", icon: Camera },
  calibration: { labelKey: "patient.step.calibration", icon: Target },
  warmup: { labelKey: "patient.step.warmup", icon: Move },
  games: { labelKey: "patient.step.games", icon: Gamepad2 },
  feedback: { labelKey: "patient.step.feedback", icon: MessageSquareText },
};

function greetingKey(hour: number): TranslationKey {
  if (hour < 12) return "patient.greeting.morning";
  if (hour < 18) return "patient.greeting.afternoon";
  return "patient.greeting.evening";
}

function currentHour(): number {
  return new Date().getHours();
}

function TodayCard({ plan }: { plan: TodayPlanStep[] }) {
  const totalMinutes = plan.reduce((total, step) => total + step.minutes, 0);

  return (
    <Card className="lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold">{t("patient.today.title")}</h2>
        <p className="text-muted font-medium">
          {t("patient.today.total", { minutes: totalMinutes })}
        </p>
      </div>
      <ul className="mb-6 divide-y divide-black/10">
        {plan.map(({ step, minutes }) => {
          const display = STEP_DISPLAY[step];
          if (!display) return null;
          const { labelKey, icon: Icon } = display;
          return (
            <li key={step} className="flex items-center gap-3 py-3">
              <Icon size={28} aria-hidden className="text-primary shrink-0" />
              <span className="flex-1 font-medium">{t(labelKey)}</span>
              <span className="text-muted">{t("patient.today.minutes", { minutes })}</span>
            </li>
          );
        })}
      </ul>
      <Link to="/session/setup" className={buttonClasses("primary", "lg", "w-full text-xl")}>
        <Play size={24} aria-hidden />
        {t("nav.patient.startSession")}
      </Link>
    </Card>
  );
}

function StreakCard({ days }: { days: number }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 text-center">
      <Flame size={40} aria-hidden className="text-accent" />
      <h2 className="text-xl font-bold">{t("patient.streak.title")}</h2>
      <p className="text-4xl font-bold">
        {t(days === 1 ? "patient.streak.day" : "patient.streak.days", { days })}
      </p>
      {days === 0 && <p className="text-muted">{t("patient.streak.empty")}</p>}
    </Card>
  );
}

export function PatientHomePage() {
  const { user } = useAuth();
  const dashboard = usePatientDashboard();
  const firstName = user?.full_name.split(" ")[0] ?? "";

  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">
        {t(greetingKey(currentHour()), { name: firstName })}
      </h1>

      {dashboard.isPending && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {dashboard.isError && (
        <Card>
          <QueryError onRetry={() => void dashboard.refetch()} />
        </Card>
      )}

      {dashboard.isSuccess && (
        <div className="grid gap-4 lg:grid-cols-3">
          <TodayCard plan={dashboard.data.today_plan} />
          <StreakCard days={dashboard.data.streak_days} />
          <Card className="lg:col-span-2">
            <h2 className="mb-2 text-xl font-bold">{t("patient.progress.title")}</h2>
            {/* The API has no progress data until sessions are recorded. */}
            <ProgressChart points={[]} />
          </Card>
          <Card>
            <h2 className="mb-2 text-xl font-bold">{t("patient.feedback.title")}</h2>
            <EmptyState icon={Sparkles} title={t("patient.feedback.empty")} />
          </Card>
        </div>
      )}
    </>
  );
}
