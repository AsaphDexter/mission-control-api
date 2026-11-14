import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createAccessToken } from "../src/modules/auth/security/access-token.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const OTHER_USER_ID = "7a2c9c0a-3d24-4a77-a1b3-123456789def";
const RAW_REFRESH_TOKEN = "L".repeat(43);
const TOKEN_FAMILY_ID = "f13c9c0a-3d24-4a77-a1b3-123456789abc";
const OTHER_SESSION_FAMILY_ID = "a13c9c0a-3d24-4a77-a1b3-123456789abc";
const OTHER_RAW_REFRESH_TOKEN = "B".repeat(43);

const activeSessionFamilyIds = new Set<string>();

const findAuthenticatedUser = vi.fn();
const findActiveSessionToken = vi.fn();
const findStoredToken = vi.fn();
const findRefreshToken = vi.fn();
const lockUserRow = vi.fn();
const revokeFamilyTokens = vi.fn();
const incrementUserAuthVersion = vi.fn();
const disconnect = vi.fn();

const transactionClient = {
  $queryRaw: lockUserRow,
  refreshToken: {
    findFirst: findStoredToken,
    findUnique: findRefreshToken,
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
  refreshToken: {
    findFirst: findActiveSessionToken,
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

    activeSessionFamilyIds.clear();
    activeSessionFamilyIds.add(TOKEN_FAMILY_ID);

    findActiveSessionToken
      .mockReset()
      .mockImplementation(async (args: { where: { family_id: string } }) => {
        return activeSessionFamilyIds.has(args.where.family_id)
          ? { id: "active-test-refresh-token" }
          : null;
      });

    findStoredToken.mockReset().mockResolvedValue(storedToken());
    findRefreshToken.mockReset().mockResolvedValue(null);
    incrementUserAuthVersion.mockReset().mockResolvedValue({});
    lockUserRow.mockReset().mockResolvedValue([{ id: TEST_USER_ID }]);

    revokeFamilyTokens
      .mockReset()
      .mockImplementation(async (args: { where: { family_id: string } }) => {
        const wasActive = activeSessionFamilyIds.has(args.where.family_id);

        activeSessionFamilyIds.delete(args.where.family_id);

        return {
          count: wasActive ? 2 : 0,
        };
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

  async function makeAccessToken(sessionId = TOKEN_FAMILY_ID): Promise<string> {
    return createAccessToken(TEST_USER_ID, 1, sessionId);
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
        user_id: TEST_USER_ID,
        family_id: TOKEN_FAMILY_ID,
      },
      select: {
        family_id: true,
      },
    });

    expect(findActiveSessionToken).toHaveBeenCalledWith({
      where: {
        user_id: TEST_USER_ID,
        family_id: TOKEN_FAMILY_ID,
        auth_version_at_issue: 1,
        revoked_at: null,
        expires_at: {
          gt: expect.any(Date),
        },
      },
      select: {
        id: true,
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

    expect(findStoredToken).toHaveBeenCalledWith({
      where: {
        token_hash: hashOpaqueToken(RAW_REFRESH_TOKEN),
        user_id: TEST_USER_ID,
        family_id: TOKEN_FAMILY_ID,
      },
      select: {
        family_id: true,
      },
    });

    expect(revokeFamilyTokens).not.toHaveBeenCalled();
  });

  it("does not allow one device to log out another device's session", async () => {
    activeSessionFamilyIds.add(OTHER_SESSION_FAMILY_ID);

    findStoredToken.mockResolvedValue(null);

    const accessToken = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        refreshToken: OTHER_RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("LOGOUT_SESSION_NOT_FOUND");

    expect(findStoredToken).toHaveBeenCalledWith({
      where: {
        token_hash: hashOpaqueToken(OTHER_RAW_REFRESH_TOKEN),
        user_id: TEST_USER_ID,
        family_id: TOKEN_FAMILY_ID,
      },
      select: {
        family_id: true,
      },
    });

    expect(revokeFamilyTokens).not.toHaveBeenCalled();

    const otherDeviceToken = await makeAccessToken(OTHER_SESSION_FAMILY_ID);

    const otherDeviceResponse = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${otherDeviceToken}`,
      },
    });

    expect(otherDeviceResponse.statusCode).toBe(200);
  });

  it("returns 204 when another logout revokes the family after authentication", async () => {
    revokeFamilyTokens.mockImplementationOnce(async (args: { where: { family_id: string } }) => {
      activeSessionFamilyIds.delete(args.where.family_id);

      return {
        count: 0,
      };
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

    findStoredToken.mockResolvedValue(storedToken());
    findRefreshToken.mockResolvedValue(loggedOutToken);

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

    expect(revokeFamilyTokens).toHaveBeenCalledOnce();
    expect(incrementUserAuthVersion).not.toHaveBeenCalled();
  });

  it("invalidates the logged-out device while preserving a sibling session", async () => {
    activeSessionFamilyIds.add(OTHER_SESSION_FAMILY_ID);

    const deviceAAccessToken = await makeAccessToken();
    const deviceBAccessToken = await makeAccessToken(OTHER_SESSION_FAMILY_ID);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${deviceAAccessToken}`,
      },
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(logoutResponse.statusCode).toBe(204);

    const deviceAResponse = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${deviceAAccessToken}`,
      },
    });

    expect(deviceAResponse.statusCode).toBe(401);
    expect(deviceAResponse.json().error.code).toBe("SESSION_INVALID");

    const deviceBResponse = await app.inject({
      method: "GET",
      url: "/__test/protected",
      headers: {
        authorization: `Bearer ${deviceBAccessToken}`,
      },
    });

    expect(deviceBResponse.statusCode).toBe(200);
    expect(deviceBResponse.json()).toStrictEqual({
      userId: TEST_USER_ID,
    });

    expect(activeSessionFamilyIds.has(TOKEN_FAMILY_ID)).toBe(false);
    expect(activeSessionFamilyIds.has(OTHER_SESSION_FAMILY_ID)).toBe(true);

    expect(incrementUserAuthVersion).not.toHaveBeenCalled();
  });
});
