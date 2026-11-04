import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";

const healthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
});

const readinessResponseSchema = Type.Object({
  status: Type.Literal("ready"),
  checks: Type.Object({
    application: Type.Literal("ready"),
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
        },
      },
    },
    async () => ({
      status: "ready" as const,
      checks: {
        application: "ready" as const,
      },
    }),
  );
};
