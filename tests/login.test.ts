import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";
import {
  hashPassword,
} from "../src/modules/auth/security/password.js";
import {
  verifyAccessToken,
} from "../src/modules/auth/security/access-token.js";

const LOGIN_PASSWORD = "CorrectHorseBatteryStaple_2026!";
const LOGIN_EMAIL = "amina@example.com";

const findUser = vi.fn();
const updateLastLogin = vi.fn();
const createRefreshToken = vi.fn();
const disconnect = vi.fn();

const transactionClient = {
  user: {
    updateMany: updateLastLogin,
  },
  refreshToken: {
    create: createRefreshToken,
  },
};

const runTransaction = vi.fn(
  async (
    callback: (transaction: typeof transactionClient) => Promise<unknown>,
  ) => callback(transactionClient),
);

const prismaMock = {
  user: {
    findUnique: findUser,
  },
  $transaction: runTransaction,
  $disconnect: disconnect,
} as unknown as PrismaClient;

const activeUser = {
  id: "8e1c9c0a-3d24-4a77-a1b3-123456789abc",
  email: LOGIN_EMAIL,
  password_hash: "",
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
};

let previousJwtSecret: string | undefined;

describe("POST /api/v1/auth/login", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    previousJwtSecret = process.env.JWT_ACCESS_SECRET;

    process.env.JWT_ACCESS_SECRET = Buffer.alloc(
      32,
      0x42,
    ).toString("base64url");

    activeUser.password_hash = await hashPassword(LOGIN_PASSWORD);
  });

  afterAll(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = previousJwtSecret;
    }
  });

  beforeEach(() => {
    findUser.mockReset().mockResolvedValue(activeUser);

    updateLastLogin.mockReset().mockResolvedValue({
      count: 1,
    });

    createRefreshToken.mockReset().mockResolvedValue({
      id: "refresh-token-id",
    });

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

  it("authenticates an active user and creates a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: LOGIN_EMAIL.toUpperCase(),
        password: LOGIN_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.data).toMatchObject({
      tokenType: "Bearer",
      expiresIn: 900,
      refreshTokenExpiresIn: 604800,
      user: {
        id: activeUser.id,
        email: LOGIN_EMAIL,
        firstName: "Amina",
        lastName: "Okafor",
        status: "ACTIVE",
        emailVerified: true,
        roles: ["LEARNER"],
      },
    });

    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.meta.requestId).toBeTruthy();

    // Verify the JWT signature and claims.
    const claims = await verifyAccessToken(body.data.accessToken);

    expect(claims.userId).toBe(activeUser.id);
    expect(claims.authVersion).toBe(1);

    // Confirm the refresh-token hash, not the raw token, is persisted.
    const savedSession = createRefreshToken.mock.calls[0]?.[0];

    expect(savedSession.data.token_hash).toBe(
      hashOpaqueToken(body.data.refreshToken),
    );

    expect(savedSession.data.token_hash).not.toBe(
      body.data.refreshToken,
    );

    expect(savedSession.data.family_id).toBeTruthy();
    expect(savedSession.data.auth_version_at_issue).toBe(1);
    expect(savedSession.data.expires_at).toBeInstanceOf(Date);

    expect(updateLastLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: activeUser.id,
          status: "ACTIVE",
          auth_version: 1,
        }),
      }),
    );
  });

  it("rejects an incorrect password with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: LOGIN_EMAIL,
        password: "WrongPassword123!",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(response.json().error.message).toBe(
      "Email or password is incorrect.",
    );

    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown email with the same generic error", async () => {
    findUser.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "unknown@example.com",
        password: LOGIN_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(response.json().error.message).toBe(
      "Email or password is incorrect.",
    );

    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects an account that has not verified its email", async () => {
    findUser.mockResolvedValue({
      ...activeUser,
      status: "PENDING_VERIFICATION",
      email_verified_at: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects a suspended account", async () => {
    findUser.mockResolvedValue({
      ...activeUser,
      status: "SUSPENDED",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid login request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: LOGIN_EMAIL,
        password: "",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(findUser).not.toHaveBeenCalled();
  });

  it("rejects session creation when the account changes during login", async () => {
    updateLastLogin.mockResolvedValue({
      count: 0,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(createRefreshToken).not.toHaveBeenCalled();
  });
});