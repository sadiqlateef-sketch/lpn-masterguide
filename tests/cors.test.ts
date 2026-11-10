import { describe, expect, it } from "vitest";
import { allowedOrigins, decideCors, isAllowedOrigin } from "@/lib/server/cors";

const SELF = "https://lpn.example.com";

describe("allowedOrigins", () => {
  it("always includes the Android app origins", () => {
    expect(allowedOrigins(undefined)).toEqual(["https://localhost", "capacitor://localhost", "http://localhost"]);
  });

  it("adds extra origins from the env list, trimmed and without trailing slashes", () => {
    expect(allowedOrigins(" http://192.168.1.20:3000/ , https://localhost")).toEqual([
      "https://localhost",
      "capacitor://localhost",
      "http://localhost",
      "http://192.168.1.20:3000",
    ]);
  });
});

describe("isAllowedOrigin", () => {
  it("rejects null and unknown origins", () => {
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("https://localhost.evil.example")).toBe(false);
  });
});

describe("decideCors", () => {
  it("leaves same-origin requests alone", () => {
    expect(decideCors("GET", null, SELF)).toEqual({ kind: "same-origin" });
    expect(decideCors("POST", SELF, SELF)).toEqual({ kind: "same-origin" });
  });

  it("answers an app preflight with 204 and the allow headers", () => {
    const d = decideCors("OPTIONS", "https://localhost", SELF);
    expect(d.kind).toBe("preflight");
    if (d.kind !== "preflight") return;
    expect(d.status).toBe(204);
    expect(d.headers["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(d.headers["Access-Control-Allow-Headers"]).toBe("authorization, content-type");
    expect(d.headers["Access-Control-Allow-Methods"]).toContain("DELETE");
    expect(d.headers.Vary).toBe("Origin");
  });

  it("refuses a preflight from another site", () => {
    expect(decideCors("OPTIONS", "https://evil.example", SELF)).toEqual({ kind: "preflight", status: 403, headers: { Vary: "Origin" } });
  });

  it("adds headers to real app requests and never to other sites", () => {
    const app = decideCors("POST", "https://localhost", SELF);
    expect(app.kind === "pass" && app.headers["Access-Control-Allow-Origin"]).toBe("https://localhost");
    const evil = decideCors("GET", "https://evil.example", SELF);
    expect(evil).toEqual({ kind: "pass", headers: { Vary: "Origin" } });
  });

  it("never allows credentials (auth is a Bearer token, not cookies)", () => {
    const d = decideCors("OPTIONS", "https://localhost", SELF);
    expect(d.kind === "preflight" && "Access-Control-Allow-Credentials" in d.headers).toBe(false);
  });
});
