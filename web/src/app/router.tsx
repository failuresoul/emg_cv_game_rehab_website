import { createBrowserRouter } from "react-router";

import { AdminLayout } from "@/components/layout/AdminLayout";
import { PatientLayout } from "@/components/layout/PatientLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { SessionLayout, type SessionRouteHandle } from "@/components/layout/SessionLayout";
import { ErrorPage } from "@/components/ErrorPage";
import { RequireAuth, RequireRole } from "@/features/auth/guards";
import { AdminGamesPage } from "@/pages/admin/AdminGamesPage";
import { AdminOverviewPage } from "@/pages/admin/AdminOverviewPage";
import { AdminPatientDetailPage } from "@/pages/admin/AdminPatientDetailPage";
import { AdminPatientsPage } from "@/pages/admin/AdminPatientsPage";
import { AdminReportReviewPage } from "@/pages/admin/AdminReportReviewPage";
import { AdminResearchPage } from "@/pages/admin/AdminResearchPage";
import { AdminSessionDetailPage } from "@/pages/admin/AdminSessionDetailPage";
import { AdminSystemPage } from "@/pages/admin/AdminSystemPage";
import { PatientHistoryPage } from "@/pages/patient/PatientHistoryPage";
import { PatientHomePage } from "@/pages/patient/PatientHomePage";
import { PatientProfilePage } from "@/pages/patient/PatientProfilePage";
import { PatientProgressPage } from "@/pages/patient/PatientProgressPage";
import { PatientReportDetailPage } from "@/pages/patient/PatientReportDetailPage";
import { PatientReportsPage } from "@/pages/patient/PatientReportsPage";
import { PatientSessionDetailPage } from "@/pages/patient/PatientSessionDetailPage";
import { AboutPage } from "@/pages/public/AboutPage";
import { HomePage } from "@/pages/public/HomePage";
import { LoginPage } from "@/pages/public/LoginPage";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { SignupPage } from "@/pages/public/SignupPage";
import { SessionCalibratePage } from "@/pages/session/SessionCalibratePage";
import { SessionCooldownPage } from "@/pages/session/SessionCooldownPage";
import { SessionGamePage } from "@/pages/session/SessionGamePage";
import { SessionPlanPage } from "@/pages/session/SessionPlanPage";
import { SessionSetupPage } from "@/pages/session/SessionSetupPage";
import { SessionSummaryPage } from "@/pages/session/SessionSummaryPage";
import { SessionWarmupPage } from "@/pages/session/SessionWarmupPage";

const step = (stepKey: SessionRouteHandle["stepKey"]): SessionRouteHandle => ({ stepKey });

export const router = createBrowserRouter([
  // Vite replaces DEV with false in a production build, which removes this route and its code.
  ...(import.meta.env.DEV
    ? [
        {
          path: "/dev/exercise-lab",
          lazy: async () => ({
            Component: (await import("@/dev/ExerciseLabPage")).ExerciseLabPage,
          }),
        },
      ]
    : []),
  // The landing page has its own navbar and footer.
  { path: "/", element: <HomePage />, errorElement: <ErrorPage /> },
  {
    element: <PublicLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/about", element: <AboutPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/signup", element: <SignupPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    errorElement: <ErrorPage />,
    children: [
      {
        element: <RequireRole role="patient" />,
        children: [
          {
            path: "/patient",
            element: <PatientLayout />,
            children: [
              { index: true, element: <PatientHomePage /> },
              { path: "progress", element: <PatientProgressPage /> },
              { path: "history", element: <PatientHistoryPage /> },
              { path: "history/:sessionId", element: <PatientSessionDetailPage /> },
              { path: "reports", element: <PatientReportsPage /> },
              { path: "reports/:jobId", element: <PatientReportDetailPage /> },
              { path: "profile", element: <PatientProfilePage /> },
            ],
          },
          {
            path: "/session",
            element: <SessionLayout />,
            children: [
              {
                path: "setup",
                element: <SessionSetupPage />,
                handle: step("page.session.setup.title"),
              },
              {
                path: "calibrate",
                element: <SessionCalibratePage />,
                handle: step("page.session.calibrate.title"),
              },
              {
                path: "warmup",
                element: <SessionWarmupPage />,
                handle: step("page.session.warmup.title"),
              },
              {
                path: "plan",
                element: <SessionPlanPage />,
                handle: step("page.session.plan.title"),
              },
              {
                path: "game/:gameId",
                element: <SessionGamePage />,
                handle: step("page.session.game.title"),
              },
              {
                path: "cooldown",
                element: <SessionCooldownPage />,
                handle: step("page.session.cooldown.title"),
              },
              {
                path: "summary",
                element: <SessionSummaryPage />,
                handle: step("page.session.summary.title"),
              },
            ],
          },
        ],
      },
      {
        element: <RequireRole role="admin" />,
        children: [
          {
            path: "/admin",
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminOverviewPage /> },
              { path: "patients", element: <AdminPatientsPage /> },
              { path: "patients/:id", element: <AdminPatientDetailPage /> },
              { path: "sessions/:id", element: <AdminSessionDetailPage /> },
              { path: "games", element: <AdminGamesPage /> },
              { path: "research", element: <AdminResearchPage /> },
              { path: "research/report-review", element: <AdminReportReviewPage /> },
              { path: "system", element: <AdminSystemPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
