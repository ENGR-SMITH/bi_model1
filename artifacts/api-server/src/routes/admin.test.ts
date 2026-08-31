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
import ticketsRouter from "./tickets";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", adminRouter);
  app.use("/api", ticketsRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemPromoCodesTable);
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

describe("admin promo codes", () => {
  async function login(): Promise<string> {
    const loginRes = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();
    return cookie as string;
  }

  it("creates, lists, updates, and deletes promo codes", async () => {
    const cookie = await login();

    // Start empty.
    const empty = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    // Create — the code is normalized to uppercase.
    const created = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "halfpass", kind: "PERCENT", value: 50, maxUses: 0 });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("HALFPASS");
    expect(created.body.kind).toBe("PERCENT");
    expect(created.body.uses).toBe(0);

    // Duplicate code → 409.
    const dup = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "HALFPASS", kind: "FLAT", value: 20, maxUses: 1 });
    expect(dup.status).toBe(409);

    // Update.
    const updated = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FLAT", value: 25, maxUses: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.kind).toBe("FLAT");
    expect(updated.body.value).toBe(25);
    expect(updated.body.maxUses).toBe(5);

    // The checkout sees the updated code (valid + discounted price).
    state.userId = "user-1";
    const validated = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS" });
    expect(validated.body.valid).toBe(true);
    expect(validated.body.kind).toBe("FLAT");
    expect(validated.body.discountedPriceUsd).toBe(188 - 25);

    // List reflects the row.
    const list = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].code).toBe("HALFPASS");

    // Delete.
    const deleted = await request(API).delete("/api/admin/promos/HALFPASS").set("Cookie", cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    const after = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(after.body).toEqual([]);
  });

  it("rejects invalid input and unknown codes", async () => {
    const cookie = await login();

    const badKind = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "X", kind: "BOGUS", value: 10, maxUses: 0 });
    expect(badKind.status).toBe(400);

    const missing = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 0 });
    expect(missing.status).toBe(400);

    const notFound = await request(API).patch("/api/admin/promos/NOPE").set("Cookie", cookie).send({ kind: "FREE", value: 0, maxUses: 0 });
    expect(notFound.status).toBe(404);
    const deleteMissing = await request(API).delete("/api/admin/promos/NOPE").set("Cookie", cookie);
    expect(deleteMissing.status).toBe(404);
  });

  it("requires an admin session", async () => {
    expect((await request(API).get("/api/admin/promos")).status).toBe(401);
    expect((await request(API).post("/api/admin/promos").send({ code: "X", kind: "FREE", value: 0, maxUses: 0 })).status).toBe(401);
    expect((await request(API).patch("/api/admin/promos/X").send({ kind: "FREE", value: 0, maxUses: 0 })).status).toBe(401);
    expect((await request(API).delete("/api/admin/promos/X")).status).toBe(401);
  });
});
