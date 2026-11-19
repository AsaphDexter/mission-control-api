import type { PrismaClient } from "../../generated/prisma/client.js";
import type { PermissionCode } from "./permission-catalog.js";

export type PermissionMatchMode = "all" | "any";

export interface AuthorizationDependencies {
  prisma: PrismaClient;
}

/**
 * Checks permissions granted through the user's current active role assignments.
 *
 * The database is queried on every authorization decision. This means role
 * and permission changes take effect without waiting for JWT expiry.
 */
export async function userHasPermissions(
  userId: string,
  requiredPermissions: readonly PermissionCode[],
  dependencies: AuthorizationDependencies,
  mode: PermissionMatchMode = "all",
): Promise<boolean> {
  const permissionCodes = [...new Set(requiredPermissions)];

  if (permissionCodes.length === 0) {
    throw new Error("At least one permission is required for authorization.");
  }

  const assignments = await dependencies.prisma.rolePermission.findMany({
    where: {
      permission: {
        code: {
          in: permissionCodes,
        },
      },
      role: {
        user_roles: {
          some: {
            user_id: userId,
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

  const grantedPermissions = new Set(assignments.map((assignment) => assignment.permission.code));

  if (mode === "any") {
    return permissionCodes.some((permission) => grantedPermissions.has(permission));
  }

  return permissionCodes.every((permission) => grantedPermissions.has(permission));
}
