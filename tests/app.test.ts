import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const app = buildApp({ logger: false });

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

  it("returns HTTP 200 from the readiness endpoint", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({
      status: "ready",
      checks: {
        application: "ready",
      },
    });
  });
});
