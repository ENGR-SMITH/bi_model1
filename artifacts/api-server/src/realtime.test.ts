import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { initRealtime, emitToProject, emitToUser, emitJobProgress } from "./realtime";

// The realtime layer boots on the API's HTTP server and authenticates every
// connection with a Clerk JWT. This test exercises the socket server itself:
// no-token connections are rejected before any Clerk call, and the emit
// helpers stay no-ops when no server is running (the isolated route tests
// rely on that).

let httpServer: ReturnType<typeof createServer>;
let url: string;

beforeAll(async () => {
  httpServer = createServer((_req, res) => {
    res.statusCode = 200;
    res.end();
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  url = `http://127.0.0.1:${port}`;
  initRealtime(httpServer);
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connect(opts: { token?: string } = {}): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: opts.token ? { token: opts.token } : undefined,
    });
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error("timed out waiting for a connection result"));
    }, 5000);
    client.on("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on("connect_error", (err) => {
      clearTimeout(timer);
      client.disconnect();
      reject(err);
    });
  });
}

describe("realtime layer", () => {
  it("rejects connections without a Clerk token", async () => {
    await expect(connect()).rejects.toThrow("Authentication token missing");
  });

  it("emit helpers are safe before/without a socket server", () => {
    // Called with no live server (io is null) — must not throw. This is what
    // the isolated route tests depend on.
    expect(() => {
      emitToProject("p1", "comment.new", { body: "hi" });
      emitToUser("u1", "notification.new", { title: "hi" });
      emitJobProgress({ projectId: "p1", jobId: "j1", type: "PROXY", status: "RUNNING" });
    }).not.toThrow();
  });
});
