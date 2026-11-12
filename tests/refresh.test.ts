import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";
import { verifyAccessToken } from "../src/modules/auth/security/access-token.js";

const RAW_REFRESH_TOKEN = "R".repeat(43);

const findStoredToken = vi.fn();
const updateRefreshTokenMany = vi.fn();
const createNewRefreshToken = vi.fn();
const updateOldRefreshToken = vi.fn();
const incrementUserAuthVersion = vi.fn();
const disconnect = vi.fn();
const lockUserRow = vi.fn();

const transactionClient = {
  refreshToken: {
    findUnique: findStoredToken,
    updateMany: updateRefreshTokenMany,
    create: createNewRefreshToken,
    update: updateOldRefreshToken,
  },
  user: {
    update: incrementUserAuthVersion,
  },
  $queryRaw: lockUserRow,
};

const runTransaction = vi.fn(
  async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
    callback(transactionClient),
);

const prismaMock = {
  $transaction: runTransaction,
  $disconnect: disconnect,
  user: {
    findUnique: vi.fn(),
  },
} as unknown as PrismaClient;

const activeStoredToken = () => ({
  id: "old-refresh-token-id",
  user_id: "test-user-id",
  token_hash: hashOpaqueToken(RAW_REFRESH_TOKEN),
  family_id: "test-token-family-id",
  auth_version_at_issue: 1,
  expires_at: new Date(Date.now() + 60_000),
  revoked_at: null,
  replaced_by_token_id: null,
  user: {
    id: "test-user-id",
    email: "amina@example.com",
    first_name: "Amina",
    last_name: "Okafor",
    display_name: "Amina",
    status: "ACTIVE",
    auth_version: 1,
    email_verified_at: new Date("2026-11-01T10:00:00.000Z"),
    created_at: new Date("2026-11-01T09:00:00.000Z"),
    user_roles: [
      {
        role: {
          code: "LEARNER",
        },
      },
    ],
  },
});

let previousJwtSecret: string | undefined;

describe("POST /api/v1/auth/refresh", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    previousJwtSecret = process.env.JWT_ACCESS_SECRET;

    process.env.JWT_ACCESS_SECRET = Buffer.alloc(32, 0x52).toString("base64url");
  });

  afterAll(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = previousJwtSecret;
    }
  });

  beforeEach(() => {
    findStoredToken.mockReset().mockResolvedValue(activeStoredToken());

    updateRefreshTokenMany.mockReset().mockResolvedValue({
      count: 1,
    });

    createNewRefreshToken.mockReset().mockResolvedValue({
      id: "replacement-refresh-token-id",
    });

    updateOldRefreshToken.mockReset().mockResolvedValue({});
    incrementUserAuthVersion.mockReset().mockResolvedValue({});
    disconnect.mockReset().mockResolvedValue(undefined);
    lockUserRow.mockReset().mockResolvedValue([{ id: "test-user-id" }]);

    runTransaction.mockReset().mockImplementation(async (callback) => callback(transactionClient));

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("rotates a valid refresh token and returns a new session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.data).toMatchObject({
      tokenType: "Bearer",
      expiresIn: 900,
      refreshTokenExpiresIn: 604800,
      user: {
        id: "test-user-id",
        email: "amina@example.com",
        status: "ACTIVE",
        emailVerified: true,
        roles: ["LEARNER"],
      },
    });

    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.data.refreshToken).not.toBe(RAW_REFRESH_TOKEN);

    const claims = await verifyAccessToken(body.data.accessToken);

    expect(claims.userId).toBe("test-user-id");
    expect(claims.authVersion).toBe(1);

    // Only the new token's hash must be stored.
    expect(createNewRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: "test-user-id",
          token_hash: hashOpaqueToken(body.data.refreshToken),
          family_id: "test-token-family-id",
          auth_version_at_issue: 1,
          expires_at: expect.any(Date),
        }),
      }),
    );

    // Previous token must be revoked.
    expect(updateRefreshTokenMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "old-refresh-token-id",
          revoked_at: null,
        }),
        data: expect.objectContaining({
          revoked_at: expect.any(Date),
          last_used_at: expect.any(Date),
        }),
      }),
    );

    // Previous token must link to its replacement.
    expect(updateOldRefreshToken).toHaveBeenCalledWith({
      where: {
        id: "old-refresh-token-id",
      },
      data: {
        replaced_by_token_id: "replacement-refresh-token-id",
      },
    });

    expect(body.meta.requestId).toBeTruthy();
  });

  it("rejects an unknown refresh token", async () => {
    findStoredToken.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_REFRESH_TOKEN");

    expect(createNewRefreshToken).not.toHaveBeenCalled();
    expect(incrementUserAuthVersion).not.toHaveBeenCalled();
  });

  it("rejects an expired refresh token", async () => {
    findStoredToken.mockResolvedValue({
      ...activeStoredToken(),
      expires_at: new Date(Date.now() - 60_000),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_REFRESH_TOKEN");

    expect(updateRefreshTokenMany).not.toHaveBeenCalled();
    expect(createNewRefreshToken).not.toHaveBeenCalled();
  });

  it("rejects a refresh token issued under an old auth version", async () => {
    findStoredToken.mockResolvedValue({
      ...activeStoredToken(),
      user: {
        ...activeStoredToken().user,
        auth_version: 2,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_REFRESH_TOKEN");

    expect(createNewRefreshToken).not.toHaveBeenCalled();
  });

  it("revokes the token family and increments auth_version on reuse", async () => {
    findStoredToken.mockResolvedValue({
      ...activeStoredToken(),
      revoked_at: new Date(Date.now() - 30_000),
      replaced_by_token_id: "previous-replacement-id",
    });

    updateRefreshTokenMany.mockResolvedValue({
      count: 2,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("REFRESH_TOKEN_REUSE_DETECTED");

    expect(updateRefreshTokenMany).toHaveBeenCalledWith({
      where: {
        user_id: "test-user-id",
        family_id: "test-token-family-id",
        revoked_at: null,
      },
      data: {
        revoked_at: expect.any(Date),
      },
    });

    expect(incrementUserAuthVersion).toHaveBeenCalledWith({
      where: {
        id: "test-user-id",
      },
      data: {
        auth_version: {
          increment: 1,
        },
      },
    });

    expect(createNewRefreshToken).not.toHaveBeenCalled();
  });

  it("detects concurrent reuse after another request claims the token", async () => {
    findStoredToken
      .mockResolvedValueOnce(activeStoredToken())
      .mockResolvedValueOnce(activeStoredToken())
      .mockResolvedValueOnce({
        revoked_at: new Date(),
        replaced_by_token_id: "concurrent-replacement-id",
      });

    updateRefreshTokenMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 2 });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: RAW_REFRESH_TOKEN,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("REFRESH_TOKEN_REUSE_DETECTED");

    expect(findStoredToken).toHaveBeenCalledTimes(3);
    expect(incrementUserAuthVersion).toHaveBeenCalledOnce();
    expect(createNewRefreshToken).not.toHaveBeenCalled();
  });

  it("rejects a malformed refresh-token request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: "short",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    expect(findStoredToken).not.toHaveBeenCalled();
  });
});
