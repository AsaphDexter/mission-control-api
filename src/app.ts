import Fastify, { type FastifyServerOptions } from "fastify";
import { healthRoutes } from "./modules/health/health.routes.js";

type AppOptions = Pick<FastifyServerOptions, "logger">;

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    ...options,
  });

  app.register(healthRoutes);

  return app;
}
