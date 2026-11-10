import { getPrismaClient } from "../src/lib/prisma.js";

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
  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
      },
    });
  }

  console.log(`Successfully seeded ${roles.length} application roles.`);
}

try {
  await main();
} catch {
  console.error("Role seeding failed. Check database connectivity and configuration.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
