import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";

const findVerificationToken = vi.fn();
const consumeVerificationToken = vi.fn();
const activateUser = vi.fn();
const disconnect = vi.fn();

const transactionClient = {
  emailVerificationToken: {
    findUnique: findVerificationToken,
    updateMany: consumeVerificationToken,
  },
  user: {
    updateMany: activateUser,
  },
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

const verificationToken = "A".repeat(43);

function makeStoredToken(
  overrides: {
    expiresAt?: Date;
    consumedAt?: Date | null;
    status?: string;
    emailVerifiedAt?: Date | null;
  } = {},
) {
  return {
    id: "verification-token-id",
    user_id: "test-user-id",
    expires_at: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    consumed_at: overrides.consumedAt ?? null,
    user: {
      status: overrides.status ?? "PENDING_VERIFICATION",
      email_verified_at: overrides.emailVerifiedAt ?? null,
    },
  };
}

describe("POST /api/v1/auth/verify-email", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    findVerificationToken.mockReset().mockResolvedValue(makeStoredToken());

    consumeVerificationToken.mockReset().mockResolvedValue({ count: 1 });

    activateUser.mockReset().mockResolvedValue({ count: 1 });

    disconnect.mockReset().mockResolvedValue(undefined);

    runTransaction.mockReset().mockImplementation(async (callback) => callback(transactionClient));

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("verifies the email and activates the account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.message).toContain("verified successfully");

    expect(findVerificationToken).toHaveBeenCalledWith({
      where: {
        token_hash: hashOpaqueToken(verificationToken),
      },
      select: expect.any(Object),
    });

    expect(consumeVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "verification-token-id",
          consumed_at: null,
        }),
      }),
    );

    expect(activateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "test-user-id",
          status: "PENDING_VERIFICATION",
        }),
        data: expect.objectContaining({
          status: "ACTIVE",
        }),
      }),
    );
  });

  it("returns 404 when the token does not exist", async () => {
    findVerificationToken.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("VERIFICATION_TOKEN_NOT_FOUND");

    expect(consumeVerificationToken).not.toHaveBeenCalled();
    expect(activateUser).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    findVerificationToken.mockResolvedValue(
      makeStoredToken({
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("VERIFICATION_TOKEN_CONFLICT");

    expect(activateUser).not.toHaveBeenCalled();
  });

  it("rejects a token that has already been consumed", async () => {
    findVerificationToken.mockResolvedValue(
      makeStoredToken({
        consumedAt: new Date(Date.now() - 30_000),
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(409);
    expect(activateUser).not.toHaveBeenCalled();
  });

  it("rejects a token when another request has already consumed it", async () => {
    consumeVerificationToken.mockResolvedValue({ count: 0 });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(409);
    expect(activateUser).not.toHaveBeenCalled();
  });

  it("returns 400 when the token is missing or malformed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    expect(findVerificationToken).not.toHaveBeenCalled();
  });
});
