import Fastify, { type FastifyServerOptions } from "fastify";
import type { PrismaClient } from "./generated/prisma/client.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { registerDatabase } from "./plugins/database.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { registerAuthentication } from "./plugins/authentication.plugin.js";

type AppOptions = Pick<FastifyServerOptions, "logger"> & {
  prisma: PrismaClient;
};

export function buildApp(options: AppOptions) {
  const { prisma, ...fastifyOptions } = options;

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

  app.register(healthRoutes);
  app.register(authRoutes);

  return app;
}
