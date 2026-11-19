import Fastify, { type FastifyServerOptions } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { PrismaClient } from "./generated/prisma/client.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { registerDatabase } from "./plugins/database.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { registerAuthentication } from "./plugins/authentication.plugin.js";
import type { PasswordResetEmailSender } from "./modules/auth/password-reset-request.service.js";

type AppOptions = Pick<FastifyServerOptions, "logger"> & {
  prisma: PrismaClient;
  sendPasswordResetEmail?: PasswordResetEmailSender;
};

export function buildApp(options: AppOptions) {
  const { prisma, sendPasswordResetEmail, ...fastifyOptions } = options;

  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    ...fastifyOptions,
  });

  registerDatabase(app, prisma);
  registerAuthentication(app);

  // Register rate limiting before routes so route-level limits are applied.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (request, context) => ({
      statusCode: context.statusCode,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        requestId: request.id,
      },
    }),
  });

  app.register(healthRoutes);
  app.register(authRoutes, {
    sendPasswordResetEmail,
  });

  return app;
}
