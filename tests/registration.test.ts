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

const findUser = vi.fn();
const findRole = vi.fn();
const createUser = vi.fn();
const createVerificationToken = vi.fn();
const disconnect = vi.fn();

const transactionClient = {
  role: { findUnique: findRole },
  user: { create: createUser },
  emailVerificationToken: {
    create: createVerificationToken,
  },
};

const runTransaction = vi.fn(
  async (
    callback: (transaction: typeof transactionClient) => Promise<unknown>,
  ) => callback(transactionClient),
);

const prismaMock = {
  user: { findUnique: findUser },
  $transaction: runTransaction,
  $disconnect: disconnect,
} as unknown as PrismaClient;

const registrationPayload = {
  firstName: "Amina",
  lastName: "Okafor",
  email: "AMINA@example.com",
  password: "VeryStrongPassword123!",
  displayName: "Amina",
};

const createdUser = {
  id: "8e1c9c0a-3d24-4a77-a1b3-123456789abc",
  email: "amina@example.com",
  first_name: "Amina",
  last_name: "Okafor",
  display_name: "Amina",
  status: "PENDING_VERIFICATION",
  email_verified_at: null,
  created_at: new Date("2026-11-09T10:00:00.000Z"),
  user_roles: [
    {
      role: {
        code: "LEARNER",
      },
    },
  ],
};

describe("POST /api/v1/auth/register", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    findUser.mockReset().mockResolvedValue(null);
    findRole.mockReset().mockResolvedValue({ id: "learner-role-id" });
    createUser.mockReset().mockResolvedValue(createdUser);
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

  it("creates a pending learner account and returns 201", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: registrationPayload,
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();

    expect(body.data.user).toMatchObject({
      id: createdUser.id,
      email: "amina@example.com",
      firstName: "Amina",
      lastName: "Okafor",
      displayName: "Amina",
      status: "PENDING_VERIFICATION",
      emailVerified: false,
      roles: ["LEARNER"],
    });

    expect(body.data.emailVerificationRequired).toBe(true);
    expect(body.meta.requestId).toBeTruthy();

    expect(body.data.user).not.toHaveProperty("password_hash");
    expect(body.data.user).not.toHaveProperty("verificationToken");

    expect(findUser).toHaveBeenCalledWith({
      where: { email: "amina@example.com" },
      select: { id: true },
    });

    expect(createVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: createdUser.id,
          token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          expires_at: expect.any(Date),
        }),
      }),
    );
  });

  it("returns 409 when the email address is already registered", async () => {
    findUser.mockResolvedValue({
      id: "existing-user-id",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: registrationPayload,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when the registration request is invalid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        firstName: "Amina",
        email: "not-an-email",
        password: "short",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(findUser).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });
});