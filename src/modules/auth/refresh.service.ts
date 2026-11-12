import type { PrismaClient } from "../../generated/prisma/client.js";

import { createAccessToken, ACCESS_TOKEN_TTL_SECONDS } from "./security/access-token.js";

import { generateOpaqueToken, hashOpaqueToken } from "./security/opaque-token.js";

import { REFRESH_TOKEN_TTL_SECONDS } from "./login.service.js";

const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

export interface RefreshInput {
  refreshToken: string;
}

export interface RefreshDependencies {
  prisma: PrismaClient;
  now?: () => Date;
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("The refresh token is invalid, expired or no longer active.");
    this.name = "InvalidRefreshTokenError";
  }
}

export class RefreshTokenReuseError extends Error {
  constructor() {
    super("Refresh token reuse was detected. All account sessions have been invalidated.");
    this.name = "RefreshTokenReuseError";
  }
}

export interface RefreshResult {
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

type RotationOutcome =
  | { kind: "invalid" }
  | { kind: "reuse" }
  | {
      kind: "rotated";
      result: RefreshResult;
    };

export async function rotateRefreshToken(
  input: RefreshInput,
  dependencies: RefreshDependencies,
): Promise<RefreshResult> {
  const { prisma } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const currentTime = now();

  const tokenHash = hashOpaqueToken(input.refreshToken);

  const outcome: RotationOutcome = await prisma.$transaction(
    async (transaction): Promise<RotationOutcome> => {
      const tokenOwner = await transaction.refreshToken.findUnique({
        where: {
          token_hash: tokenHash,
        },
        select: {
          user_id: true,
        },
      });

      if (!tokenOwner) {
        return { kind: "invalid" };
      }

      // Use the same account-level lock as the logout operation.
      const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "users"
        WHERE "id" = ${tokenOwner.user_id}::uuid
        FOR UPDATE
      `;

      if (lockedUsers.length !== 1) {
        return { kind: "invalid" };
      }

      // Re-read the token after obtaining the lock. Another session
      // operation may have changed its state while this transaction waited.
      const storedToken = await transaction.refreshToken.findUnique({
        where: {
          token_hash: tokenHash,
        },
        select: {
          id: true,
          user_id: true,
          token_hash: true,
          family_id: true,
          auth_version_at_issue: true,
          expires_at: true,
          revoked_at: true,
          replaced_by_token_id: true,
          user: {
            select: {
              id: true,
              email: true,
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
          },
        },
      });

      if (!storedToken || storedToken.user_id !== tokenOwner.user_id) {
        return { kind: "invalid" };
      }

      // A token that has already been rotated has a replacement link.
      // Its reuse is treated as a confirmed session compromise.
      if (storedToken.revoked_at !== null) {
        if (storedToken.replaced_by_token_id === null) {
          return { kind: "invalid" };
        }

        await transaction.refreshToken.updateMany({
          where: {
            user_id: storedToken.user_id,
            family_id: storedToken.family_id,
            revoked_at: null,
          },
          data: {
            revoked_at: currentTime,
          },
        });

        await transaction.user.update({
          where: {
            id: storedToken.user_id,
          },
          data: {
            auth_version: {
              increment: 1,
            },
          },
        });

        // Return instead of throwing, so these security changes commit.
        return { kind: "reuse" };
      }

      // Validate token expiry and account eligibility.
      if (
        storedToken.expires_at.getTime() <= currentTime.getTime() ||
        storedToken.user.status !== "ACTIVE" ||
        storedToken.user.email_verified_at === null ||
        storedToken.auth_version_at_issue !== storedToken.user.auth_version
      ) {
        return { kind: "invalid" };
      }

      // Atomically claim the existing token before issuing a replacement.
      // Only one concurrent request can successfully claim it.
      const claimedToken = await transaction.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          revoked_at: null,
          replaced_by_token_id: null,
          expires_at: {
            gt: currentTime,
          },
          auth_version_at_issue: storedToken.user.auth_version,
        },
        data: {
          revoked_at: currentTime,
          last_used_at: currentTime,
        },
      });

      if (claimedToken.count !== 1) {
        // Another request may have rotated this token while we were
        // processing. Read its latest state to distinguish replay
        // from ordinary invalidation.
        const latestToken = await transaction.refreshToken.findUnique({
          where: {
            id: storedToken.id,
          },
          select: {
            revoked_at: true,
            replaced_by_token_id: true,
          },
        });

        if (latestToken?.revoked_at !== null && latestToken?.replaced_by_token_id !== null) {
          await transaction.refreshToken.updateMany({
            where: {
              user_id: storedToken.user_id,
              family_id: storedToken.family_id,
              revoked_at: null,
            },
            data: {
              revoked_at: currentTime,
            },
          });

          await transaction.user.update({
            where: {
              id: storedToken.user_id,
            },
            data: {
              auth_version: {
                increment: 1,
              },
            },
          });

          return { kind: "reuse" };
        }

        return { kind: "invalid" };
      }

      // Generate the replacement token. Only its hash is persisted.
      const replacementToken = generateOpaqueToken();
      const replacementTokenHash = hashOpaqueToken(replacementToken);

      const replacement = await transaction.refreshToken.create({
        data: {
          user_id: storedToken.user_id,
          token_hash: replacementTokenHash,
          family_id: storedToken.family_id,
          auth_version_at_issue: storedToken.user.auth_version,
          expires_at: new Date(currentTime.getTime() + REFRESH_TOKEN_TTL_MS),
        },
        select: {
          id: true,
        },
      });

      // Link the previous token to its replacement.
      await transaction.refreshToken.update({
        where: {
          id: storedToken.id,
        },
        data: {
          replaced_by_token_id: replacement.id,
        },
      });

      const accessToken = await createAccessToken(
        storedToken.user.id,
        storedToken.user.auth_version,
      );

      return {
        kind: "rotated",
        result: {
          accessToken,
          tokenType: "Bearer",
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: replacementToken,
          refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
          user: {
            id: storedToken.user.id,
            email: storedToken.user.email,
            firstName: storedToken.user.first_name,
            lastName: storedToken.user.last_name,
            displayName: storedToken.user.display_name,
            status: storedToken.user.status,
            emailVerified: storedToken.user.email_verified_at !== null,
            createdAt: storedToken.user.created_at.toISOString(),
            roles: storedToken.user.user_roles.map((userRole) => userRole.role.code),
          },
        },
      };
    },
  );

  // These errors are deliberately thrown after the transaction commits.
  if (outcome.kind === "reuse") {
    throw new RefreshTokenReuseError();
  }

  if (outcome.kind === "invalid") {
    throw new InvalidRefreshTokenError();
  }

  return outcome.result;
}
