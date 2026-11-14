import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { creditText } from "@/components/brand/CreditLine";
import { project } from "@/config/project";
import { LoginPage } from "@/pages/public/LoginPage";

import { AdminLayout } from "./AdminLayout";
import { PatientLayout } from "./PatientLayout";

// The parts that need a signed-in user or a session are not under test here.
vi.mock("./UserMenu", () => ({ UserMenu: () => null }));
vi.mock("@/features/session/StartSessionButton", () => ({ StartSessionButton: () => null }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, isLoading: false, login: vi.fn() }),
  useOptionalAuth: () => null,
}));

const sessionLayoutSource = import.meta.glob<string>("./SessionLayout.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["./SessionLayout.tsx"]!;

function render(element: ReactElement, path = "/"): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const decode = (html: string) => html.replace(/&amp;/g, "&");

describe("credit line", () => {
  it("names the project, department and collaborator from project.ts", () => {
    expect(creditText()).toBe(
      "MuVi Rehab · Dept. of CSE, KUET · in collaboration with The University of Queensland",
    );
  });

  it("is in the footer of the admin and patient areas", () => {
    for (const html of [render(<AdminLayout />, "/admin"), render(<PatientLayout />, "/patient")]) {
      const footer = html.slice(html.indexOf("<footer"));
      expect(footer).toContain('data-testid="credit-line"');
      expect(decode(footer)).toContain(creditText());
    }
  });

  it("is not in the session layout, which keeps no footer", () => {
    expect(sessionLayoutSource).not.toContain("CreditLine");
    expect(sessionLayoutSource).not.toContain("<footer");
  });
});

describe("login page", () => {
  const html = render(<LoginPage />, "/login");

  it("shows the mark, name, tagline and credit line", () => {
    expect(html).toContain('data-testid="logo-mark"');
    expect(html).toContain(project.name);
    expect(html).toContain(project.tagline);
    expect(decode(html)).toContain(creditText());
  });

  it("falls back to the institutions' short names while the logos are not known to exist", () => {
    const footer = html.slice(html.lastIndexOf("<footer"));
    expect(footer).not.toContain("<img");
    expect(footer).toContain(`>${project.institution.shortName}<`);
    expect(footer).toContain(`>${project.collaborator.shortName}<`);
  });
});
