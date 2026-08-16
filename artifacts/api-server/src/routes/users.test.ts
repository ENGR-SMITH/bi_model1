import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  clerkUser: null as {
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    imageUrl: string | null;
  } | null,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUser: vi.fn(async (id: string) => {
        if (!state.clerkUser || id !== state.clerkUser.id) {
          throw new Error("User not found");
        }
        return state.clerkUser;
      }),
    },
  },
}));

import usersRouter from "./users";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const API = createApp();

beforeEach(() => {
  state.userId = "viewer-1";
  state.clerkUser = {
    id: "partner-1",
    firstName: "Ada",
    lastName: "Lovelace",
    username: "ada_writes",
    imageUrl: "https://img.clerk.com/ada.png",
  };
});

afterEach(() => {
  state.userId = null;
  state.clerkUser = null;
});

describe("user profiles", () => {
  it("rejects unauthenticated lookups", async () => {
    state.userId = null;
    const res = await request(API).get("/api/users/partner-1/profile");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
  });

  it("returns the display name and profile image for an authenticated viewer", async () => {
    const res = await request(API).get("/api/users/partner-1/profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: "partner-1",
      displayName: "Ada Lovelace",
      imageUrl: "https://img.clerk.com/ada.png",
    });
  });

  it("falls back to the username when the account has no name", async () => {
    state.clerkUser = {
      id: "partner-2",
      firstName: null,
      lastName: null,
      username: "ada_writes",
      imageUrl: null,
    };
    const res = await request(API).get("/api/users/partner-2/profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: "partner-2",
      displayName: "ada_writes",
      imageUrl: null,
    });
  });

  it("returns 404 for an unknown user", async () => {
    const res = await request(API).get("/api/users/nobody/profile");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "User not found" });
  });
});
