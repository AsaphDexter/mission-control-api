import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createAccessToken } from "../src/modules/auth/security/access-token.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const OTHER_USER_ID = "7a2c9c0a-3d24-4a77-a1b3-123456789def";
const RAW_REFRESH_TOKEN = "L".repeat(43);
const TOKEN_FAMILY_ID = "5a3c9c0a-3d24-4a77-a1b3-123456789abc";

const findAuthenticatedUser = vi.fn();
const findStoredToken = vi.fn();
const revokeFamilyTokens = vi.fn();
const incrementUserAuthVersion = vi.fn();
const disconnect = vi.fn();

const transactionClient = {
  refreshToken: {
    findUnique: findStoredToken,
    updateMany: revokeFamilyTokens,
  },
  user: {
    update: incrementUserAuthVersion,
  },
};

const runTransaction = vi.fn(
  async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
    callback(transactionClient),
);

const prismaMock = {
  user: {
    findUnique: findAuthenticatedUser,
  },
  $transaction: runTransaction,
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
  ],
});

const storedToken = (userId = TEST_USER_ID) => ({
  user_id: userId,
  family_id: TOKEN_FAMILY_ID,
});

let previousJwtSecret: string | undefined;

describe("POST /api/v1/auth/logout", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    previousJwtSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = Buffer.alloc(32, 0x73).toString("base64url");
  });

  afterAll(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = previousJwtSecret;
    }
  });

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = Buffer.alloc(32, 0x73).toString("base64url");

    findAuthenticatedUser.mockReset().mockResolvedValue(activeUser());
    findStoredToken.mockReset().mockResolvedValue(storedToken());
    incrementUserAuthVersion.mockReset().mockResolvedValue({});

    revokeFamilyTokens.mockReset().mockResolvedValue({
      count: 2,
    });

    disconnect.mockReset().mockResolvedValue(undefined);

    runTransaction.mockReset().mockImplementation(async (callback) => callback(transactionClient));

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });

    app.get(
      "/__test/protected",
      {
        preHandler: app.authenticate,
      },
      async (request) => ({
        userId: request.authenticatedUser?.id ?? null,
      }),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  async function makeAccessToken(): Promise<string> {
    return createAccessToken(TEST_USER_ID, 1);
  }

  it("revokes the authenticated user's refresh-token family", async () => {
    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.payload).toBe("");

    expect(findStoredToken).toHaveBeenCalledWith({
      where: {
        token_hash: hashOpaqueToken(RAW_REFRESH_TOKEN),
      },
      select: {
        user_id: true,
        family_id: true,
      },
    });

    expect(revokeFamilyTokens).toHaveBeenCalledWith({
      where: {
        user_id: TEST_USER_ID,
        family_id: TOKEN_FAMILY_ID,
        revoked_at: null,
      },
      data: {
        revoked_at: expect.any(Date),
      },
    });

    expect(runTransaction).toHaveBeenCalledOnce();
  });

  it("rejects logout without a bearer access token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");

    expect(findStoredToken).not.toHaveBeenCalled();
    expect(revokeFamilyTokens).not.toHaveBeenCalled();
  });

  it("rejects a malformed refresh-token request", async () => {
    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: "short",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    expect(findStoredToken).not.toHaveBeenCalled();
  });

  it("rejects a request containing unexpected fields", async () => {
    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
        userId: OTHER_USER_ID,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    expect(findStoredToken).not.toHaveBeenCalled();
  });

  it("returns 404 when the refresh token does not exist", async () => {
    findStoredToken.mockResolvedValue(null);

    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("LOGOUT_SESSION_NOT_FOUND");

    expect(revokeFamilyTokens).not.toHaveBeenCalled();
  });

  it("does not revoke a refresh-token family belonging to another user", async () => {
    findStoredToken.mockResolvedValue(storedToken(OTHER_USER_ID));

    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("LOGOUT_SESSION_NOT_FOUND");

    expect(revokeFamilyTokens).not.toHaveBeenCalled();
  });

  it("returns 204 when the session family has already been revoked", async () => {
    revokeFamilyTokens.mockResolvedValue({
      count: 0,
    });

    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(204);
  });

  it("returns 500 when the logout transaction fails", async () => {
    runTransaction.mockRejectedValueOnce(new Error("Database unavailable"));

    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("rejects refresh-token replay after logout without treating it as token reuse", async () => {
    const loggedOutToken = {
      id: "logged-out-refresh-token-id",
      user_id: TEST_USER_ID,
      token_hash: hashOpaqueToken(RAW_REFRESH_TOKEN),
      family_id: TOKEN_FAMILY_ID,
      auth_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: new Date(),
      replaced_by_token_id: null,
    };

    // First lookup belongs to logout. Second lookup represents
    // the same token after its family has been revoked.
    findStoredToken.mockResolvedValueOnce(storedToken()).mockResolvedValueOnce(loggedOutToken);

    const accessToken = await makeAccessToken();

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(logoutResponse.statusCode).toBe(204);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(refreshResponse.statusCode).toBe(401);
    expect(refreshResponse.json().error.code).toBe("INVALID_REFRESH_TOKEN");

    // Logout revoked the family once. Replay must not trigger
    // another family revocation or account-wide invalidation.
    expect(revokeFamilyTokens).toHaveBeenCalledOnce();
    expect(incrementUserAuthVersion).not.toHaveBeenCalled();
  });

  it("allows the existing access token until expiry after ordinary logout", async () => {
    const accessToken = await makeAccessToken();

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(logoutResponse.statusCode).toBe(204);

    const protectedResponse = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    expect(protectedResponse.statusCode).toBe(200);
    expect(protectedResponse.json()).toStrictEqual({
      userId: TEST_USER_ID,
    });

    expect(incrementUserAuthVersion).not.toHaveBeenCalled();
  });
});
