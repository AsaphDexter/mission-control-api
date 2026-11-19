import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createAccessToken } from "../src/modules/auth/security/access-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const TEST_SESSION_ID = "f13c9c0a-3d24-4a77-a1b3-123456789abc";

const TEST_JWT_KEY = Buffer.alloc(32, 0x73);
const TEST_JWT_SECRET = TEST_JWT_KEY.toString("base64url");

const findUser = vi.fn();
const findActiveSessionToken = vi.fn();
const findRolePermissions = vi.fn();
const disconnect = vi.fn();

const prismaMock = {
  user: {
    findUnique: findUser,
  },
  refreshToken: {
    findFirst: findActiveSessionToken,
  },
  rolePermission: {
    findMany: findRolePermissions,
  },
  $disconnect: disconnect,
} as unknown as PrismaClient;

function activeUser() {
  return {
    id: TEST_USER_ID,
    email: "amina@example.com",
    first_name: "Amina",
    last_name: "Okafor",
    display_name: "Amina",
    status: "ACTIVE",
    auth_version: 1,
    email_verified_at: new Date("2026-11-01T10:00:00.000Z"),
    user_roles: [
      {
        role: {
          code: "LEARNER",
        },
      },
    ],
  };
}

type AuthorizationErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

let previousJwtSecret: string | undefined;

describe("Fastify authorization guard", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    previousJwtSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  });

  afterAll(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = previousJwtSecret;
    }
  });

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;

    findUser.mockReset().mockResolvedValue(activeUser());

    findActiveSessionToken.mockReset().mockResolvedValue({ id: "test-refresh-token-id" });

    findRolePermissions.mockReset().mockResolvedValue([]);

    disconnect.mockReset().mockResolvedValue(undefined);

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });

    // Requires resources.create.
    app.get(
      "/__test/authorization/single",
      {
        preHandler: [app.authenticate, app.authorize("resources.create")],
      },
      async () => ({
        message: "Resource creation permitted.",
      }),
    );

    // Requires both permissions by default.
    app.get(
      "/__test/authorization/all",
      {
        preHandler: [app.authenticate, app.authorize(["resources.create", "resources.publish"])],
      },
      async () => ({
        message: "All required permissions granted.",
      }),
    );

    // Requires at least one permission.
    app.get(
      "/__test/authorization/any",
      {
        preHandler: [
          app.authenticate,
          app.authorize(["resources.create", "resources.review"], { mode: "any" }),
        ],
      },
      async () => ({
        message: "At least one required permission granted.",
      }),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  async function makeAccessToken(): Promise<string> {
    return createAccessToken(TEST_USER_ID, 1, TEST_SESSION_ID);
  }

  function expectAuthorizationError(
    response: {
      statusCode: number;
      json: () => AuthorizationErrorResponse;
    },
    statusCode: number,
    errorCode: string,
  ): void {
    expect(response.statusCode).toBe(statusCode);

    expect(response.json()).toMatchObject({
      error: {
        code: errorCode,
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  }

  it("rejects unauthenticated requests with HTTP 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/single",
    });

    expectAuthorizationError(response, 401, "UNAUTHENTICATED");

    expect(findRolePermissions).not.toHaveBeenCalled();
  });

  it("allows an authenticated user with the required permission", async () => {
    findRolePermissions.mockResolvedValue([{ permission: { code: "resources.create" } }]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/single",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toStrictEqual({
      message: "Resource creation permitted.",
    });

    expect(findRolePermissions).toHaveBeenCalledOnce();
  });

  it("rejects authenticated users without the required permission with HTTP 403", async () => {
    findRolePermissions.mockResolvedValue([]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/single",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthorizationError(response, 403, "FORBIDDEN");
  });

  it("requires all permissions by default", async () => {
    findRolePermissions.mockResolvedValue([{ permission: { code: "resources.create" } }]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/all",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthorizationError(response, 403, "FORBIDDEN");
  });

  it("grants access when all required permissions are present", async () => {
    findRolePermissions.mockResolvedValue([
      { permission: { code: "resources.create" } },
      { permission: { code: "resources.publish" } },
    ]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/all",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("allows access when at least one permission is present in any mode", async () => {
    findRolePermissions.mockResolvedValue([{ permission: { code: "resources.review" } }]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/any",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toStrictEqual({
      message: "At least one required permission granted.",
    });
  });

  it("returns HTTP 503 when the authorization database query fails", async () => {
    findRolePermissions.mockRejectedValue(new Error("Database unavailable"));

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/authorization/single",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthorizationError(response, 503, "AUTHORIZATION_UNAVAILABLE");
  });

  it("checks current database permissions on every request", async () => {
    findRolePermissions
      .mockResolvedValueOnce([{ permission: { code: "resources.create" } }])
      .mockResolvedValueOnce([]);

    const token = await makeAccessToken();

    const firstResponse = await app.inject({
      method: "GET",
      url: "/__test/authorization/single",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const secondResponse = await app.inject({
      method: "GET",
      url: "/__test/authorization/single",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(403);

    expect(findRolePermissions).toHaveBeenCalledTimes(2);
  });
});
