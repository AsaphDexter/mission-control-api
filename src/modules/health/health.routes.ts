import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";

const healthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
});

const readinessResponseSchema = Type.Object({
  status: Type.Literal("ready"),
  checks: Type.Object({
    application: Type.Literal("ready"),
    database: Type.Literal("ready"),
  }),
});

const readinessFailureSchema = Type.Object({
  status: Type.Literal("not_ready"),
  checks: Type.Object({
    application: Type.Literal("ready"),
    database: Type.Literal("unavailable"),
  }),
});

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      status: "ok" as const,
    }),
  );

  app.get(
    "/ready",
    {
      schema: {
        response: {
          200: readinessResponseSchema,
          503: readinessFailureSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;

        return {
          status: "ready" as const,
          checks: {
            application: "ready" as const,
            database: "ready" as const,
          },
        };
      } catch (error) {
        app.log.error({ err: error }, "Database readiness check failed.");

        return reply.code(503).send({
          status: "not_ready" as const,
          checks: {
            application: "ready" as const,
            database: "unavailable" as const,
          },
        });
      }
    },
  );
};
