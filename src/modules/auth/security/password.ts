import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export class PasswordPolicyError extends Error {
  constructor() {
    super(
      `Password must contain between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
    this.name = "PasswordPolicyError";
  }
}

export function assertPasswordPolicy(password: string): void {
  const length = Array.from(password).length;

  if (
    length < PASSWORD_MIN_LENGTH ||
    length > PASSWORD_MAX_LENGTH
  ) {
    throw new PasswordPolicyError();
  }
}

export async function hashPassword(
  password: string,
): Promise<string> {
  assertPasswordPolicy(password);

  return hash(password, PASSWORD_HASH_OPTIONS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!password || !passwordHash) {
    return false;
  }

  return verify(passwordHash, password);
}
