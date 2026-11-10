import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { resendVerificationEmail } from "../src/modules/auth/resend-verification.service.js";
import type { VerificationEmailMessage } from "../src/modules/auth/registration.service.js";

const pendingUser = {
  id: "test-user-id",
  email: "amina@example.com",
  first_name: "Amina",
  status: "PENDING_VERIFICATION",
  email_verified_at: null,
};

const findUser = vi.fn(
  async (args: unknown): Promise<typeof pendingUser | null> => {
    void args;
    return pendingUser;
  },
);

const invalidateOldTokens = vi.fn(
  async (args: unknown) => {
    void args;
    return { count: 1 };
  },
);
const createVerificationToken = vi.fn(
  async (
    args: {
      data: {
        user_id: string;
        token_hash: string;
        expires_at: Date;
      };
    },
  ) => {
    void args;
    return {};
  },
);

const disconnect = vi.fn(async () => undefined);

const transactionClient = {
  user: {
    findUnique: findUser,
  },
  emailVerificationToken: {
    updateMany: invalidateOldTokens,
    create: createVerificationToken,
  },
};

const runTransaction = vi.fn(
  async (
    callback: (transaction: typeof transactionClient) => Promise<unknown>,
  ) => callback(transactionClient),
);

const prismaMock = {
  $transaction: runTransaction,
  $disconnect: disconnect,
} as unknown as PrismaClient;

describe("POST /api/v1/auth/resend-verification", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    findUser.mockReset().mockResolvedValue(pendingUser);

    invalidateOldTokens.mockReset().mockResolvedValue({ count: 1 });

    createVerificationToken.mockReset().mockResolvedValue({});

    disconnect.mockReset().mockResolvedValue(undefined);

    runTransaction.mockReset().mockImplementation(
      async (callback) => callback(transactionClient),
    );

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a fresh token and invalidates previous unused tokens", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: {
        email: "AMINA@example.com",
      },
    });

    expect(response.statusCode).toBe(202);

    expect(response.json().data.message).toContain(
      "If the address is eligible",
    );

    expect(findUser).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: "amina@example.com",
        },
      }),
    );

    expect(invalidateOldTokens).toHaveBeenCalledWith({
      where: {
        user_id: pendingUser.id,
        consumed_at: null,
      },
      data: {
        consumed_at: expect.any(Date),
      },
    });

    expect(createVerificationToken).toHaveBeenCalledWith({
      data: {
        user_id: pendingUser.id,
        token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expires_at: expect.any(Date),
      },
    });

    const savedToken =
      createVerificationToken.mock.calls[0]?.[0];

    expect(savedToken?.data.expires_at.getTime()).toBeGreaterThan(
      Date.now() + (24 * 60 * 60 * 1000) - 5000,
    );
  });

  it("returns the same public response for unknown, verified and pending accounts", async () => {
    const responses = [];

    // Pending account.
    findUser.mockResolvedValue(pendingUser);

    const pendingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: { email: "amina@example.com" },
    });

    responses.push(pendingResponse.json().data);

    // Unknown account.
    findUser.mockResolvedValue(null);

    const unknownResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: { email: "unknown@example.com" },
    });

    responses.push(unknownResponse.json().data);

    // Already verified account.
    findUser.mockResolvedValue({
      ...pendingUser,
      status: "ACTIVE",
      email_verified_at: new Date(),
    });

    const verifiedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: { email: "verified@example.com" },
    });

    responses.push(verifiedResponse.json().data);

    expect(pendingResponse.statusCode).toBe(202);
    expect(unknownResponse.statusCode).toBe(202);
    expect(verifiedResponse.statusCode).toBe(202);

    expect(responses[0]).toEqual(responses[1]);
    expect(responses[1]).toEqual(responses[2]);
  });

  it("returns 400 for an invalid email address", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: {
        email: "not-an-email",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe("resendVerificationEmail service", () => {
  it("does not fail account processing when email delivery fails", async () => {
    let transactionCommitted = false;

    findUser.mockReset().mockResolvedValue(pendingUser);
    invalidateOldTokens.mockReset().mockResolvedValue({ count: 1 });
    createVerificationToken.mockReset().mockResolvedValue({});

    runTransaction.mockReset().mockImplementation(async (callback) => {
      const result = await callback(transactionClient);
      transactionCommitted = true;
      return result;
    });

const sendVerificationEmail = vi.fn(
  async (message: VerificationEmailMessage) => {
    expect(transactionCommitted).toBe(true);
    expect(message.email).toBe("amina@example.com");
    expect(message.firstName).toBe("Amina");
    expect(message.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    throw new Error("Email provider unavailable");
  },
);

    const result = await resendVerificationEmail(
      "amina@example.com",
      {
        prisma: prismaMock,
        sendVerificationEmail,
      },
    );

    expect(result).toEqual({
      delivery: "failed",
      userId: pendingUser.id,
    });

    expect(transactionCommitted).toBe(true);
    expect(sendVerificationEmail).toHaveBeenCalledOnce();
    expect(createVerificationToken).toHaveBeenCalledOnce();
  });
});