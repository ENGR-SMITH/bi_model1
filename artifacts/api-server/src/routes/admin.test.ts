import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import adminRouter from "./admin";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", adminRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.oracleHealthEventsTable);
  await state.db.delete(t.oracleProvidersTable);
}

beforeEach(async () => {
  delete process.env.ADMIN_ACCESS_CODE;
  await resetDb();
});

afterEach(() => {
  delete process.env.ADMIN_ACCESS_CODE;
  vi.unstubAllGlobals();
});

describe("admin access", () => {
  it("unlocks with the default access code TANDEM_123 when no env var is set", async () => {
    const unauth = await request(API).get("/api/admin/providers");
    expect(unauth.status).toBe(401);

    const login = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    expect(login.status).toBe(200);
    expect(login.body.authenticated).toBe(true);

    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();

    const providers = await request(API).get("/api/admin/providers").set("Cookie", cookie);
    expect(providers.status).toBe(200);
    expect(providers.body).toHaveLength(5);
    expect(providers.body.map((item: any) => item.id)).toEqual(["groq", "openrouter", "ollama", "lmstudio", "freebuff"]);
  });

  it("rejects a wrong access code and respects an ADMIN_ACCESS_CODE override", async () => {
    process.env.ADMIN_ACCESS_CODE = "SECRET_OVERRIDE";
    const wrong = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    expect(wrong.status).toBe(401);

    const right = await request(API).post("/api/admin/login").send({ accessCode: "SECRET_OVERRIDE" });
    expect(right.status).toBe(200);
  });

  it("seeds provider API keys from the environment when the row has none", async () => {
    process.env.GROQ_API_KEY = "env-groq-key-123";
    const login = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];

    const providers = await request(API).get("/api/admin/providers").set("Cookie", cookie);
    const groq = providers.body.find((item: any) => item.id === "groq");
    expect(groq.configured).toBe(true);
    expect(groq.keyHint).toContain("-123");
  });
});
