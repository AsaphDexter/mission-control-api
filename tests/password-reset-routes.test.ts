import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";

import {
  requestPasswordReset,
  type PasswordResetEmailMessage,
} from "../src/modules/auth/password-reset-request.service.js";

import {
  InvalidPasswordResetTokenError,
  resetPassword,
} from "../src/modules/auth/password-reset.service.js";

import { PasswordPolicyError } from "../src/modules/auth/security/password.js";

vi.mock("../src/modules/auth/password-reset-request.service.js", () => ({
  requestPasswordReset: vi.fn(),
}));

vi.mock("../src/modules/auth/password-reset.service.js", () => ({
  InvalidPasswordResetTokenError: class InvalidPasswordResetTokenError extends Error {
    constructor() {
      super("The password-reset token is invalid, expired or has already been used.");
      this.name = "InvalidPasswordResetTokenError";
    }
  },
  resetPassword: vi.fn(),
}));

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const VALID_RESET_TOKEN = "R".repeat(43);
const VALID_NEW_PASSWORD = "New-Strong-Password-2026!";

const queryRaw = vi.fn().mockResolvedValue([{ result: 1 }]);
const disconnect = vi.fn().mockResolvedValue(undefined);

const prismaMock = {
  $queryRaw: queryRaw,
  $disconnect: disconnect,
} as unknown as PrismaClient;

const mockRequestPasswordReset = vi.mocked(requestPasswordReset);
const mockResetPassword = vi.mocked(resetPassword);

const sendPasswordResetEmail = vi.fn(async (message: PasswordResetEmailMessage) => {
  void message;
});

