import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 900;

const ACCESS_TOKEN_TTL = "15m";
const TOKEN_ISSUER = "mission-control-api";
const TOKEN_AUDIENCE = "mission-control-api";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccessTokenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessTokenConfigurationError";
  }
}

export interface VerifiedAccessToken {
  userId: string;
  sessionId: string;
  authVersion: number;
  issuedAt: number;
  expiresAt: number;
}

function getAccessTokenKey(): Buffer {
  const encodedSecret = process.env.JWT_ACCESS_SECRET;

  if (!encodedSecret) {
    throw new AccessTokenConfigurationError("JWT_ACCESS_SECRET is required.");
  }

  const key = Buffer.from(encodedSecret, "base64url");

  if (key.length !== 32 || key.toString("base64url") !== encodedSecret) {
    throw new AccessTokenConfigurationError(
      "JWT_ACCESS_SECRET must be a base64url-encoded 32-byte secret.",
    );
  }

  return key;
}

export async function createAccessToken(
  userId: string,
  authVersion: number,
  sessionId: string,
): Promise<string> {
  if (!userId.trim()) {
    throw new Error("A valid user ID is required.");
  }

  if (!Number.isSafeInteger(authVersion) || authVersion < 1) {
    throw new Error("A valid authentication version is required.");
  }

  if (!UUID_PATTERN.test(sessionId)) {
    throw new Error("A valid session ID is required.");
  }

  return new SignJWT({
    authVersion,
    sid: sessionId,
  })
    .setProtectedHeader({
      alg: "HS256",
      typ: "JWT",
    })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getAccessTokenKey());
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, getAccessTokenKey(), {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    maxTokenAge: ACCESS_TOKEN_TTL,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    !UUID_PATTERN.test(payload.sid) ||
    typeof payload.authVersion !== "number" ||
    !Number.isSafeInteger(payload.authVersion) ||
    payload.authVersion < 1 ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Access token contains invalid claims.");
  }

  return {
    userId: payload.sub,
    sessionId: payload.sid,
    authVersion: payload.authVersion,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}
