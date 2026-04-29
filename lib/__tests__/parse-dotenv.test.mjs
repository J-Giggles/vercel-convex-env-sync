import { describe, expect, it } from "vitest";

import { parseDotenv } from "../parse-dotenv.mjs";

describe("parseDotenv", () => {
  it("parses a simple unquoted value", () => {
    const map = parseDotenv("KEY=value\n");
    expect(map.get("KEY")).toBe("value");
  });

  it("strips inline comments from unquoted values", () => {
    const map = parseDotenv("CONVEX_DEPLOYMENT=dev:slug # team: foo, project: bar\n");
    expect(map.get("CONVEX_DEPLOYMENT")).toBe("dev:slug");
  });

  it("preserves '#' inside quoted values", () => {
    const map = parseDotenv('SECRET="abc#def"\n');
    expect(map.get("SECRET")).toBe("abc#def");
  });

  it("preserves '#' when no whitespace precedes it (not an inline comment)", () => {
    const map = parseDotenv("KEY=value#nocomment\n");
    expect(map.get("KEY")).toBe("value#nocomment");
  });

  it("ignores full-line comments", () => {
    const map = parseDotenv("# top comment\nKEY=value\n");
    expect(map.get("KEY")).toBe("value");
    expect(map.has("# top comment")).toBe(false);
  });

  it("trims trailing whitespace before an inline comment", () => {
    const map = parseDotenv("KEY=value   # comment\n");
    expect(map.get("KEY")).toBe("value");
  });

  it("strips single quotes around values", () => {
    const map = parseDotenv("KEY='quoted value'\n");
    expect(map.get("KEY")).toBe("quoted value");
  });

  it("strips double quotes around values", () => {
    const map = parseDotenv('KEY="quoted value"\n');
    expect(map.get("KEY")).toBe("quoted value");
  });
});
