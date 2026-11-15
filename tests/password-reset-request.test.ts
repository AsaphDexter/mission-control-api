import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  requestPasswordReset,
  type PasswordResetEmailMessage,
} from "../src/modules/auth/password-reset-request.service.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const FIXED_NOW = new Date("2026-11-15T10:00:00.000Z");

const findUser = vi.fn();
const lockUserRow = vi.fn();
const invalidatePreviousTokens = vi.fn();
const createResetToken = vi.fn();

let transactionCommitted = false;

const transactionClient = {
  user: {
    findUnique: findUser,
  },
  $queryRaw: lockUserRow,
  passwordResetToken: {
    updateMany: invalidatePreviousTokens,
    create: createResetToken,
  },
};

const runTransaction = vi.fn(
  async (callback: (transaction: typeof transactionClient) => Promise<unknown>) => {
    const result = await callback(transactionClient);
    transactionCommitted = true;
    return result;
  },
);

const prismaMock = {
  $transaction: runTransaction,
} as unknown as PrismaClient;

const activeUser = () => ({
  id: TEST_USER_ID,
  email: "amina@example.com",
  first_name: "Amina",
  status: "ACTIVE",
  email_verified_at: new Date("2026-11-01T10:00:00.000Z"),
});

describe("Password reset request service", () => {
  beforeEach(() => {
    transactionCommitted = false;

    findUser.mockReset();
    findUser.mockResolvedValueOnce({ id: TEST_USER_ID }).mockResolvedValueOnce(activeUser());

    lockUserRow.mockReset().mockResolvedValue([{ id: TEST_USER_ID }]);

    invalidatePreviousTokens.mockReset().mockResolvedValue({ count: 1 });

    createResetToken.mockReset().mockResolvedValue({
      id: "password-reset-token-id",
    });

    runTransaction.mockReset().mockImplementation(async (callback) => {
      const result = await callback(transactionClient);
      transactionCommitted = true;
      return result;
    });
  });

  it("creates a hashed reset token and sends it after the transaction commits", async () => {
    const sendPasswordResetEmail = vi.fn(async (_message: PasswordResetEmailMessage) => {
      expect(transactionCommitted).toBe(true);
    });

    const result = await requestPasswordReset("  AMINA@EXAMPLE.COM  ", {
      prisma: prismaMock,
      sendPasswordResetEmail,
      now: () => FIXED_NOW,
    });

    expect(result).toStrictEqual({
      delivery: "sent",
      userId: TEST_USER_ID,
    });

    expect(findUser).toHaveBeenNthCalledWith(1, {
      where: {
        email: "amina@example.com",
      },
      select: {
        id: true,
      },
    });

    expect(lockUserRow).toHaveBeenCalledOnce();

    expect(invalidatePreviousTokens).toHaveBeenCalledWith({
      where: {
        user_id: TEST_USER_ID,
        consumed_at: null,
      },
      data: {
        consumed_at: FIXED_NOW,
      },
    });

    expect(createResetToken).toHaveBeenCalledOnce();

    const sentMessage = sendPasswordResetEmail.mock.calls[0]?.[0];

    expect(sentMessage).toMatchObject({
      email: "amina@example.com",
      firstName: "Amina",
    });

    expect(sentMessage?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(createResetToken).toHaveBeenCalledWith({
      data: {
        user_id: TEST_USER_ID,
        token_hash: hashOpaqueToken(sentMessage!.token),
        expires_at: new Date(FIXED_NOW.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    // The database stores only the hash, never the raw reset token.
    expect(JSON.stringify(createResetToken.mock.calls)).not.toContain(sentMessage!.token);
  });

  it("returns not_eligible when the email address does not exist", async () => {
    findUser.mockReset().mockResolvedValue(null);

    const sendPasswordResetEmail = vi.fn();

    const result = await requestPasswordReset("unknown@example.com", {
      prisma: prismaMock,
      sendPasswordResetEmail,
      now: () => FIXED_NOW,
    });

    expect(result).toStrictEqual({
      delivery: "not_eligible",
    });

    expect(lockUserRow).not.toHaveBeenCalled();
    expect(invalidatePreviousTokens).not.toHaveBeenCalled();
    expect(createResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not issue a token for an inactive or unverified account", async () => {
    findUser
      .mockReset()
      .mockResolvedValueOnce({ id: TEST_USER_ID })
      .mockResolvedValueOnce({
        ...activeUser(),
        status: "PENDING_VERIFICATION",
        email_verified_at: null,
      });

    const sendPasswordResetEmail = vi.fn();

    const result = await requestPasswordReset("amina@example.com", {
      prisma: prismaMock,
      sendPasswordResetEmail,
      now: () => FIXED_NOW,
    });

    expect(result).toStrictEqual({
      delivery: "not_eligible",
    });

    expect(lockUserRow).toHaveBeenCalledOnce();
    expect(invalidatePreviousTokens).not.toHaveBeenCalled();
    expect(createResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not issue a token when the user row cannot be locked", async () => {
    lockUserRow.mockResolvedValue([]);

    const sendPasswordResetEmail = vi.fn();

    const result = await requestPasswordReset("amina@example.com", {
      prisma: prismaMock,
      sendPasswordResetEmail,
      now: () => FIXED_NOW,
    });

    expect(result).toStrictEqual({
      delivery: "not_eligible",
    });

    expect(invalidatePreviousTokens).not.toHaveBeenCalled();
    expect(createResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("reports not_configured when no email sender is supplied", async () => {
    const result = await requestPasswordReset("amina@example.com", {
      prisma: prismaMock,
      now: () => FIXED_NOW,
    });

    expect(result).toStrictEqual({
      delivery: "not_configured",
      userId: TEST_USER_ID,
    });

    expect(createResetToken).toHaveBeenCalledOnce();
  });

  it("retains the token and reports failed when email delivery fails", async () => {
    const sendPasswordResetEmail = vi
      .fn()
      .mockRejectedValue(new Error("Email provider unavailable"));

    const result = await requestPasswordReset("amina@example.com", {
      prisma: prismaMock,
      sendPasswordResetEmail,
      now: () => FIXED_NOW,
    });

    expect(result).toStrictEqual({
      delivery: "failed",
      userId: TEST_USER_ID,
    });

    expect(createResetToken).toHaveBeenCalledOnce();
    expect(sendPasswordResetEmail).toHaveBeenCalledOnce();
  });
});
