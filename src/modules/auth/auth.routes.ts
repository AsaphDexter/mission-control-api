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

function errorResponse(
  requestId: string,
  code: string,
  message: string,
) {
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
                  enum: [
                    "PENDING_VERIFICATION",
                    "ACTIVE",
                    "SUSPENDED",
                    "DEACTIVATED",
                  ],
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

export async function authRoutes(
  app: FastifyInstance,
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
        return reply.code(400).send(
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
            emailVerificationRequired:
              result.emailVerificationRequired,
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof EmailAlreadyRegisteredError) {
          return reply.code(409).send(
            errorResponse(
              request.id,
              "EMAIL_ALREADY_REGISTERED",
              error.message,
            ),
          );
        }

        if (error instanceof LearnerRoleNotConfiguredError) {
          request.log.error({ err: error }, "Registration role is missing.");

          return reply.code(503).send(
            errorResponse(
              request.id,
              "SERVICE_UNAVAILABLE",
              "Registration is temporarily unavailable. Please try again later.",
            ),
          );
        }

        request.log.error({ err: error }, "Registration failed.");

        return reply.code(500).send(
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
      const token = (
        request.body as { token?: unknown } | undefined
      )?.token;

      if (
        request.validationError ||
        typeof token !== "string" ||
        token.length < 32 ||
        token.length > 512
      ) {
        return reply.code(400).send(
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
            message:
              "Email address verified successfully. Your account is now active.",
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        if (error instanceof VerificationTokenNotFoundError) {
          return reply.code(404).send(
            errorResponse(
              request.id,
              "VERIFICATION_TOKEN_NOT_FOUND",
              error.message,
            ),
          );
        }

        if (error instanceof VerificationTokenConflictError) {
          return reply.code(409).send(
            errorResponse(
              request.id,
              "VERIFICATION_TOKEN_CONFLICT",
              error.message,
            ),
          );
        }

        request.log.error({ err: error }, "Email verification failed.");

        return reply.code(500).send(
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
    const email = (
      request.body as { email?: unknown } | undefined
    )?.email;

    if (
      request.validationError ||
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return reply.code(400).send(
        errorResponse(
          request.id,
          "VALIDATION_ERROR",
          "A valid email address is required.",
        ),
      );
    }

    try {
      const result = await resendVerificationEmail(email, {
        prisma: app.prisma,
      });

      if (
        result.delivery === "failed" ||
        result.delivery === "not_configured"
      ) {
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
      request.log.error(
        { err: error },
        "Resending email verification failed.",
      );

      return reply.code(500).send(
        errorResponse(
          request.id,
          "INTERNAL_SERVER_ERROR",
          "An unexpected error occurred while processing the request.",
        ),
      );
    }
  },
);
}