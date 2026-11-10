import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../generated/prisma/client.js";

import { createAccessToken, ACCESS_TOKEN_TTL_SECONDS } from "./security/access-token.js";
import { hashPassword, verifyPassword } from "./security/password.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "./security/opaque-token.js";

export const REFRESH_TOKEN_TTL_SECONDS = 604800;

const REFRESH_TOKEN_TTL_MS =
  REFRESH_TOKEN_TTL_SECONDS * 1000;

// Used to perform an Argon2 verification even when an email
// address does not belong to an existing account.
const DUMMY_PASSWORD_HASH = hashPassword(
  "MissionControlDummyCredential_Only_2026",
);

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginDependencies {
  prisma: PrismaClient;
  now?: () => Date;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export interface LoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
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
}

export async function loginUser(
  input: LoginInput,
  dependencies: LoginDependencies,
): Promise<LoginResult> {
  const { prisma } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password_hash: true,
      first_name: true,
      last_name: true,
      display_name: true,
      status: true,
      auth_version: true,
      email_verified_at: true,
      created_at: true,
      user_roles: {
        where: {
          revoked_at: null,
        },
        select: {
          role: {
            select: {
              code: true,
            },
          },
        },
      },
    },
  });

  const passwordHash = user
    ? user.password_hash
    : await DUMMY_PASSWORD_HASH;

  const passwordMatches = await verifyPassword(
    input.password,
    passwordHash,
  );

  if (
    !user ||
    !passwordMatches ||
    user.status !== "ACTIVE" ||
    user.email_verified_at === null
  ) {
    throw new InvalidCredentialsError();
  }

  const currentTime = now();

  const refreshToken = generateOpaqueToken();
  const refreshTokenHash = hashOpaqueToken(refreshToken);
  const familyId = randomUUID();

  const accessToken = await createAccessToken(
    user.id,
    user.auth_version,
  );

  await prisma.$transaction(async (transaction) => {
    // Confirm that the account has not been disabled or changed
    // since credentials were checked.
    const account = await transaction.user.updateMany({
      where: {
        id: user.id,
        status: "ACTIVE",
        email_verified_at: {
          not: null,
        },
        auth_version: user.auth_version,
      },
      data: {
        last_login_at: currentTime,
      },
    });

    if (account.count !== 1) {
      throw new InvalidCredentialsError();
    }

    await transaction.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: refreshTokenHash,
        family_id: familyId,
        auth_version_at_issue: user.auth_version,
        expires_at: new Date(
          currentTime.getTime() + REFRESH_TOKEN_TTL_MS,
        ),
      },
    });
  });

  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName: user.display_name,
      status: user.status,
      emailVerified: user.email_verified_at !== null,
      createdAt: user.created_at.toISOString(),
      roles: user.user_roles.map(
        (userRole) => userRole.role.code,
      ),
    },
  };
}