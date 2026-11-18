import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  InvalidPasswordResetTokenError,
  resetPassword,
} from "../src/modules/auth/password-reset.service.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";
import { hashPassword } from "../src/modules/auth/security/password.js";

vi.mock("../src/modules/auth/security/password.js", () => ({
  hashPassword: vi.fn(),
}));

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const RESET_TOKEN_ID = "password-reset-token-id";
const RAW_RESET_TOKEN = "R".repeat(43);
const TOKEN_HASH = hashOpaqueToken(RAW_RESET_TOKEN);

const FIXED_NOW = new Date("2026-11-15T10:00:00.000Z");
const FUTURE_EXPIRY = new Date("2026-11-15T10:30:00.000Z");

const findInitialToken = vi.fn();
const lockUserRow = vi.fn();
const findCurrentToken = vi.fn();
const updateResetTokens = vi.fn();
const updateUser = vi.fn();
const revokeRefreshTokens = vi.fn();

const transactionClient = {
  $queryRaw: lockUserRow,
  passwordResetToken: {
    findUnique: findCurrentToken,
    updateMany: updateResetTokens,
  },
  user: {
    updateMany: updateUser,
  },
  refreshToken: {
    updateMany: revokeRefreshTokens,
  },
};

const runTransaction = vi.fn(
  async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
    callback(transactionClient),
);

const prismaMock = {
  passwordResetToken: {
    findUnique: findInitialToken,
  },
  $transaction: runTransaction,
} as unknown as PrismaClient;

const validResetToken = (
  overrides: Partial<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: Date;
    consumed_at: Date | null;
  }> = {},
) => ({
  id: RESET_TOKEN_ID,
  user_id: TEST_USER_ID,
  token_hash: TOKEN_HASH,
  expires_at: FUTURE_EXPIRY,
  consumed_at: null,
  ...overrides,
});

describe("Password reset service", () => {
  beforeEach(() => {
    vi.mocked(hashPassword).mockReset().mockResolvedValue("new-argon2-password-hash");

    findInitialToken.mockReset().mockResolvedValue(validResetToken());

    lockUserRow.mockReset().mockResolvedValue([{ id: TEST_USER_ID }]);

    findCurrentToken.mockReset().mockResolvedValue(validResetToken());

    updateResetTokens
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    updateUser.mockReset().mockResolvedValue({ count: 1 });

    revokeRefreshTokens.mockReset().mockResolvedValue({ count: 3 });

    runTransaction.mockReset().mockImplementation(async (callback) => {
      return callback(transactionClient);
    });
  });

  it("resets the password, increments auth_version and revokes all active sessions", async () => {
    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).resolves.toBeUndefined();

    expect(findInitialToken).toHaveBeenCalledWith({
      where: {
        token_hash: TOKEN_HASH,
      },
      select: {
        id: true,
        user_id: true,
        expires_at: true,
        consumed_at: true,
      },
    });

    expect(hashPassword).toHaveBeenCalledWith("A-Strong-New-Password-2026");
    expect(runTransaction).toHaveBeenCalledOnce();
    expect(lockUserRow).toHaveBeenCalledOnce();

    expect(findCurrentToken).toHaveBeenCalledWith({
      where: {
        id: RESET_TOKEN_ID,
      },
      select: {
        id: true,
        user_id: true,
        token_hash: true,
        expires_at: true,
        consumed_at: true,
      },
    });

    expect(updateResetTokens).toHaveBeenNthCalledWith(1, {
      where: {
        id: RESET_TOKEN_ID,
        user_id: TEST_USER_ID,
        token_hash: TOKEN_HASH,
        consumed_at: null,
        expires_at: {
          gt: FIXED_NOW,
        },
      },
      data: {
        consumed_at: FIXED_NOW,
      },
    });

    expect(updateUser).toHaveBeenCalledWith({
      where: {
        id: TEST_USER_ID,
        status: "ACTIVE",
        email_verified_at: {
          not: null,
        },
      },
      data: {
        password_hash: "new-argon2-password-hash",
        auth_version: {
          increment: 1,
        },
      },
    });

    expect(updateResetTokens).toHaveBeenNthCalledWith(2, {
      where: {
        user_id: TEST_USER_ID,
        consumed_at: null,
      },
      data: {
        consumed_at: FIXED_NOW,
      },
    });

    expect(revokeRefreshTokens).toHaveBeenCalledWith({
      where: {
        user_id: TEST_USER_ID,
        revoked_at: null,
      },
      data: {
        revoked_at: FIXED_NOW,
      },
    });
  });

  it.each([
    {
      description: "unknown",
      token: null,
    },
    {
      description: "already consumed",
      token: validResetToken({
        consumed_at: FIXED_NOW,
      }),
    },
    {
      description: "expired",
      token: validResetToken({
        expires_at: new Date("2026-11-15T09:59:59.000Z"),
      }),
    },
  ])("rejects an $description reset token before hashing the password", async ({ token }) => {
    findInitialToken.mockResolvedValue(token);

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(hashPassword).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects a token that expires while the reset transaction is starting", async () => {
    const expiry = new Date(FIXED_NOW.getTime() + 1);

    findInitialToken.mockResolvedValue(
      validResetToken({
        expires_at: expiry,
      }),
    );

    findCurrentToken.mockResolvedValue(
      validResetToken({
        expires_at: expiry,
      }),
    );

    let clockCall = 0;

    const now = () => {
      clockCall += 1;

      return clockCall === 1 ? FIXED_NOW : expiry;
    };

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(lockUserRow).toHaveBeenCalledOnce();
    expect(findCurrentToken).toHaveBeenCalledOnce();
    expect(updateResetTokens).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("rejects the reset when the user row cannot be locked", async () => {
    lockUserRow.mockResolvedValue([]);

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(findCurrentToken).not.toHaveBeenCalled();
    expect(updateResetTokens).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("rejects a token that another request has already consumed", async () => {
    findCurrentToken.mockResolvedValue(
      validResetToken({
        consumed_at: FIXED_NOW,
      }),
    );

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(updateResetTokens).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("rejects a reset if the token record no longer matches the supplied token hash", async () => {
    findCurrentToken.mockResolvedValue(
      validResetToken({
        token_hash: "a".repeat(64),
      }),
    );

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(updateResetTokens).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("rejects the reset when the atomic token-consumption update affects no record", async () => {
    updateResetTokens.mockReset().mockResolvedValueOnce({ count: 0 });

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(updateUser).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("rejects the reset when the account is no longer active and verified", async () => {
    updateUser.mockResolvedValue({ count: 0 });

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(updateUser).toHaveBeenCalledOnce();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("does not open a database transaction when password hashing fails", async () => {
    vi.mocked(hashPassword).mockRejectedValueOnce(new Error("Password policy violation"));

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "weak",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toThrow("Password policy violation");

    expect(runTransaction).not.toHaveBeenCalled();
    expect(lockUserRow).not.toHaveBeenCalled();
  });

  it("propagates database transaction failures", async () => {
    runTransaction.mockRejectedValueOnce(new Error("Database unavailable"));

    await expect(
      resetPassword(
        {
          token: RAW_RESET_TOKEN,
          newPassword: "A-Strong-New-Password-2026",
        },
        {
          prisma: prismaMock,
          now: () => FIXED_NOW,
        },
      ),
    ).rejects.toThrow("Database unavailable");

    expect(hashPassword).toHaveBeenCalledOnce();
    expect(runTransaction).toHaveBeenCalledOnce();
  });
});
