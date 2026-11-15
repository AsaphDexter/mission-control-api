import type { PrismaClient } from "../../generated/prisma/client.js";

import { hashPassword } from "./security/password.js";
import { hashOpaqueToken } from "./security/opaque-token.js";

export interface PasswordResetInput {
  token: string;
  newPassword: string;
}

export interface PasswordResetDependencies {
  prisma: PrismaClient;
  now?: () => Date;
}

export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super("The password-reset token is invalid, expired or has already been used.");
    this.name = "InvalidPasswordResetTokenError";
  }
}

export async function resetPassword(
  input: PasswordResetInput,
  dependencies: PasswordResetDependencies,
): Promise<void> {
  const { prisma } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const tokenHash = hashOpaqueToken(input.token);

  // Check the token before performing the relatively expensive Argon2 hash.
  const initialToken = await prisma.passwordResetToken.findUnique({
    where: {
      token_hash: tokenHash,
    },
    select: {
      id: true,
      user_id: true,
      expires_at: true,
      consumed_at: true,
    },
  });

  if (
    !initialToken ||
    initialToken.consumed_at !== null ||
    initialToken.expires_at.getTime() <= now().getTime()
  ) {
    throw new InvalidPasswordResetTokenError();
  }

  // Validate and hash the new password before opening the transaction.
  const newPasswordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (transaction) => {
    // Use the same account-row lock as login, refresh and logout.
    const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "users"
      WHERE "id" = ${initialToken.user_id}::uuid
      FOR UPDATE
    `;

    if (lockedUsers.length !== 1) {
      throw new InvalidPasswordResetTokenError();
    }

    const currentTime = now();

    // Re-read the token after acquiring the user lock. This prevents two
    // concurrent requests from successfully consuming the same reset token.
    const currentToken = await transaction.passwordResetToken.findUnique({
      where: {
        id: initialToken.id,
      },
      select: {
        id: true,
        user_id: true,
        token_hash: true,
        expires_at: true,
        consumed_at: true,
      },
    });

    if (
      !currentToken ||
      currentToken.user_id !== initialToken.user_id ||
      currentToken.token_hash !== tokenHash ||
      currentToken.consumed_at !== null ||
      currentToken.expires_at.getTime() <= currentTime.getTime()
    ) {
      throw new InvalidPasswordResetTokenError();
    }

    // Atomically claim the reset token. Exactly one request may consume it.
    const consumedToken = await transaction.passwordResetToken.updateMany({
      where: {
        id: currentToken.id,
        user_id: currentToken.user_id,
        token_hash: tokenHash,
        consumed_at: null,
        expires_at: {
          gt: currentTime,
        },
      },
      data: {
        consumed_at: currentTime,
      },
    });

    if (consumedToken.count !== 1) {
      throw new InvalidPasswordResetTokenError();
    }

    // Only active, verified accounts may complete a password reset.
    const updatedUser = await transaction.user.updateMany({
      where: {
        id: currentToken.user_id,
        status: "ACTIVE",
        email_verified_at: {
          not: null,
        },
      },
      data: {
        password_hash: newPasswordHash,
        auth_version: {
          increment: 1,
        },
      },
    });

    if (updatedUser.count !== 1) {
      throw new InvalidPasswordResetTokenError();
    }

    // Invalidate every other outstanding password-reset token.
    await transaction.passwordResetToken.updateMany({
      where: {
        user_id: currentToken.user_id,
        consumed_at: null,
      },
      data: {
        consumed_at: currentTime,
      },
    });

    // Explicitly revoke all device sessions. Incrementing auth_version
    // also provides account-wide invalidation at the JWT and refresh layers.
    await transaction.refreshToken.updateMany({
      where: {
        user_id: currentToken.user_id,
        revoked_at: null,
      },
      data: {
        revoked_at: currentTime,
      },
    });
  });
}
