import axios from "axios";
import { ArrowLeft, Pencil, SearchX } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { usePatient, useSetPatientActive } from "@/features/admin/hooks";
import { EditPatientModal } from "@/features/admin/PatientModals";
import { PatientStatusBadge } from "@/features/admin/PatientStatusBadge";
import { QueryError } from "@/features/admin/QueryError";
import { t, type TranslationKey } from "@/i18n";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { Patient } from "@/types/api";

const TABS: { id: string; labelKey: TranslationKey }[] = [
  { id: "overview", labelKey: "patient.tab.overview" },
  { id: "sessions", labelKey: "patient.tab.sessions" },
  { id: "progress", labelKey: "patient.tab.progress" },
  { id: "programme", labelKey: "patient.tab.programme" },
  { id: "reports", labelKey: "patient.tab.reports" },
];

function BackLink() {
  return (
    <Link to="/admin/patients" className={buttonClasses("ghost", "md", "mb-2 -ml-3")}>
      <ArrowLeft size={20} aria-hidden />
      {t("patient.backToList")}
    </Link>
  );
}

function ConfirmStatusModal({
  patient,
  open,
  onClose,
}: {
  patient: Patient;
  open: boolean;
  onClose: () => void;
}) {
  const setActive = useSetPatientActive(patient.id);
  const showToast = useToast();
  const isActive = patient.user.is_active;
  const name = patient.user.full_name;

  function confirm() {
    setActive.mutate(!isActive, {
      onSuccess: () => {
        showToast("success", t(isActive ? "patient.deactivated" : "patient.activated"));
        onClose();
      },
    });
  }

  return (
    <Modal
      open={open}
      title={t(isActive ? "patient.confirmDeactivateTitle" : "patient.confirmActivateTitle")}
      onClose={onClose}
    >
      <p>{t(isActive ? "patient.confirmDeactivate" : "patient.confirmActivate", { name })}</p>
      {setActive.isError && (
        <p role="alert" className="text-danger mt-3 font-medium">
          {t("patient.statusError")}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant={isActive ? "danger" : "primary"}
          loading={setActive.isPending}
          onClick={confirm}
        >
          {t(isActive ? "patient.deactivate" : "patient.activate")}
        </Button>
      </div>
    </Modal>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}

function OverviewTab({ patient }: { patient: Patient }) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const notSet = t("common.notSet");
  const sideLabel = (side: Patient["affected_side"]) =>
    t(side === "left" ? "side.left" : "side.right");

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Detail label={t("patientForm.email")}>{patient.user.email}</Detail>
        <Detail label={t("patientForm.affectedSide")}>{sideLabel(patient.affected_side)}</Detail>
        <Detail label={t("patientForm.dominantSide")}>{sideLabel(patient.dominant_side)}</Detail>
        <Detail label={t("patientForm.ageBand")}>{patient.age_band}</Detail>
        <Detail label={t("patientForm.monthsSinceStroke")}>
          {patient.months_since_stroke ?? notSet}
        </Detail>
        <Detail label={t("patientForm.language")}>
          {t(patient.language === "en" ? "language.en" : "language.bn")}
        </Detail>
        <Detail label={t("patient.createdAt")}>{formatDate(patient.created_at)}</Detail>
        <Detail label={t("patients.column.lastLogin")}>
          {patient.user.last_login_at
            ? formatRelativeTime(patient.user.last_login_at)
            : t("patients.neverLoggedIn")}
        </Detail>
        <div className="sm:col-span-2 xl:col-span-3">
          <Detail label={t("patientForm.notes")}>
            <span className="whitespace-pre-wrap">{patient.notes ?? notSet}</span>
          </Detail>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => setEditOpen(true)}>
          <Pencil size={20} aria-hidden />
          {t("patient.edit")}
        </Button>
        <Button
          variant={patient.user.is_active ? "danger" : "secondary"}
          onClick={() => setConfirmOpen(true)}
        >
          {t(patient.user.is_active ? "patient.deactivate" : "patient.activate")}
        </Button>
      </div>
      <EditPatientModal patient={patient} open={editOpen} onClose={() => setEditOpen(false)} />
      {confirmOpen && (
        <ConfirmStatusModal patient={patient} open onClose={() => setConfirmOpen(false)} />
      )}
    </>
  );
}

export function AdminPatientDetailPage() {
  const { id = "" } = useParams();
  const patient = usePatient(id);
  const [tab, setTab] = useState("overview");

  if (patient.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (patient.isError) {
    // 422 means the id in the address is not a number, so no such patient can exist.
    const status = axios.isAxiosError(patient.error) ? patient.error.response?.status : undefined;
    return (
      <>
        <BackLink />
        <Card>
          {status === 404 || status === 422 ? (
            <EmptyState icon={SearchX} title={t("patient.notFound")} />
          ) : (
            <QueryError onRetry={() => void patient.refetch()} />
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={t("patient.headerTitle", {
          code: patient.data.patient_code,
          name: patient.data.user.full_name,
        })}
        actions={<PatientStatusBadge isActive={patient.data.user.is_active} />}
      />
      <Card>
        <Tabs
          label={t("patient.tab.label")}
          tabs={TABS.map(({ id: tabId, labelKey }) => ({ id: tabId, label: t(labelKey) }))}
          value={tab}
          onChange={setTab}
        >
          {tab === "overview" ? (
            <OverviewTab patient={patient.data} />
          ) : (
            <EmptyState title={t("patient.tab.emptyUntilSessions")} />
          )}
        </Tabs>
      </Card>
    </>
  );
}
