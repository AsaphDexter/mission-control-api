import type { PrismaClient } from "../../generated/prisma/client.js";
import { generateOpaqueToken, hashOpaqueToken } from "./security/opaque-token.js";

export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface PasswordResetEmailMessage {
  email: string;
  firstName: string;
  token: string;
}

export type PasswordResetEmailSender = (message: PasswordResetEmailMessage) => Promise<void>;

export interface PasswordResetRequestDependencies {
  prisma: PrismaClient;
  sendPasswordResetEmail?: PasswordResetEmailSender;
  now?: () => Date;
}

export type PasswordResetRequestResult =
  | { delivery: "not_eligible" }
  | {
      delivery: "sent" | "not_configured" | "failed";
      userId: string;
    };

export async function requestPasswordReset(
  emailAddress: string,
  dependencies: PasswordResetRequestDependencies,
): Promise<PasswordResetRequestResult> {
  const { prisma, sendPasswordResetEmail } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const email = emailAddress.trim().toLowerCase();

  const resetRequest = await prisma.$transaction(async (transaction) => {
    const candidate = await transaction.user.findUnique({
      where: { email },
      select: {
        id: true,
      },
    });

    if (!candidate) {
      return null;
    }

    // Serialise password-reset requests with login, logout and password changes.
    const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "users"
      WHERE "id" = ${candidate.id}::uuid
      FOR UPDATE
    `;

    if (lockedUsers.length !== 1) {
      return null;
    }

    // Recheck account eligibility after acquiring the row lock.
    const user = await transaction.user.findUnique({
      where: {
        id: candidate.id,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        status: true,
        email_verified_at: true,
      },
    });

    if (!user || user.status !== "ACTIVE" || user.email_verified_at === null) {
      return null;
    }

    const currentTime = now();
    const token = generateOpaqueToken();

    // Invalidate all previously issued, unused reset tokens.
    await transaction.passwordResetToken.updateMany({
      where: {
        user_id: user.id,
        consumed_at: null,
      },
      data: {
        consumed_at: currentTime,
      },
    });

    await transaction.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: hashOpaqueToken(token),
        expires_at: new Date(currentTime.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    return {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      token,
    };
  });

  if (!resetRequest) {
    return { delivery: "not_eligible" };
  }

  if (!sendPasswordResetEmail) {
    return {
      delivery: "not_configured",
      userId: resetRequest.userId,
    };
  }

  try {
    // Send only after the database transaction commits.
    await sendPasswordResetEmail({
      email: resetRequest.email,
      firstName: resetRequest.firstName,
      token: resetRequest.token,
    });

    return {
      delivery: "sent",
      userId: resetRequest.userId,
    };
  } catch {
    // Retain the token so delivery can be retried with a new request.
    return {
      delivery: "failed",
      userId: resetRequest.userId,
    };
  }
}
