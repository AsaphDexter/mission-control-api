import type { PrismaClient } from "../../generated/prisma/client.js";
import { hashPassword } from "./security/password.js";
import { generateOpaqueToken, hashOpaqueToken } from "./security/opaque-token.js";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface RegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface VerificationEmailMessage {
  email: string;
  firstName: string;
  token: string;
}

export type VerificationEmailSender = (message: VerificationEmailMessage) => Promise<void>;

export interface RegistrationDependencies {
  prisma: PrismaClient;
  sendVerificationEmail?: VerificationEmailSender;
  now?: () => Date;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email address already exists.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class LearnerRoleNotConfiguredError extends Error {
  constructor() {
    super("The LEARNER role has not been configured.");
    this.name = "LearnerRoleNotConfiguredError";
  }
}

export interface RegistrationResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    displayName: string | null;
    status: string;
    emailVerified: boolean;
    createdAt: string;
    roles: string[];
  };
  emailVerificationRequired: true;
  emailDelivery: "sent" | "not_configured" | "failed";
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function registerLearner(
  input: RegistrationInput,
  dependencies: RegistrationDependencies,
): Promise<RegistrationResult> {
  const { prisma, sendVerificationEmail } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const email = input.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new EmailAlreadyRegisteredError();
  }

  const passwordHash = await hashPassword(input.password);
  const verificationToken = generateOpaqueToken();
  const registrationTime = now();

  let createdUser;

  try {
    createdUser = await prisma.$transaction(async (transaction) => {
      const learnerRole = await transaction.role.findUnique({
        where: { code: "LEARNER" },
        select: { id: true },
      });

      if (!learnerRole) {
        throw new LearnerRoleNotConfiguredError();
      }

      const user = await transaction.user.create({
        data: {
          email,
          password_hash: passwordHash,
          first_name: input.firstName,
          last_name: input.lastName,
          display_name: input.displayName ?? null,
          status: "PENDING_VERIFICATION",
          user_roles: {
            create: {
              role: {
                connect: { id: learnerRole.id },
              },
            },
          },
        },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          display_name: true,
          status: true,
          email_verified_at: true,
          created_at: true,
          user_roles: {
            where: { revoked_at: null },
            select: {
              role: {
                select: { code: true },
              },
            },
          },
        },
      });

      await transaction.emailVerificationToken.create({
        data: {
          user_id: user.id,
          token_hash: hashOpaqueToken(verificationToken),
          expires_at: new Date(registrationTime.getTime() + VERIFICATION_TOKEN_TTL_MS),
        },
      });

      return user;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new EmailAlreadyRegisteredError();
    }

    throw error;
  }

  let emailDelivery: RegistrationResult["emailDelivery"] = "not_configured";

  if (sendVerificationEmail) {
    try {
      await sendVerificationEmail({
        email: createdUser.email,
        firstName: createdUser.first_name,
        token: verificationToken,
      });

      emailDelivery = "sent";
    } catch {
      emailDelivery = "failed";
    }
  }

  return {
    user: {
      id: createdUser.id,
      email: createdUser.email,
      firstName: createdUser.first_name,
      lastName: createdUser.last_name,
      displayName: createdUser.display_name,
      status: createdUser.status,
      emailVerified: createdUser.email_verified_at !== null,
      createdAt: createdUser.created_at.toISOString(),
      roles: createdUser.user_roles.map((userRole) => userRole.role.code),
    },
    emailVerificationRequired: true,
    emailDelivery,
  };
}
