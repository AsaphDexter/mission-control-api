
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";

const queryRaw = vi.fn().mockResolvedValue([{ result: 1 }]);
const disconnect = vi.fn().mockResolvedValue(undefined);

const prismaMock = {
  $queryRaw: queryRaw,
  $disconnect: disconnect,
} as unknown as PrismaClient;

const app = buildApp({
  logger: false,
  prisma: prismaMock,
});

afterAll(async () => {
  await app.close();
});

describe("Health routes", () => {
  it("returns HTTP 200 from the health endpoint", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({
      status: "ok",
    });
  });

  it("returns HTTP 200 when the database is available", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({
      status: "ready",
      checks: {
        application: "ready",
        database: "ready",
      },
    });

    expect(queryRaw).toHaveBeenCalled();
  });

  it("returns HTTP 503 when the database is unavailable", async () => {
    queryRaw.mockRejectedValueOnce(new Error("Database unavailable"));

    const response = await app.inject({
      method: "GET",
      url: "/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toStrictEqual({
      status: "not_ready",
      checks: {
        application: "ready",
        database: "unavailable",
      },
    });
  });
});
