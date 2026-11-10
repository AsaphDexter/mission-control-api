import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function registerDatabase(app: FastifyInstance, client: PrismaClient): void {
  app.decorate("prisma", client);

  app.addHook("onClose", async () => {
    await client.$disconnect();
  });
}
