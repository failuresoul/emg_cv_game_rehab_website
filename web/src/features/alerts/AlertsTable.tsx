import { BellRing } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { QueryError } from "@/components/ui/QueryError";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useAlertAction, useAlerts } from "@/features/admin/hooks";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { Alert, AlertFilters, AlertSeverity, AlertStatus, AlertType } from "@/types/api";

import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  alertSummary,
  nextActions,
  SEVERITY_BADGE,
  SEVERITY_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  TYPE_LABEL_KEYS,
} from "./alertModel";

export const NOTE_MAX = 500;

interface Pending {
  alert: Alert;
  action: "acknowledge" | "resolve";
}

function NoteForm({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const action = useAlertAction();
  const showToast = useToast();
  const [note, setNote] = useState(pending.alert.note ?? "");
  const resolving = pending.action === "resolve";

  function submit(event: FormEvent) {
    event.preventDefault();
    action.mutate(
      { id: pending.alert.id, action: pending.action, note },
      {
        onSuccess: () => {
          showToast("success", t(resolving ? "alert.resolvedToast" : "alert.acknowledgedToast"));
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="font-semibold">
        {t(TYPE_LABEL_KEYS[pending.alert.type])}
        {pending.alert.patient_code ? ` · ${pending.alert.patient_code}` : ""}
      </p>
      <p>{alertSummary(pending.alert)}</p>
      <Textarea
        label={t("alert.note")}
        value={note}
        maxLength={NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
      />
      {action.isError && (
        <p role="alert" className="text-danger font-medium">
          {t("alert.actionError")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={action.isPending}>
          {t(resolving ? "alert.resolve" : "alert.acknowledge")}
        </Button>
      </div>
    </form>
  );
}

function Filters({
  filters,
  onChange,
  showType,
}: {
  filters: AlertFilters;
  onChange: (filters: AlertFilters) => void;
  showType: boolean;
}) {
  const one = <T extends string>(values: T[] | undefined) => values?.[0] ?? "";
  const set = <T extends string>(value: string): T[] | undefined =>
    value === "" ? undefined : [value as T];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Select
        label={t("alert.filter.status")}
        value={filters.status && filters.status.length > 1 ? "unresolved" : one(filters.status)}
        onChange={(event) =>
          onChange({
            ...filters,
            status:
              event.target.value === "unresolved"
                ? ["open", "acknowledged"]
                : set<AlertStatus>(event.target.value),
          })
        }
        options={[
          { value: "unresolved", label: t("alert.filter.unresolved") },
          { value: "", label: t("alert.filter.all") },
          ...ALERT_STATUSES.map((status) => ({
            value: status,
            label: t(STATUS_LABEL_KEYS[status]),
          })),
        ]}
      />
      <Select
        label={t("alert.filter.severity")}
        value={one(filters.severity)}
        onChange={(event) =>
          onChange({ ...filters, severity: set<AlertSeverity>(event.target.value) })
        }
        options={[
          { value: "", label: t("alert.filter.all") },
          ...ALERT_SEVERITIES.map((severity) => ({
            value: severity,
            label: t(SEVERITY_LABEL_KEYS[severity]),
          })),
        ]}
      />
      {showType && (
        <Select
          label={t("alert.filter.type")}
          value={one(filters.type)}
          onChange={(event) => onChange({ ...filters, type: set<AlertType>(event.target.value) })}
          options={[
            { value: "", label: t("alert.filter.all") },
            ...ALERT_TYPES.map((type) => ({ value: type, label: t(TYPE_LABEL_KEYS[type]) })),
          ]}
        />
      )}
    </div>
  );
}

export const UNRESOLVED_FILTERS: AlertFilters = { status: ["open", "acknowledged"] };

/** Alerts with filters, severity colours, patient and session links, and actions with a note.
 * With `patientId`, only that patient's alerts (the patient page's tab). */
export function AlertsTable({ patientId }: { patientId?: number }) {
  const [filters, setFilters] = useState<AlertFilters>(UNRESOLVED_FILTERS);
  const query = patientId === undefined ? filters : { ...filters, patient: patientId };
  const alerts = useAlerts(query);
  const [pending, setPending] = useState<Pending | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Filters filters={filters} onChange={setFilters} showType />
      {alerts.isPending && <Skeleton className="h-40" />}
      {alerts.isError && <QueryError onRetry={() => void alerts.refetch()} />}
      {alerts.isSuccess && alerts.data.length === 0 && (
        <EmptyState icon={BellRing} title={t("alert.empty")} />
      )}
      {alerts.isSuccess && alerts.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{t("alert.tableCaption")}</caption>
            <thead>
              <tr className="border-b border-black/10">
                <th scope="col" className="px-3 py-2">
                  {t("alert.column.severity")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("alert.column.alert")}
                </th>
                {patientId === undefined && (
                  <th scope="col" className="px-3 py-2">
                    {t("alert.column.patient")}
                  </th>
                )}
                <th scope="col" className="px-3 py-2">
                  {t("alert.column.raised")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("alert.column.status")}
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t("alert.column.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {alerts.data.map((alert) => (
                <tr key={alert.id} className="align-top">
                  <td className="px-3 py-2">
                    <Badge variant={SEVERITY_BADGE[alert.severity]}>
                      {t(SEVERITY_LABEL_KEYS[alert.severity])}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-semibold">{t(TYPE_LABEL_KEYS[alert.type])}</span>
                    <span className="text-muted block">{alertSummary(alert)}</span>
                    {alert.session_id !== null && (
                      <Link
                        to={`/admin/sessions/${alert.session_id}`}
                        className="text-primary underline"
                      >
                        {t("alert.openSession")}
                      </Link>
                    )}
                    {alert.note && (
                      <span className="mt-1 block text-sm">
                        {t("alert.noteValue", { note: alert.note })}
                      </span>
                    )}
                  </td>
                  {patientId === undefined && (
                    <td className="px-3 py-2">
                      {alert.patient_id !== null && alert.patient_code ? (
                        <Link
                          to={`/admin/patients/${alert.patient_id}`}
                          className="text-primary font-semibold underline"
                        >
                          {alert.patient_code}
                        </Link>
                      ) : (
                        <span className="text-muted">{t("alert.system")}</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDateTime(alert.created_at)}
                  </td>
                  <td className="px-3 py-2">{t(STATUS_LABEL_KEYS[alert.status])}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {nextActions(alert.status).map((action) => (
                        <Button
                          key={action}
                          variant={action === "resolve" ? "primary" : "secondary"}
                          onClick={() => setPending({ alert, action })}
                        >
                          {t(action === "resolve" ? "alert.resolve" : "alert.acknowledge")}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={pending !== null}
        title={
          pending
            ? t(pending.action === "resolve" ? "alert.resolveTitle" : "alert.acknowledgeTitle")
            : ""
        }
        onClose={() => setPending(null)}
      >
        {pending && <NoteForm pending={pending} onClose={() => setPending(null)} />}
      </Modal>
    </div>
  );
}
