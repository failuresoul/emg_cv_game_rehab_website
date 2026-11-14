import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import type { AdminStats, Alert } from "@/types/api";

import { alertSummary, nextActions, SEVERITY_BADGE } from "./alertModel";
import { AlertsOverviewCard } from "./AlertsOverviewCard";
import { AlertsTable, UNRESOLVED_FILTERS } from "./AlertsTable";

function alert(changes: Partial<Alert>): Alert {
  return {
    id: 1,
    patient_id: 3,
    patient_code: "P003",
    session_id: 12,
    type: "pain",
    severity: "high",
    status: "open",
    details: { pain_0_10: 7 },
    created_at: "2026-11-14T09:00:00Z",
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_by: null,
    resolved_at: null,
    note: null,
    ...changes,
  };
}

describe("alert summaries", () => {
  it("say what raised each type of alert", () => {
    expect(alertSummary(alert({}))).toBe("Pain 7 of 10 after the session");
    expect(alertSummary(alert({ type: "pain", details: {} }))).toBe(
      en["alert.summary.painUnknown"],
    );
    expect(alertSummary(alert({ type: "high_fatigue", details: { fatigue_0_10: 9 } }))).toBe(
      "Fatigue 9 of 10 after the session",
    );
    expect(
      alertSummary(
        alert({ type: "sharp_decline", details: { metrics: [{ id: "K6" }, { id: "H1" }] } }),
      ),
    ).toBe("2 key measures fell sharply (K6, H1)");
    expect(alertSummary(alert({ type: "missed_sessions", details: { days_since: 5 } }))).toBe(
      "No completed session for 5 days",
    );
    expect(
      alertSummary(
        alert({ type: "repeated_device_problems", details: { sessions: [{}, {}, {}] } }),
      ),
    ).toContain("3 sessions in a row");
    expect(
      alertSummary(
        alert({ type: "llm_fallback_rate", details: { fallback_share: 0.4, reports: 10 } }),
      ),
    ).toBe("40% of the last 10 reports used the template");
  });

  it("offer only the next steps of the status", () => {
    expect(nextActions("open")).toEqual(["acknowledge", "resolve"]);
    expect(nextActions("acknowledged")).toEqual(["resolve"]);
    expect(nextActions("resolved")).toEqual([]);
  });

  it("colour severity, red to grey", () => {
    expect(SEVERITY_BADGE).toEqual({ high: "danger", medium: "warning", low: "muted" });
  });
});

function render(node: React.ReactNode, data: (client: QueryClient) => void) {
  const client = new QueryClient();
  data(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the alerts table", () => {
  it("lists unresolved alerts with severity, patient and session links and actions", () => {
    const html = render(<AlertsTable />, (client) =>
      client.setQueryData(
        ["admin", "alerts", UNRESOLVED_FILTERS],
        [
          alert({}),
          alert({
            id: 2,
            type: "llm_fallback_rate",
            severity: "low",
            patient_id: null,
            patient_code: null,
            session_id: null,
            status: "acknowledged",
            details: { fallback_share: 0.5, reports: 10 },
            note: "Checking Ollama",
          }),
        ],
      ),
    );
    expect(html).toContain(en["alert.severity.high"]);
    expect(html).toContain('href="/admin/patients/3"');
    expect(html).toContain('href="/admin/sessions/12"');
    expect(html).toContain(en["alert.system"]);
    expect(html).toContain("Note: Checking Ollama");
    // Open: acknowledge and resolve; acknowledged: resolve only.
    expect(html.split(`>${en["alert.acknowledge"]}<`).length - 1).toBe(1);
    expect(html.split(`>${en["alert.resolve"]}<`).length - 1).toBe(2);
  });

  it("leaves out the patient column on a patient's own tab", () => {
    const html = render(<AlertsTable patientId={3} />, (client) =>
      client.setQueryData(["admin", "alerts", { ...UNRESOLVED_FILTERS, patient: 3 }], [alert({})]),
    );
    expect(html).not.toContain(en["alert.column.patient"]);
    expect(html).toContain(en["alert.type.pain"]);
  });
});

describe("the overview's Alerts card", () => {
  it("shows the open high and medium counts and the latest open alerts", () => {
    const stats: AdminStats = {
      total_patients: 2,
      active_patients: 2,
      sessions_today: 0,
      open_alerts: 3,
      alerts: { open: 3, open_high: 2, open_medium: 1, open_low: 0, acknowledged: 0 },
    };
    const html = render(<AlertsOverviewCard />, (client) => {
      client.setQueryData(["admin", "stats"], stats);
      client.setQueryData(
        ["admin", "alerts", { status: ["open"] }],
        Array.from({ length: 7 }, (_, index) => alert({ id: index + 1 })),
      );
    });
    expect(html).toContain("High: 2");
    expect(html).toContain("Medium: 1");
    expect(html).not.toContain("Low:");
    expect(html.split(`>${en["alert.type.pain"]}<`).length - 1).toBe(5); // the latest 5 only
    expect(html).toContain('href="/admin/alerts"');
  });
});