describe("Password recovery HTTP routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockRequestPasswordReset.mockReset().mockResolvedValue({
      delivery: "sent",
      userId: TEST_USER_ID,
    });

    mockResetPassword.mockReset().mockResolvedValue(undefined);

    queryRaw.mockReset().mockResolvedValue([{ result: 1 }]);
    disconnect.mockReset().mockResolvedValue(undefined);
    sendPasswordResetEmail.mockReset().mockImplementation(async (message) => {
      void message;
    });

    app = buildApp({
      logger: false,
      prisma: prismaMock,
      sendPasswordResetEmail,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/v1/auth/forgot-password", () => {
    it("accepts a valid email and returns HTTP 202", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "amina@example.com",
        },
      });

      expect(response.statusCode).toBe(202);

      expect(response.json()).toMatchObject({
        data: {
          message: "If the address is eligible, password reset instructions will be sent.",
        },
        meta: {
          requestId: expect.any(String),
        },
      });

      expect(mockRequestPasswordReset).toHaveBeenCalledWith("amina@example.com", {
        prisma: prismaMock,
        sendPasswordResetEmail,
      });
    });

    it("accepts email addresses with uppercase characters", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "AMINA@EXAMPLE.COM",
        },
      });

      expect(response.statusCode).toBe(202);

      expect(mockRequestPasswordReset).toHaveBeenCalledWith(
        "AMINA@EXAMPLE.COM",
        expect.objectContaining({
          prisma: prismaMock,
        }),
      );
    });

    it("returns the same public response for eligible and ineligible accounts", async () => {
      mockRequestPasswordReset
        .mockResolvedValueOnce({
          delivery: "sent",
          userId: TEST_USER_ID,
        })
        .mockResolvedValueOnce({
          delivery: "not_eligible",
        });

      const eligibleResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "amina@example.com",
        },
      });

      const ineligibleResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "unknown@example.com",
        },
      });

      expect(eligibleResponse.statusCode).toBe(202);
      expect(ineligibleResponse.statusCode).toBe(202);

      expect(eligibleResponse.json().data).toStrictEqual(ineligibleResponse.json().data);
    });

    it("returns HTTP 202 when email delivery fails", async () => {
      mockRequestPasswordReset.mockResolvedValue({
        delivery: "failed",
        userId: TEST_USER_ID,
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "amina@example.com",
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().data.message).toContain("If the address is eligible");
    });

    it("returns HTTP 202 when email delivery is not configured", async () => {
      await app.close();

      app = buildApp({
        logger: false,
        prisma: prismaMock,
      });

      mockRequestPasswordReset.mockResolvedValue({
        delivery: "not_configured",
        userId: TEST_USER_ID,
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "amina@example.com",
        },
      });

      expect(response.statusCode).toBe(202);

      expect(mockRequestPasswordReset).toHaveBeenCalledWith("amina@example.com", {
        prisma: prismaMock,
      });

      expect(response.json().data.message).toContain("If the address is eligible");
    });

    it.each([
      {
        description: "an invalid email address",
        payload: { email: "not-an-email" },
      },
      {
        description: "a missing email address",
        payload: {},
      },
      {
        description: "an empty email address",
        payload: { email: "" },
      },
      {
        description: "an unexpected request property",
        payload: {
          email: "amina@example.com",
          userId: TEST_USER_ID,
        },
      },
    ])("rejects $description with HTTP 400", async ({ payload }) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");

      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    });

    it("returns HTTP 500 when password reset request processing fails", async () => {
      mockRequestPasswordReset.mockRejectedValue(new Error("Database unavailable"));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "amina@example.com",
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("returns HTTP 429 after five requests within the rate-limit window", async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/auth/forgot-password",
          payload: {
            email: "amina@example.com",
          },
        });

        expect(response.statusCode).toBe(202);
      }

      const limitedResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: {
          email: "amina@example.com",
        },
      });

      expect(limitedResponse.statusCode).toBe(429);
      expect(limitedResponse.json()).toMatchObject({
        statusCode: 429,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later.",
        },
      });

      expect(mockRequestPasswordReset).toHaveBeenCalledTimes(5);

      // The reset endpoint has its own independent rate limit.
      const resetResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
      });

      expect(resetResponse.statusCode).toBe(200);
    });
  });

  describe("POST /api/v1/auth/reset-password", () => {
    it("resets the password and returns HTTP 200", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toMatchObject({
        data: {
          message: "Your password has been reset successfully. Please sign in again.",
        },
        meta: {
          requestId: expect.any(String),
        },
      });

      expect(mockResetPassword).toHaveBeenCalledWith(
        {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
        {
          prisma: prismaMock,
        },
      );
    });

    it("rejects an invalid or expired reset token with HTTP 400", async () => {
      mockResetPassword.mockRejectedValue(new InvalidPasswordResetTokenError());

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_PASSWORD_RESET_TOKEN");
    });

    it("returns HTTP 400 when the password policy rejects the new password", async () => {
      mockResetPassword.mockRejectedValue(new PasswordPolicyError());

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });

    it.each([
      {
        description: "a missing token",
        payload: {
          newPassword: VALID_NEW_PASSWORD,
        },
      },
      {
        description: "a malformed token",
        payload: {
          token: "invalid-token",
          newPassword: VALID_NEW_PASSWORD,
        },
      },
      {
        description: "a short password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: "short",
        },
      },
      {
        description: "a missing new password",
        payload: {
          token: VALID_RESET_TOKEN,
        },
      },
      {
        description: "an unexpected request property",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
          userId: TEST_USER_ID,
        },
      },
    ])("rejects $description with HTTP 400", async ({ payload }) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");

      expect(mockResetPassword).not.toHaveBeenCalled();
    });

    it("returns HTTP 500 when password reset processing fails unexpectedly", async () => {
      mockResetPassword.mockRejectedValue(new Error("Database unavailable"));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("returns HTTP 429 after ten requests within the rate-limit window", async () => {
      for (let attempt = 1; attempt <= 10; attempt++) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/auth/reset-password",
          payload: {
            token: VALID_RESET_TOKEN,
            newPassword: VALID_NEW_PASSWORD,
          },
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: VALID_RESET_TOKEN,
          newPassword: VALID_NEW_PASSWORD,
        },
      });

      expect(limitedResponse.statusCode).toBe(429);
      expect(limitedResponse.json()).toMatchObject({
        statusCode: 429,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later.",
        },
      });

      expect(mockResetPassword).toHaveBeenCalledTimes(10);
    });
  });
});
