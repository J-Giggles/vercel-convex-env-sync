import { describe, expect, it } from "vitest";

import {
  buildGitPushArgs,
  buildVercelDeployArgs,
  normalizeDeployTarget,
  parseDeployArgs,
} from "../deploy.mjs";

describe("deploy command planning", () => {
  it("maps staging to Vercel preview env sync and the staging branch", () => {
    expect(normalizeDeployTarget("staging")).toEqual({
      label: "staging",
      syncTarget: "preview",
      branch: "staging",
      production: false,
    });
  });

  it("maps production to Vercel production env sync and the production branch", () => {
    expect(normalizeDeployTarget("production")).toEqual({
      label: "production",
      syncTarget: "prod",
      branch: "production",
      production: true,
    });
  });

  it("builds branch pushes without using main for production", () => {
    expect(buildGitPushArgs(normalizeDeployTarget("staging"))).toEqual([
      "push",
      "origin",
      "HEAD:staging",
      "--force-with-lease",
    ]);
    expect(buildGitPushArgs(normalizeDeployTarget("production"))).toEqual([
      "push",
      "origin",
      "production",
    ]);
  });

  it("builds direct Vercel deploy args for preview and production", () => {
    expect(buildVercelDeployArgs(normalizeDeployTarget("staging"))).toEqual([
      "deploy",
    ]);
    expect(buildVercelDeployArgs(normalizeDeployTarget("production"))).toEqual([
      "deploy",
      "--prod",
    ]);
  });

  it("parses git-push deploy options for staging", () => {
    expect(parseDeployArgs(["staging", "--git-push", "--yes"])).toMatchObject({
      target: normalizeDeployTarget("staging"),
      gitPush: true,
      yes: true,
      skipGates: false,
      fromSync: true,
    });
  });
});
