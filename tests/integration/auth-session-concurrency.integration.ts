import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getPrismaClient } from "../../src/lib/prisma.js";

import {
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
  rotateRefreshToken,
} from "../../src/modules/auth/refresh.service.js";

import { logoutSession } from "../../src/modules/auth/logout.service.js";

import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../../src/modules/auth/security/opaque-token.js";

// These integration tests must never run against the hosted development
// database or any production database.
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for PostgreSQL integration tests.");
}

const parsedDatabaseUrl = new URL(databaseUrl);

if (
  !["localhost", "127.0.0.1"].includes(parsedDatabaseUrl.hostname) ||
  parsedDatabaseUrl.pathname !== "/mission_control_test"
) {
  throw new Error(
    "Integration tests may only run against the disposable local mission_control_test database.",
  );
}

const prisma = getPrismaClient();

let activeUserId: string | undefined;

interface TestSessionToken {
  raw: string;
  familyId: string;
}

async function createActiveUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `integration-${randomUUID()}@example.test`,
      password_hash: "integration-test-only-password-hash",
      first_name: "Concurrency",
      last_name: "Test",
      status: "ACTIVE",
      email_verified_at: new Date(),
    },
    select: {
      id: true,
    },
  });

  activeUserId = user.id;

  return user.id;
}

async function createRefreshToken(userId: string): Promise<TestSessionToken> {
  const raw = generateOpaqueToken();
  const familyId = randomUUID();

  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token_hash: hashOpaqueToken(raw),
      family_id: familyId,
      auth_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return {
    raw,
    familyId,
  };
}

