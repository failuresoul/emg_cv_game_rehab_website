import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "../../package.json";
import { assetExists, resetAssetChecks } from "./assets";
import { project } from "./project";

describe("project identity", () => {
  it("names the project, its research and its people", () => {
    expect(project.name).toBe("MuVi Rehab");
    expect(project.nameLong).toBe("MuVi Rehab — Muscle + Vision Rehabilitation");
    expect(project.researchTitle).toMatch(/^Multimodal EMG and Webcam-Based/);
    expect(project.institution.name).toContain("KUET");
    expect(project.collaborator.name).toBe("The University of Queensland");
    expect(project.supervisors.map((person) => person.name)).toEqual([
      "Dr. Muhammad Aminul Haque Akhand",
      "Dr. Md. Abdul Awal",
    ]);
    expect(project.supervisors[1].affiliation).toBe(
      "Postdoctoral Fellow, The University of Queensland",
    );
    expect(project.team.map((person) => person.name)).toEqual([
      "Nurul Absar Shadik",
      "Nafis Ahammad",
    ]);
  });

  it("takes the version from package.json", () => {
    expect(project.version).toBe(packageJson.version);
  });

  it("keeps every image under web/public", () => {
    const paths = [
      project.institution.logo,
      project.collaborator.logo,
      ...project.supervisors.map((person) => person.photo),
      ...project.team.map((person) => person.photo),
    ];
    for (const path of paths) expect(path).toMatch(/^\/(logos|team)\/[\w-]+\.(png|jpg|svg)$/);
  });
});

describe("assetExists", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAssetChecks();
  });

  function respond(status: number, contentType: string) {
    return vi.fn(
      async () => new Response(null, { status, headers: { "content-type": contentType } }),
    );
  }

  it("is true for an image", async () => {
    vi.stubGlobal("fetch", respond(200, "image/png"));
    expect(await assetExists("/logos/kuet.png")).toBe(true);
  });

  it("is false for the app page served for a missing file, a 404 or a network error", async () => {
    vi.stubGlobal("fetch", respond(200, "text/html"));
    expect(await assetExists("/team/a.jpg")).toBe(false);
    vi.stubGlobal("fetch", respond(404, "image/png"));
    expect(await assetExists("/team/b.jpg")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    expect(await assetExists("/team/c.jpg")).toBe(false);
  });

  it("checks each path once", async () => {
    const fetchMock = respond(200, "image/jpeg");
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([assetExists("/team/x.jpg"), assetExists("/team/x.jpg")]);
    await assetExists("/team/x.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/team/x.jpg", { method: "HEAD" });
  });
});
