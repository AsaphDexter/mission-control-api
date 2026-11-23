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
  await prisma.$transaction(
    async (transaction) => {
      const roleIds = new Map<string, string>();

      // 1. Ensure built-in roles exist and their metadata is current.
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

      // 2. Insert missing permissions in one bulk operation.
      await transaction.permission.createMany({
        data: PERMISSION_CATALOG.map((permission) => ({
          code: permission.code,
          description: permission.description,
        })),
        skipDuplicates: true,
      });

      // 3. Retrieve permission IDs and synchronise descriptions.
      const savedPermissions = await transaction.permission.findMany({
        where: {
          code: {
            in: PERMISSION_CATALOG.map((permission) => permission.code),
          },
        },
        select: {
          id: true,
          code: true,
          description: true,
        },
      });

      const permissionRecords = new Map(
        savedPermissions.map((permission) => [permission.code, permission]),
      );

      const permissionIds = new Map<string, string>();

      for (const permission of PERMISSION_CATALOG) {
        const savedPermission = permissionRecords.get(permission.code);

        if (!savedPermission) {
          throw new Error(`Permission ${permission.code} was not created.`);
        }

        permissionIds.set(permission.code, savedPermission.id);

        if (savedPermission.description !== permission.description) {
          await transaction.permission.update({
            where: {
              code: permission.code,
            },
            data: {
              description: permission.description,
            },
          });
        }
      }

      // 4. Build the complete desired role-permission matrix.
      const roleAssignments = roles.map((role) => {
        const roleId = roleIds.get(role.code);

        if (!roleId) {
          throw new Error(`Role ${role.code} was not created.`);
        }

        const assignedPermissionIds = ROLE_PERMISSION_CODES[role.code].map((permissionCode) => {
          const permissionId = permissionIds.get(permissionCode);

          if (!permissionId) {
            throw new Error(`Permission ${permissionCode} was not created.`);
          }

          return permissionId;
        });

        return {
          roleId,
          permissionIds: assignedPermissionIds,
        };
      });

      // 5. Insert all missing role-permission assignments at once.
      const assignments = roleAssignments.flatMap(({ roleId, permissionIds }) =>
        permissionIds.map((permissionId) => ({
          role_id: roleId,
          permission_id: permissionId,
        })),
      );

      await transaction.rolePermission.createMany({
        data: assignments,
        skipDuplicates: true,
      });

      // 6. Remove assignments outside the code-managed role matrix.
      await transaction.rolePermission.deleteMany({
        where: {
          OR: roleAssignments.map(({ roleId, permissionIds }) => ({
            role_id: roleId,
            permission_id: {
              notIn: permissionIds,
            },
          })),
        },
      });
    },
    {
      timeout: 30_000,
    },
  );

  console.log(
    `Successfully seeded ${roles.length} roles, ${PERMISSION_CATALOG.length} permissions and their role assignments.`,
  );
}

try {
  await main();
} catch (error) {
  console.error("Role and permission seeding failed:", error);

  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
