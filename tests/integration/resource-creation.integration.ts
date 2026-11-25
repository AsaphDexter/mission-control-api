import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient } from "../../src/lib/prisma.js";
import {
  createResource,
  type CreateResourceInput,
} from "../../src/modules/resources/resource.service.js";

// These tests must only run against the disposable local integration database.
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

const TEST_EMAIL = "resource-creation-integration@mission-control.test";

let userId: string;
let categoryId: string | undefined;
let createdResourceId: string | undefined;

const INPUT: Omit<CreateResourceInput, "categoryId"> = {
  title: "PostgreSQL Resource Integration Test",
  summary: "Verifies resource creation against a real PostgreSQL database.",
  bodyMarkdown: "# Integration Test\n\nVerify atomic resource creation.\n",
  externalUrl: "https://example.com/integration-resource",
};

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: {
      email: TEST_EMAIL,
    },
    update: {
      status: "ACTIVE",
      email_verified_at: new Date(),
    },
    create: {
      email: TEST_EMAIL,
      password_hash: "integration-test-only-password-hash",
      first_name: "Resource",
      last_name: "Integration",
      status: "ACTIVE",
      email_verified_at: new Date(),
    },
    select: {
      id: true,
    },
  });

  userId = user.id;
});

afterEach(async () => {
  if (createdResourceId) {
    await prisma.resourceRevision.deleteMany({
      where: {
        resource_id: createdResourceId,
      },
    });

    await prisma.resource.delete({
      where: {
        id: createdResourceId,
      },
    });

    createdResourceId = undefined;
  }

  if (categoryId) {
    await prisma.resourceCategory.delete({
      where: {
        id: categoryId,
      },
    });

    categoryId = undefined;
  }
});

afterAll(async () => {
  // The audit log is append-only and retains its actor foreign key.
  // The dedicated integration user therefore remains in this disposable database.
  await prisma.$disconnect();
});

async function createActiveCategory(): Promise<string> {
  const category = await prisma.resourceCategory.create({
    data: {
      name: "Resource Integration",
      slug: `resource-integration-${randomUUID()}`,
    },
    select: {
      id: true,
    },
  });

  categoryId = category.id;

  return category.id;
}

describe("PostgreSQL resource creation", () => {
  it("commits the resource, first draft revision and audit event together", async () => {
    const selectedCategoryId = await createActiveCategory();
    const requestId = `resource-create-${randomUUID()}`;

    const result = await createResource(
      {
        ...INPUT,
        categoryId: selectedCategoryId,
      },
      {
        userId,
        actorRoleSnapshot: "CONTRIBUTOR",
        requestId,
      },
      {
        prisma,
      },
    );

    createdResourceId = result.resource.id;

    expect(result.resource.created_by).toBe(userId);
    expect(result.revision.resource_id).toBe(result.resource.id);
    expect(result.revision.revision_number).toBe(1);
    expect(result.revision.status).toBe("DRAFT");
    expect(result.revision.category_id).toBe(selectedCategoryId);
    expect(result.revision.body_markdown).toBe(INPUT.bodyMarkdown);
    expect(result.revision.external_url).toBe(INPUT.externalUrl);

    const persistedResource = await prisma.resource.findUnique({
      where: {
        id: result.resource.id,
      },
      include: {
        revisions: true,
      },
    });

    expect(persistedResource).not.toBeNull();
    expect(persistedResource?.revisions).toHaveLength(1);
    expect(persistedResource?.revisions[0]?.status).toBe("DRAFT");

    const auditEvent = await prisma.auditLog.findFirst({
      where: {
        request_id: requestId,
        entity_id: result.resource.id,
        action: "RESOURCE_CREATED",
      },
    });

    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actor_user_id).toBe(userId);
    expect(auditEvent?.entity_type).toBe("RESOURCE");
    expect(auditEvent?.actor_role_snapshot).toBe("CONTRIBUTOR");
    expect(auditEvent?.after_data).toMatchObject({
      revisionId: result.revision.id,
      revisionNumber: 1,
      title: INPUT.title,
      categoryId: selectedCategoryId,
      status: "DRAFT",
    });
  });

  it("rolls back the resource and revision when the audit insert fails", async () => {
    const selectedCategoryId = await createActiveCategory();
    const requestId = `resource-rollback-${randomUUID()}`;

    const resourcesBefore = await prisma.resource.count({
      where: {
        created_by: userId,
      },
    });

    const revisionsBefore = await prisma.resourceRevision.count({
      where: {
        created_by: userId,
      },
    });

    // actor_role_snapshot is VARCHAR(50). This deliberately exceeds the
    // database limit so the audit insert fails after the resource and revision
    // have been created inside the transaction.
    await expect(
      createResource(
        {
          ...INPUT,
          categoryId: selectedCategoryId,
        },
        {
          userId,
          actorRoleSnapshot: "X".repeat(51),
          requestId,
        },
        {
          prisma,
        },
      ),
    ).rejects.toBeDefined();

    const resourcesAfter = await prisma.resource.count({
      where: {
        created_by: userId,
      },
    });

    const revisionsAfter = await prisma.resourceRevision.count({
      where: {
        created_by: userId,
      },
    });

    const auditEvents = await prisma.auditLog.count({
      where: {
        request_id: requestId,
      },
    });

    expect(resourcesAfter).toBe(resourcesBefore);
    expect(revisionsAfter).toBe(revisionsBefore);
    expect(auditEvents).toBe(0);
  });
});
