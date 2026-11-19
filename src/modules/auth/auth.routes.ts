import type { FastifyInstance } from "fastify";
import {
  EmailAlreadyRegisteredError,
  LearnerRoleNotConfiguredError,
  registerLearner,
  type RegistrationInput,
} from "./registration.service.js";

import {
  VerificationTokenConflictError,
  VerificationTokenNotFoundError,
  verifyEmailAddress,
} from "./email-verification.service.js";

import { resendVerificationEmail } from "./resend-verification.service.js";

import {
  requestPasswordReset,
  type PasswordResetEmailSender,
} from "./password-reset-request.service.js";

import { InvalidPasswordResetTokenError, resetPassword } from "./password-reset.service.js";

import { PasswordPolicyError } from "./security/password.js";

import { InvalidCredentialsError, loginUser, type LoginInput } from "./login.service.js";

import {
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
  rotateRefreshToken,
  type RefreshInput,
} from "./refresh.service.js";

import { LogoutSessionNotFoundError, logoutSession, type LogoutInput } from "./logout.service.js";

function errorResponse(requestId: string, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}

const registrationSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["firstName", "lastName", "email", "password"],
    properties: {
      firstName: { type: "string", minLength: 1, maxLength: 100 },
      lastName: { type: "string", minLength: 1, maxLength: 100 },
      email: { type: "string", format: "email", maxLength: 254 },
      password: {
        type: "string",
        format: "password",
        minLength: 12,
        maxLength: 128,
      },
      displayName: { type: "string", maxLength: 100 },
    },
  },
  response: {
    201: {
      type: "object",
      required: ["data", "meta"],
      properties: {
        data: {
          type: "object",
          required: ["user", "emailVerificationRequired"],
          properties: {
            user: {
              type: "object",
              required: [
                "id",
                "email",
                "firstName",
                "lastName",
                "displayName",
                "status",
                "emailVerified",
                "createdAt",
              ],
              properties: {
                id: { type: "string" },
                email: { type: "string" },
                firstName: { type: "string" },
                lastName: { type: "string" },
                displayName: { type: ["string", "null"] },
                status: {
                  type: "string",
                  enum: ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
                },
                emailVerified: { type: "boolean" },
                createdAt: { type: "string" },
                roles: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["LEARNER", "CONTRIBUTOR", "ADMINISTRATOR"],
                  },
                },
              },
            },
            emailVerificationRequired: {
              type: "boolean",
              const: true,
            },
          },
        },
        meta: {
          type: "object",
          properties: {
            requestId: { type: "string" },
          },
        },
      },
    },
  },
} as const;

interface VerifyEmailBody {
  token: string;
}

const verifyEmailSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
      token: { type: "string", minLength: 1 },
    },
  },
  response: {
    200: {
      type: "object",
      required: ["data", "meta"],
      properties: {
        data: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string" },
          },
        },
        meta: {
          type: "object",
          properties: {
            requestId: { type: "string" },
          },
        },
      },
    },
  },
} as const;

interface AuthRoutesOptions {
  sendPasswordResetEmail?: PasswordResetEmailSender;
}

interface ForgotPasswordBody {
  email: string;
}

interface ResetPasswordBody {
  token: string;
  newPassword: string;
}

