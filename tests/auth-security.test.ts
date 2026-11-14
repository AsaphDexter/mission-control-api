import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertPasswordPolicy,
  hashPassword,
  PasswordPolicyError,
  verifyPassword,
} from "../src/modules/auth/security/password.js";

import { generateOpaqueToken, hashOpaqueToken } from "../src/modules/auth/security/opaque-token.js";

import { createAccessToken, verifyAccessToken } from "../src/modules/auth/security/access-token.js";

const TEST_SESSION_ID = "f13c9c0a-3d24-4a77-a1b3-123456789abc";

const previousSecret = process.env.JWT_ACCESS_SECRET;

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = Buffer.alloc(32, 0x42).toString("base64url");
});

afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env.JWT_ACCESS_SECRET;
  } else {
    process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});

describe("Password security", () => {
  it("accepts passwords within the defined length range", () => {
    expect(() => assertPasswordPolicy("a".repeat(12))).not.toThrow();
    expect(() => assertPasswordPolicy("a".repeat(128))).not.toThrow();
  });

  it("rejects passwords below or above the permitted range", () => {
    expect(() => assertPasswordPolicy("short")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("a".repeat(129))).toThrow(PasswordPolicyError);
  });

  it("hashes passwords using Argon2id and verifies them", async () => {
    const password = "MissionControl-Password-2026!";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toContain("$argon2id$");
    expect(passwordHash).not.toBe(password);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("Incorrect-Password", passwordHash)).resolves.toBe(false);
  });

  it("generates a different salted hash for the same password", async () => {
    const password = "MissionControl-Password-2026!";

    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).not.toBe(secondHash);
    await expect(verifyPassword(password, firstHash)).resolves.toBe(true);
    await expect(verifyPassword(password, secondHash)).resolves.toBe(true);
  });
});

describe("Opaque tokens", () => {
  it("generates cryptographically random URL-safe tokens", () => {
    const firstToken = generateOpaqueToken();
    const secondToken = generateOpaqueToken();

    expect(firstToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondToken).not.toBe(firstToken);
  });

  it("stores a SHA-256 hexadecimal hash instead of the raw token", () => {
    const token = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(token);

    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toBe(token);
    expect(hashOpaqueToken(token)).toBe(tokenHash);
  });
});

describe("JWT access tokens", () => {
  it("creates and verifies a signed access token", async () => {
    const token = await createAccessToken(
      "00000000-0000-4000-8000-000000000001",
      1,
      TEST_SESSION_ID,
    );

    const claims = await verifyAccessToken(token);

    expect(claims).toMatchObject({
      userId: "00000000-0000-4000-8000-000000000001",
      authVersion: 1,
    });

    expect(claims.sessionId).toBe(TEST_SESSION_ID);
    expect(claims.expiresAt - claims.issuedAt).toBe(900);
  });

  it("rejects a tampered access token", async () => {
    const token = await createAccessToken(
      "00000000-0000-4000-8000-000000000001",
      1,
      TEST_SESSION_ID,
    );

    const tamperedToken = `${token.slice(0, 10)}x${token.slice(11)}`;

    await expect(verifyAccessToken(tamperedToken)).rejects.toThrow();
  });

  it("rejects invalid authentication versions", async () => {
    await expect(
      createAccessToken("00000000-0000-4000-8000-000000000001", 0, TEST_SESSION_ID),
    ).rejects.toThrow();
  });
});