describe("PostgreSQL auth session concurrency", () => {
  afterEach(async () => {
    if (!activeUserId) {
      return;
    }

    // Clear self-referencing replacement links before deleting the tokens.
    await prisma.refreshToken.updateMany({
      where: {
        user_id: activeUserId,
      },
      data: {
        replaced_by_token_id: null,
      },
    });

    await prisma.refreshToken.deleteMany({
      where: {
        user_id: activeUserId,
      },
    });

    await prisma.user.delete({
      where: {
        id: activeUserId,
      },
    });

    activeUserId = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serialises a refresh racing with logout and leaves no active family tokens", async () => {
    const userId = await createActiveUser();
    const session = await createRefreshToken(userId);

    const [refreshOutcome, logoutOutcome] = await Promise.allSettled([
      rotateRefreshToken(
        {
          refreshToken: session.raw,
        },
        {
          prisma,
        },
      ),
      logoutSession(
        userId,
        {
          refreshToken: session.raw,
        },
        {
          prisma,
        },
      ),
    ]);

    expect(logoutOutcome.status).toBe("fulfilled");

    const familyTokens = await prisma.refreshToken.findMany({
      where: {
        user_id: userId,
        family_id: session.familyId,
      },
      select: {
        token_hash: true,
        revoked_at: true,
      },
    });

    // Logout must leave no active token in the session family.
    expect(familyTokens.length).toBeGreaterThanOrEqual(1);
    expect(familyTokens.every((token) => token.revoked_at !== null)).toBe(true);

    if (refreshOutcome.status === "fulfilled") {
      // Refresh won the lock first. Logout must also revoke its replacement.
      expect(familyTokens).toHaveLength(2);

      expect(
        familyTokens.some(
          (token) => token.token_hash === hashOpaqueToken(refreshOutcome.value.refreshToken),
        ),
      ).toBe(true);
    } else {
      // Logout won the lock first. Refresh must reject the revoked token.
      expect(refreshOutcome.reason).toBeInstanceOf(InvalidRefreshTokenError);
      expect(familyTokens).toHaveLength(1);
    }
  });

  it("detects concurrent reuse when two requests rotate the same refresh token", async () => {
    const userId = await createActiveUser();
    const session = await createRefreshToken(userId);

    const outcomes = await Promise.allSettled([
      rotateRefreshToken(
        {
          refreshToken: session.raw,
        },
        {
          prisma,
        },
      ),
      rotateRefreshToken(
        {
          refreshToken: session.raw,
        },
        {
          prisma,
        },
      ),
    ]);

    const successfulRotations = outcomes.filter((outcome) => outcome.status === "fulfilled");

    const rejectedRotations = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(successfulRotations).toHaveLength(1);
    expect(rejectedRotations).toHaveLength(1);

    const reuseFailure = rejectedRotations[0];

    if (reuseFailure?.status === "rejected") {
      expect(reuseFailure.reason).toBeInstanceOf(RefreshTokenReuseError);
    }

    const familyTokens = await prisma.refreshToken.findMany({
      where: {
        user_id: userId,
        family_id: session.familyId,
      },
      select: {
        id: true,
        token_hash: true,
        revoked_at: true,
        replaced_by_token_id: true,
      },
    });

    // The original token and its replacement must both be revoked.
    expect(familyTokens).toHaveLength(2);
    expect(familyTokens.every((token) => token.revoked_at !== null)).toBe(true);

    const originalToken = familyTokens.find(
      (token) => token.token_hash === hashOpaqueToken(session.raw),
    );

    const replacementToken = familyTokens.find(
      (token) => token.token_hash !== hashOpaqueToken(session.raw),
    );

    expect(originalToken?.replaced_by_token_id).toBe(replacementToken?.id);

    // Confirm that reuse detection incremented the account auth version.
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        auth_version: true,
      },
    });

    expect(user?.auth_version).toBe(2);
  });

  it("logs out one session family without invalidating a sibling family", async () => {
    const userId = await createActiveUser();

    const logoutTarget = await createRefreshToken(userId);
    const siblingSession = await createRefreshToken(userId);

    await logoutSession(
      userId,
      {
        refreshToken: logoutTarget.raw,
      },
      {
        prisma,
      },
    );

    const loggedOutFamily = await prisma.refreshToken.findMany({
      where: {
        user_id: userId,
        family_id: logoutTarget.familyId,
      },
    });

    expect(loggedOutFamily).toHaveLength(1);
    expect(loggedOutFamily[0]?.revoked_at).not.toBeNull();

    const siblingBeforeRefresh = await prisma.refreshToken.findUnique({
      where: {
        token_hash: hashOpaqueToken(siblingSession.raw),
      },
      select: {
        revoked_at: true,
      },
    });

    expect(siblingBeforeRefresh?.revoked_at).toBeNull();

    const userBeforeRefresh = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        auth_version: true,
      },
    });

    expect(userBeforeRefresh?.auth_version).toBe(1);

    // The sibling session should remain usable.
    const siblingRotation = await rotateRefreshToken(
      {
        refreshToken: siblingSession.raw,
      },
      {
        prisma,
      },
    );

    expect(siblingRotation.user.id).toBe(userId);

    const siblingFamilyAfterRefresh = await prisma.refreshToken.findMany({
      where: {
        user_id: userId,
        family_id: siblingSession.familyId,
      },
    });

    expect(siblingFamilyAfterRefresh).toHaveLength(2);
    expect(siblingFamilyAfterRefresh.some((token) => token.revoked_at === null)).toBe(true);

    const userAfterRefresh = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        auth_version: true,
      },
    });

    // Ordinary logout must not increment the account-wide auth version.
    expect(userAfterRefresh?.auth_version).toBe(1);
  });

  it("treats a previously logged-out token as invalid, not as token reuse", async () => {
    const userId = await createActiveUser();
    const session = await createRefreshToken(userId);

    await logoutSession(
      userId,
      {
        refreshToken: session.raw,
      },
      {
        prisma,
      },
    );

    await expect(
      rotateRefreshToken(
        {
          refreshToken: session.raw,
        },
        {
          prisma,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        auth_version: true,
      },
    });

    // A normal logout followed by an attempted reuse is not a compromise event.
    expect(user?.auth_version).toBe(1);
  });
});