export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions = {},
): Promise<void> {
  // 1. Existing Registration Route
  app.post<{ Body: RegistrationInput }>(
    "/api/v1/auth/register",
    {
      schema: registrationSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request.id,
              "VALIDATION_ERROR",
              "The registration request contains invalid or missing fields.",
            ),
          );
      }

      try {
        const result = await registerLearner(request.body, {
          prisma: app.prisma,
        });

        if (result.emailDelivery !== "sent") {
          request.log.warn(
            { userId: result.user.id },
            "Account created, but verification email delivery is not complete.",
          );
        }

        return reply.code(201).send({
          data: {
            user: result.user,
            emailVerificationRequired: result.emailVerificationRequired,
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof EmailAlreadyRegisteredError) {
          return reply
            .code(409)
            .send(errorResponse(request.id, "EMAIL_ALREADY_REGISTERED", error.message));
        }

        if (error instanceof LearnerRoleNotConfiguredError) {
          request.log.error({ err: error }, "Registration role is missing.");

          return reply
            .code(503)
            .send(
              errorResponse(
                request.id,
                "SERVICE_UNAVAILABLE",
                "Registration is temporarily unavailable. Please try again later.",
              ),
            );
        }

        request.log.error({ err: error }, "Registration failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while creating the account.",
            ),
          );
      }
    },
  );

  // 2. New Email Verification Route
  app.post<{ Body: VerifyEmailBody }>(
    "/api/v1/auth/verify-email",
    {
      schema: verifyEmailSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      const token = (request.body as { token?: unknown } | undefined)?.token;

      if (
        request.validationError ||
        typeof token !== "string" ||
        token.length < 32 ||
        token.length > 512
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request.id,
              "VALIDATION_ERROR",
              "A valid email verification token is required.",
            ),
          );
      }

      try {
        await verifyEmailAddress(token, {
          prisma: app.prisma,
        });

        return reply.code(200).send({
          data: {
            message: "Email address verified successfully. Your account is now active.",
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof VerificationTokenNotFoundError) {
          return reply
            .code(404)
            .send(errorResponse(request.id, "VERIFICATION_TOKEN_NOT_FOUND", error.message));
        }

        if (error instanceof VerificationTokenConflictError) {
          return reply
            .code(409)
            .send(errorResponse(request.id, "VERIFICATION_TOKEN_CONFLICT", error.message));
        }

        request.log.error({ err: error }, "Email verification failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while verifying the email address.",
            ),
          );
      }
    },
  );

  app.post<{ Body: { email: string } }>(
    "/api/v1/auth/resend-verification",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: {
            email: {
              type: "string",
              format: "email",
              maxLength: 254,
            },
          },
        },
      },
      attachValidation: true,
    },
    async (request, reply) => {
      const email = (request.body as { email?: unknown } | undefined)?.email;

      if (
        request.validationError ||
        typeof email !== "string" ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request.id, "VALIDATION_ERROR", "A valid email address is required."),
          );
      }

      try {
        const result = await resendVerificationEmail(email, {
          prisma: app.prisma,
        });

        if (result.delivery === "failed" || result.delivery === "not_configured") {
          request.log.warn(
            { userId: result.userId, delivery: result.delivery },
            "Verification email was not delivered.",
          );
        }

        // Deliberately identical for registered, unregistered,
        // verified and pending accounts.
        return reply.code(202).send({
          data: {
            message:
              "If the address is eligible for verification, a verification message will be sent.",
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, "Resending email verification failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while processing the request.",
            ),
          );
      }
    },
  );

  app.post<{ Body: ForgotPasswordBody }>(
    "/api/v1/auth/forgot-password",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 15 * 60 * 1000,
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: {
            email: {
              type: "string",
              format: "email",
              maxLength: 254,
            },
          },
        },
      },
      attachValidation: true,
    },
    async (request, reply) => {
      const email = (request.body as { email?: unknown } | undefined)?.email;

      if (request.validationError || typeof email !== "string") {
        return reply
          .code(400)
          .send(
            errorResponse(request.id, "VALIDATION_ERROR", "A valid email address is required."),
          );
      }

      try {
        const result = await requestPasswordReset(email, {
          prisma: app.prisma,
          ...(options.sendPasswordResetEmail
            ? { sendPasswordResetEmail: options.sendPasswordResetEmail }
            : {}),
        });

        if (result.delivery === "failed" || result.delivery === "not_configured") {
          request.log.warn(
            {
              userId: result.userId,
              delivery: result.delivery,
            },
            "Password reset email was not delivered.",
          );
        }

        // Do not disclose whether an account exists or is eligible.
        return reply.code(202).send({
          data: {
            message: "If the address is eligible, password reset instructions will be sent.",
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, "Password reset request failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while processing the request.",
            ),
          );
      }
    },
  );

  app.post<{ Body: ResetPasswordBody }>(
    "/api/v1/auth/reset-password",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 15 * 60 * 1000,
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token", "newPassword"],
          properties: {
            token: {
              type: "string",
              minLength: 43,
              maxLength: 43,
              pattern: "^[A-Za-z0-9_-]{43}$",
            },
            newPassword: {
              type: "string",
              minLength: 12,
              maxLength: 128,
              format: "password",
            },
          },
        },
      },
      attachValidation: true,
    },
    async (request, reply) => {
      const body = request.body as { token?: unknown; newPassword?: unknown } | undefined;

      if (
        request.validationError ||
        typeof body?.token !== "string" ||
        typeof body.newPassword !== "string"
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request.id,
              "VALIDATION_ERROR",
              "A valid reset token and new password are required.",
            ),
          );
      }

      try {
        await resetPassword(
          {
            token: body.token,
            newPassword: body.newPassword,
          },
          {
            prisma: app.prisma,
          },
        );

        return reply.code(200).send({
          data: {
            message: "Your password has been reset successfully. Please sign in again.",
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof InvalidPasswordResetTokenError) {
          return reply
            .code(400)
            .send(
              errorResponse(
                request.id,
                "INVALID_PASSWORD_RESET_TOKEN",
                "The password reset token is invalid, expired or has already been used.",
              ),
            );
        }

        if (error instanceof PasswordPolicyError) {
          return reply.code(400).send(errorResponse(request.id, "VALIDATION_ERROR", error.message));
        }

        request.log.error({ err: error }, "Password reset failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while resetting the password.",
            ),
          );
      }
    },
  );

  app.post<{ Body: LoginInput }>(
    "/api/v1/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: {
            email: {
              type: "string",
              format: "email",
              maxLength: 254,
            },
            password: {
              type: "string",
              minLength: 1,
              maxLength: 128,
            },
          },
        },
      },
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request.id,
              "VALIDATION_ERROR",
              "A valid email address and password are required.",
            ),
          );
      }

      try {
        const result = await loginUser(request.body, {
          prisma: app.prisma,
        });

        return reply.code(200).send({
          data: result,
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return reply
            .code(401)
            .send(
              errorResponse(request.id, "INVALID_CREDENTIALS", "Email or password is incorrect."),
            );
        }

        request.log.error({ err: error }, "Login failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while authenticating.",
            ),
          );
      }
    },
  );

  app.post<{ Body: RefreshInput }>(
    "/api/v1/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["refreshToken"],
          properties: {
            refreshToken: {
              type: "string",
              minLength: 32,
              maxLength: 512,
            },
          },
        },
      },
      attachValidation: true,
    },
    async (request, reply) => {
      const refreshToken = (request.body as { refreshToken?: unknown } | undefined)?.refreshToken;

      if (
        request.validationError ||
        typeof refreshToken !== "string" ||
        refreshToken.length < 32 ||
        refreshToken.length > 512
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request.id, "VALIDATION_ERROR", "A valid refresh token is required."),
          );
      }

      try {
        const result = await rotateRefreshToken({ refreshToken }, { prisma: app.prisma });

        return reply.code(200).send({
          data: result,
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof RefreshTokenReuseError) {
          return reply
            .code(409)
            .send(
              errorResponse(
                request.id,
                "REFRESH_TOKEN_REUSE_DETECTED",
                "The refresh token has already been used. Please authenticate again.",
              ),
            );
        }

        if (error instanceof InvalidRefreshTokenError) {
          return reply
            .code(401)
            .send(
              errorResponse(
                request.id,
                "INVALID_REFRESH_TOKEN",
                "The refresh token is invalid, expired or no longer active.",
              ),
            );
        }

        request.log.error({ err: error }, "Refresh-token rotation failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while refreshing the session.",
            ),
          );
      }
    },
  );

  app.post<{ Body: LogoutInput }>(
    "/api/v1/auth/logout",
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["refreshToken"],
          properties: {
            refreshToken: {
              type: "string",
              minLength: 32,
              maxLength: 512,
            },
          },
        },
      },
      attachValidation: true,
    },
    async (request, reply) => {
      const refreshToken = (request.body as { refreshToken?: unknown } | undefined)?.refreshToken;

      if (
        request.validationError ||
        typeof refreshToken !== "string" ||
        refreshToken.length < 32 ||
        refreshToken.length > 512
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request.id, "VALIDATION_ERROR", "A valid refresh token is required."),
          );
      }

      const authenticatedUser = request.authenticatedUser;

      if (!authenticatedUser) {
        return reply
          .code(401)
          .send(
            errorResponse(
              request.id,
              "UNAUTHENTICATED",
              "A valid bearer access token is required.",
            ),
          );
      }

      try {
        await logoutSession(
          authenticatedUser.id,
          authenticatedUser.sessionId,
          { refreshToken },
          { prisma: app.prisma },
        );

        return reply.code(204).send();
      } catch (error) {
        if (error instanceof LogoutSessionNotFoundError) {
          return reply
            .code(404)
            .send(
              errorResponse(
                request.id,
                "LOGOUT_SESSION_NOT_FOUND",
                "The refresh-token session was not found.",
              ),
            );
        }

        request.log.error({ err: error }, "Logout failed.");

        return reply
          .code(500)
          .send(
            errorResponse(
              request.id,
              "INTERNAL_SERVER_ERROR",
              "An unexpected error occurred while ending the session.",
            ),
          );
      }
    },
  );
}
