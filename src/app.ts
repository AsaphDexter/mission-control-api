
import Fastify, { type FastifyServerOptions } from "fastify";
import type { PrismaClient } from "./generated/prisma/client.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { registerDatabase } from "./plugins/database.plugin.js";

type AppOptions = Pick<FastifyServerOptions, "logger"> & {
  prisma: PrismaClient;
};

export function buildApp(options: AppOptions) {
  const { prisma, ...fastifyOptions } = options;

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    ...fastifyOptions,
  });

  registerDatabase(app, prisma);
  app.register(healthRoutes);

  return app;
}
