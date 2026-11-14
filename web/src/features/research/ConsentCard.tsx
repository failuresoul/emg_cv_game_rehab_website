import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useUpdatePatient, usePatients } from "@/features/admin/hooks";
import { t } from "@/i18n";
import type { Patient } from "@/types/api";

/** Today as YYYY-MM-DD, in the browser's own time zone. */
export function todayIso(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function ConsentRow({ patient }: { patient: Patient }) {
  const update = useUpdatePatient(patient.id);
  const recorded = patient.research_consent_at ?? null;
  const [date, setDate] = useState(recorded ?? todayIso());
  const id = `consent-${patient.id}`;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
      <span className="w-20 font-semibold">{patient.patient_code}</span>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={recorded !== null}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({ research_consent_at: event.target.checked ? date : null })
          }
          className="accent-primary size-6"
        />
        {t("consent.recorded")}
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted">{t("consent.date")}</span>
        <input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(event) => {
            setDate(event.target.value);
            if (recorded !== null && event.target.value) {
              update.mutate({ research_consent_at: event.target.value });
            }
          }}
          className="border-muted min-h-11 rounded-lg border px-2"
        />
      </label>
      {update.isError && (
        <span role="alert" className="text-danger font-medium">
          {t("consent.error")}
        </span>
      )}
    </li>
  );
}

/** Research consent per patient, with its date. Only consenting patients can join a study. */
export function ConsentCard() {
  const patients = usePatients();
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <ShieldCheck size={28} aria-hidden className="text-primary shrink-0" />
        <div>
          <h2 className="text-xl font-bold">{t("consent.title")}</h2>
          <p className="text-muted">{t("consent.intro")}</p>
        </div>
      </div>
      {patients.isPending && <Skeleton className="h-24" />}
      {patients.isError && <QueryError onRetry={() => void patients.refetch()} />}
      {patients.isSuccess && (
        <ul className="flex flex-col divide-y divide-black/10">
          {patients.data
            .filter((patient) => !patient.is_demo)
            .map((patient) => (
              <ConsentRow key={patient.id} patient={patient} />
            ))}
        </ul>
      )}
    </Card>
  );
}
