import { Plus, SearchX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { usePatients } from "@/features/admin/hooks";
import { AddPatientModal } from "@/features/admin/PatientModals";
import { PatientStatusBadge } from "@/features/admin/PatientStatusBadge";
import { QueryError } from "@/components/ui/QueryError";
import { t, type TranslationKey } from "@/i18n";
import { formatRelativeTime } from "@/lib/format";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { Patient } from "@/types/api";

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;

const COLUMNS: TranslationKey[] = [
  "patients.column.code",
  "patients.column.name",
  "patients.column.affectedSide",
  "patients.column.language",
  "patients.column.lastLogin",
  "patients.column.status",
  "patients.column.actions",
];

function PatientTable({ patients }: { patients: Patient[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="text-muted px-3 py-3 font-semibold">
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {patients.map((patient) => (
            <tr key={patient.id}>
              <td className="text-primary px-3 py-2 font-semibold">{patient.patient_code}</td>
              <td className="px-3 py-2">{patient.user.full_name}</td>
              <td className="px-3 py-2">
                {t(patient.affected_side === "left" ? "side.left" : "side.right")}
              </td>
              <td className="px-3 py-2">
                {t(patient.language === "en" ? "language.en" : "language.bn")}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {patient.user.last_login_at
                  ? formatRelativeTime(patient.user.last_login_at)
                  : t("patients.neverLoggedIn")}
              </td>
              <td className="px-3 py-2">
                <PatientStatusBadge isActive={patient.user.is_active} />
              </td>
              <td className="px-3 py-1">
                <Link
                  to={`/admin/patients/${patient.id}`}
                  aria-label={t("patients.viewLabel", { name: patient.user.full_name })}
                  className={buttonClasses("ghost")}
                >
                  {t("patients.view")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPatientsPage() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const patients = usePatients(debouncedSearch);

  function renderResults() {
    if (patients.isPending) {
      return (
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-11" />
          ))}
        </div>
      );
    }
    if (patients.isError) return <QueryError onRetry={() => void patients.refetch()} />;
    if (patients.data.length > 0) return <PatientTable patients={patients.data} />;
    if (debouncedSearch) return <EmptyState icon={SearchX} title={t("patients.noResults")} />;
    return <EmptyState title={t("patients.empty")} description={t("patients.emptyDescription")} />;
  }

  return (
    <>
      <PageHeader
        title={t("page.admin.patients.title")}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={20} aria-hidden />
            {t("admin.addPatient")}
          </Button>
        }
      />
      <div className="mb-4 max-w-lg">
        <Input
          label={t("patients.search")}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Card className="p-0">{renderResults()}</Card>
      <AddPatientModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
