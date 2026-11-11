import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createAccessToken } from "../src/modules/auth/security/access-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const TEST_JWT_KEY = Buffer.alloc(32, 0x73);
const TEST_JWT_SECRET = TEST_JWT_KEY.toString("base64url");

const findUser = vi.fn();
const disconnect = vi.fn();

const prismaMock = {
  user: {
    findUnique: findUser,
  },
  $disconnect: disconnect,
} as unknown as PrismaClient;

const activeUser = () => ({
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
    {
      role: {
        code: "CONTRIBUTOR",
      },
    },
  ],
});

let previousJwtSecret: string | undefined;

describe("Authentication plugin", () => {
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
    disconnect.mockReset().mockResolvedValue(undefined);

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });

    // Test-only protected endpoint using the real authentication hook.
    app.get(
      "/__test/protected",
      {
        preHandler: app.authenticate,
      },
      async (request) => ({
        user: request.authenticatedUser,
      }),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  async function makeAccessToken(userId = TEST_USER_ID, authVersion = 1): Promise<string> {
    return createAccessToken(userId, authVersion);
  }

  function expectAuthenticationError(
    response: { statusCode: number; json: () => Record<string, unknown> },
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

  it("rejects requests without an Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
    });

    expectAuthenticationError(response, 401, "UNAUTHENTICATED");
    expect(findUser).not.toHaveBeenCalled();
  });

  it("rejects an incorrectly formatted Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: "Basic invalid-credentials",
      },
    });

    expectAuthenticationError(response, 401, "UNAUTHENTICATED");
    expect(findUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid access token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: "Bearer invalid.jwt.token",
      },
    });

    expectAuthenticationError(response, 401, "INVALID_ACCESS_TOKEN");
    expect(findUser).not.toHaveBeenCalled();
  });

  it("rejects an expired access token", async () => {
    const now = Math.floor(Date.now() / 1000);

    const expiredToken = await new SignJWT({
      authVersion: 1,
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "JWT",
      })
      .setIssuer("mission-control-api")
      .setAudience("mission-control-api")
      .setSubject(TEST_USER_ID)
      .setIssuedAt(now - 1800)
      .setExpirationTime(now - 900)
      .sign(TEST_JWT_KEY);

    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${expiredToken}`,
      },
    });

    expectAuthenticationError(response, 401, "INVALID_ACCESS_TOKEN");
    expect(findUser).not.toHaveBeenCalled();
  });

  it("returns 503 when the JWT signing configuration is missing", async () => {
    delete process.env.JWT_ACCESS_SECRET;

    try {
      const response = await app.inject({
        method: "GET",
        url: "/__test/protected",
        headers: {
          authorization: "Bearer structurally.valid.but.unverifiable",
        },
      });

      expectAuthenticationError(response, 503, "SERVICE_UNAVAILABLE");
      expect(findUser).not.toHaveBeenCalled();
    } finally {
      process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
    }
  });

  it("rejects a valid token when the account does not exist", async () => {
    findUser.mockResolvedValue(null);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthenticationError(response, 401, "SESSION_INVALID");
    expect(findUser).toHaveBeenCalledOnce();
  });

  it.each(["PENDING_VERIFICATION", "SUSPENDED", "DEACTIVATED"] as const)(
    "rejects an account with status %s",
    async (status) => {
      findUser.mockResolvedValue({
        ...activeUser(),
        status,
        email_verified_at:
          status === "PENDING_VERIFICATION" ? null : new Date("2026-11-01T10:00:00.000Z"),
      });

      const token = await makeAccessToken();

      const response = await app.inject({
        method: "GET",
        url: "/__test/protected",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expectAuthenticationError(response, 401, "SESSION_INVALID");
    },
  );

  it("rejects an active account whose email is not verified", async () => {
    findUser.mockResolvedValue({
      ...activeUser(),
      email_verified_at: null,
    });

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthenticationError(response, 401, "SESSION_INVALID");
  });

  it("rejects a token issued under an outdated authentication version", async () => {
    findUser.mockResolvedValue({
      ...activeUser(),
      auth_version: 2,
    });

    const token = await makeAccessToken(TEST_USER_ID, 1);

    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthenticationError(response, 401, "SESSION_INVALID");
  });

  it("returns 503 when the account lookup fails", async () => {
    findUser.mockRejectedValue(new Error("Database unavailable"));

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectAuthenticationError(response, 503, "SERVICE_UNAVAILABLE");
  });

  it("authenticates an active, verified user and attaches their account details", async () => {
    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toStrictEqual({
      user: {
        id: TEST_USER_ID,
        email: "amina@example.com",
        firstName: "Amina",
        lastName: "Okafor",
        displayName: "Amina",
        authVersion: 1,
        roles: ["LEARNER", "CONTRIBUTOR"],
      },
    });

    expect(findUser).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: TEST_USER_ID,
        },
        select: expect.objectContaining({
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          display_name: true,
          status: true,
          auth_version: true,
          email_verified_at: true,
          user_roles: {
            where: {
              revoked_at: null,
            },
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        }),
      }),
    );
  });
});
