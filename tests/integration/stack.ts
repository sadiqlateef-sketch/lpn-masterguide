import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A tiny local stand-in for Supabase: real Postgres + PostgREST behind a gateway that also answers
// /auth/v1/user and accepts Storage uploads. Lets the API routes run end to end without a cloud project.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JWT_SECRET = "integration-test-secret-integration-test-secret";

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export function signJwt(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return expected === signature ? (JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>) : null;
}

export type Stack = {
  url: string;
  anonKey: string;
  db: string;
  sql: (query: string) => string;
  newUser: () => { id: string; token: string };
  stop: () => Promise<void>;
};

async function waitFor(url: string, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} never came up`);
}

export async function startStack(postgrestBin: string): Promise<Stack> {
  const db = `lpn_it_${process.pid}_${Date.now()}`;
  const pgEnv = { ...process.env, PGOPTIONS: "-c client_min_messages=warning" };
  const psql = (args: string[]) => execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", db, ...args], { env: pgEnv, encoding: "utf8" });

  execFileSync("createdb", [db], { env: pgEnv });
  psql(["-c", "create extension if not exists pgcrypto", "-f", path.join(root, "supabase/tests/supabase_stubs.sql")]);
  const migrations = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) psql(["-f", path.join(root, "supabase/migrations", file)]);

  const restPort = 30000 + (process.pid % 20000);
  const host = process.env.PGHOST ?? "localhost";
  const port = process.env.PGPORT ?? "5432";
  const postgrest: ChildProcess = spawn(postgrestBin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator@/${db}?host=${encodeURIComponent(host)}&port=${port}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(restPort),
      PGRST_LOG_LEVEL: "error",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const gateway: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/rest/v1/")) {
      const upstream = httpRequest(
        { host: "127.0.0.1", port: restPort, path: url.slice("/rest/v1".length), method: req.method, headers: req.headers },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502).end();
      });
      req.pipe(upstream);
      return;
    }
    if (url.startsWith("/auth/v1/user")) {
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const claims = verifyJwt(token);
      if (!claims?.sub) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ msg: "invalid JWT" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ id: claims.sub, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }),
      );
      return;
    }
    if (url.startsWith("/storage/v1/object/")) {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ Key: url.slice("/storage/v1/object/".length) }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  await waitFor(`http://127.0.0.1:${restPort}/`);

  return {
    url: gatewayUrl,
    anonKey: signJwt({ role: "anon" }),
    db,
    sql: (query) => psql(["-At", "-c", query]).trim(),
    newUser: () => {
      const id = randomUUID();
      psql(["-c", `insert into auth.users (id, email) values ('${id}', '${id}@example.com')`]);
      return { id, token: signJwt({ sub: id, role: "authenticated", aud: "authenticated" }) };
    },
    stop: async () => {
      postgrest.kill();
      await new Promise((resolve) => gateway.close(resolve));
      await new Promise((resolve) => setTimeout(resolve, 300));
      execFileSync("dropdb", ["--if-exists", "--force", db], { env: pgEnv });
    },
  };
}
