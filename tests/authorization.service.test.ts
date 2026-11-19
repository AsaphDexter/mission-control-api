import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { userHasPermissions } from "../src/modules/authorization/authorization.service.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";

const findMany = vi.fn();

const prismaMock = {
  rolePermission: {
    findMany,
  },
} as unknown as PrismaClient;

const dependencies = {
  prisma: prismaMock,
};

describe("Authorization service", () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
  });

  it("grants access when the user has every required permission", async () => {
    findMany.mockResolvedValue([
      { permission: { code: "resources.create" } },
      { permission: { code: "resources.publish" } },
    ]);

    await expect(
      userHasPermissions(TEST_USER_ID, ["resources.create", "resources.publish"], dependencies),
    ).resolves.toBe(true);
  });

  it("denies access when the user is missing one required permission", async () => {
    findMany.mockResolvedValue([{ permission: { code: "resources.create" } }]);

    await expect(
      userHasPermissions(TEST_USER_ID, ["resources.create", "resources.publish"], dependencies),
    ).resolves.toBe(false);
  });

  it("uses any-permission mode when explicitly requested", async () => {
    findMany.mockResolvedValue([{ permission: { code: "resources.create" } }]);

    await expect(
      userHasPermissions(
        TEST_USER_ID,
        ["resources.create", "resources.publish"],
        dependencies,
        "any",
      ),
    ).resolves.toBe(true);
  });

  it("denies any-permission mode when none of the permissions are granted", async () => {
    findMany.mockResolvedValue([]);

    await expect(
      userHasPermissions(
        TEST_USER_ID,
        ["resources.create", "resources.publish"],
        dependencies,
        "any",
      ),
    ).resolves.toBe(false);
  });

  it("checks permissions through the user's active role assignments", async () => {
    findMany.mockResolvedValue([{ permission: { code: "resources.create" } }]);

    await userHasPermissions(TEST_USER_ID, ["resources.create"], dependencies);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        permission: {
          code: {
            in: ["resources.create"],
          },
        },
        role: {
          user_roles: {
            some: {
              user_id: TEST_USER_ID,
              revoked_at: null,
            },
          },
        },
      },
      select: {
        permission: {
          select: {
            code: true,
          },
        },
      },
    });
  });

  it("removes duplicate permission codes before querying the database", async () => {
    findMany.mockResolvedValue([{ permission: { code: "resources.create" } }]);

    await expect(
      userHasPermissions(TEST_USER_ID, ["resources.create", "resources.create"], dependencies),
    ).resolves.toBe(true);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          permission: {
            code: {
              in: ["resources.create"],
            },
          },
        }),
      }),
    );
  });

  it("rejects an empty permission requirement", async () => {
    await expect(userHasPermissions(TEST_USER_ID, [], dependencies)).rejects.toThrow(
      "At least one permission is required",
    );

    expect(findMany).not.toHaveBeenCalled();
  });

  it("propagates database errors to the authorization guard", async () => {
    findMany.mockRejectedValue(new Error("Database unavailable"));

    await expect(
      userHasPermissions(TEST_USER_ID, ["resources.create"], dependencies),
    ).rejects.toThrow("Database unavailable");
  });
});
