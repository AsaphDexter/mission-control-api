import type { PrismaClient } from "../../generated/prisma/client.js";
import { type VerificationEmailSender } from "./registration.service.js";
import { generateOpaqueToken, hashOpaqueToken } from "./security/opaque-token.js";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface ResendVerificationDependencies {
  prisma: PrismaClient;
  sendVerificationEmail?: VerificationEmailSender;
  now?: () => Date;
}

export type ResendVerificationResult =
  | { delivery: "not_eligible" }
  | {
      delivery: "sent" | "not_configured" | "failed";
      userId: string;
    };

export async function resendVerificationEmail(
  emailAddress: string,
  dependencies: ResendVerificationDependencies,
): Promise<ResendVerificationResult> {
  const { prisma, sendVerificationEmail } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const currentTime = now();
  const email = emailAddress.trim().toLowerCase();

  const pendingVerification = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        first_name: true,
        status: true,
        email_verified_at: true,
      },
    });

    if (!user || user.status !== "PENDING_VERIFICATION" || user.email_verified_at !== null) {
      return null;
    }

    // Invalidate any previous unused verification tokens.
    await transaction.emailVerificationToken.updateMany({
      where: {
        user_id: user.id,
        consumed_at: null,
      },
      data: {
        consumed_at: currentTime,
      },
    });

    const token = generateOpaqueToken();

    await transaction.emailVerificationToken.create({
      data: {
        user_id: user.id,
        token_hash: hashOpaqueToken(token),
        expires_at: new Date(currentTime.getTime() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    return {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      token,
    };
  });

  if (!pendingVerification) {
    return { delivery: "not_eligible" };
  }

  if (!sendVerificationEmail) {
    return {
      delivery: "not_configured",
      userId: pendingVerification.userId,
    };
  }

  try {
    // Email delivery takes place only after the transaction commits.
    await sendVerificationEmail({
      email: pendingVerification.email,
      firstName: pendingVerification.firstName,
      token: pendingVerification.token,
    });

    return {
      delivery: "sent",
      userId: pendingVerification.userId,
    };
  } catch {
    // Keep the account and verification token. A later resend can retry.
    return {
      delivery: "failed",
      userId: pendingVerification.userId,
    };
  }
}
