import type { PrismaClient } from "../../generated/prisma/client.js";
import { hashOpaqueToken } from "./security/opaque-token.js";

export interface EmailVerificationDependencies {
  prisma: PrismaClient;
  now?: () => Date;
}

export class VerificationTokenNotFoundError extends Error {
  constructor() {
    super("The email verification token was not found.");
    this.name = "VerificationTokenNotFoundError";
  }
}

export class VerificationTokenConflictError extends Error {
  constructor() {
    super("The email verification token is expired or has already been used.");
    this.name = "VerificationTokenConflictError";
  }
}

export async function verifyEmailAddress(
  token: string,
  dependencies: EmailVerificationDependencies,
): Promise<void> {
  const currentTime = (dependencies.now ?? (() => new Date()))();
  const tokenHash = hashOpaqueToken(token);

  await dependencies.prisma.$transaction(async (transaction) => {
    const storedToken = await transaction.emailVerificationToken.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        user_id: true,
        expires_at: true,
        consumed_at: true,
        user: {
          select: {
            status: true,
            email_verified_at: true,
          },
        },
      },
    });

    if (!storedToken) {
      throw new VerificationTokenNotFoundError();
    }

    if (
      storedToken.consumed_at !== null ||
      storedToken.expires_at.getTime() <= currentTime.getTime() ||
      storedToken.user.status !== "PENDING_VERIFICATION" ||
      storedToken.user.email_verified_at !== null
    ) {
      throw new VerificationTokenConflictError();
    }

    const consumedToken = await transaction.emailVerificationToken.updateMany({
      where: {
        id: storedToken.id,
        consumed_at: null,
        expires_at: { gt: currentTime },
      },
      data: {
        consumed_at: currentTime,
      },
    });

    if (consumedToken.count !== 1) {
      throw new VerificationTokenConflictError();
    }

    const activatedUser = await transaction.user.updateMany({
      where: {
        id: storedToken.user_id,
        status: "PENDING_VERIFICATION",
        email_verified_at: null,
      },
      data: {
        status: "ACTIVE",
        email_verified_at: currentTime,
      },
    });

    if (activatedUser.count !== 1) {
      throw new VerificationTokenConflictError();
    }
  });
}
