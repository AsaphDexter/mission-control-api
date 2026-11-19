import { getPrismaClient } from "../src/lib/prisma.js";
import {
  PERMISSION_CATALOG,
  ROLE_PERMISSION_CODES,
} from "../src/modules/authorization/permission-catalog.js";

const prisma = getPrismaClient();

const roles = [
  {
    code: "LEARNER",
    name: "Learner",
    description: "Default role assigned to self-registered learners.",
  },
  {
    code: "CONTRIBUTOR",
    name: "Contributor",
    description: "Creates and submits learning resources and challenges for review.",
  },
  {
    code: "ADMINISTRATOR",
    name: "Administrator",
    description: "Manages platform operations, moderation and access control.",
  },
] as const;

async function main(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const roleIds = new Map<string, string>();

    for (const role of roles) {
      const savedRole = await transaction.role.upsert({
        where: {
          code: role.code,
        },
        update: {
          name: role.name,
          description: role.description,
        },
        create: role,
      });

      roleIds.set(savedRole.code, savedRole.id);
    }

    const permissionIds = new Map<string, string>();

    for (const permission of PERMISSION_CATALOG) {
      const savedPermission = await transaction.permission.upsert({
        where: {
          code: permission.code,
        },
        update: {
          description: permission.description,
        },
        create: {
          code: permission.code,
          description: permission.description,
        },
      });

      permissionIds.set(savedPermission.code, savedPermission.id);
    }

    for (const role of roles) {
      const roleId = roleIds.get(role.code);

      if (!roleId) {
        throw new Error(`Role ${role.code} was not created.`);
      }

      const permissionCodes = ROLE_PERMISSION_CODES[role.code];

      const assignedPermissionIds = permissionCodes.map((permissionCode) => {
        const permissionId = permissionIds.get(permissionCode);

        if (!permissionId) {
          throw new Error(`Permission ${permissionCode} was not created.`);
        }

        return permissionId;
      });

      for (const permissionId of assignedPermissionIds) {
        await transaction.rolePermission.upsert({
          where: {
            role_id_permission_id: {
              role_id: roleId,
              permission_id: permissionId,
            },
          },
          update: {},
          create: {
            role_id: roleId,
            permission_id: permissionId,
          },
        });
      }

      // Keep built-in role assignments aligned with the code-managed matrix.
      await transaction.rolePermission.deleteMany({
        where: {
          role_id: roleId,
          permission_id: {
            notIn: assignedPermissionIds,
          },
        },
      });
    }
  });

  console.log(
    `Successfully seeded ${roles.length} roles, ${PERMISSION_CATALOG.length} permissions and their role assignments.`,
  );
}

try {
  await main();
} catch {
  console.error(
    "Role and permission seeding failed. Check database connectivity and configuration.",
  );

  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
