import type { PrismaClient } from "../../generated/prisma/client.js";

import { hashOpaqueToken } from "./security/opaque-token.js";

export interface LogoutInput {
  refreshToken: string;
}

export interface LogoutDependencies {
  prisma: PrismaClient;
  now?: () => Date;
}

export class LogoutSessionNotFoundError extends Error {
  constructor() {
    super("The refresh-token session was not found.");
    this.name = "LogoutSessionNotFoundError";
  }
}

export async function logoutSession(
  userId: string,
  input: LogoutInput,
  dependencies: LogoutDependencies,
): Promise<void> {
  const { prisma } = dependencies;
  const currentTime = (dependencies.now ?? (() => new Date()))();
  const tokenHash = hashOpaqueToken(input.refreshToken);

  const sessionFound = await prisma.$transaction(async (transaction) => {
    // Serialise refresh and logout operations belonging to this account.
    const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "users"
      WHERE "id" = ${userId}::uuid
      FOR UPDATE
    `;

    if (lockedUsers.length !== 1) {
      return false;
    }

    // Scope the token lookup to the authenticated account.
    const storedToken = await transaction.refreshToken.findFirst({
      where: {
        token_hash: tokenHash,
        user_id: userId,
      },
      select: {
        family_id: true,
      },
    });

    if (!storedToken) {
      return false;
    }

    // Revoke every active token in this session family.
    await transaction.refreshToken.updateMany({
      where: {
        user_id: userId,
        family_id: storedToken.family_id,
        revoked_at: null,
      },
      data: {
        revoked_at: currentTime,
      },
    });

    return true;
  });

  if (!sessionFound) {
    throw new LogoutSessionNotFoundError();
  }
}
