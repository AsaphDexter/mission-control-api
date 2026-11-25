import { describe, expect, it, vi } from "vitest";

import {
  InvalidResourceInputError,
  ResourceCategoryUnavailableError,
} from "../src/modules/resources/resource.errors.js";

import {
  createResource,
  type ResourceServiceDependencies,
} from "../src/modules/resources/resource.service.js";

const USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const CATEGORY_ID = "3e1c9c0a-3d24-4a77-a1b3-123456789abc";
const RESOURCE_ID = "5e1c9c0a-3d24-4a77-a1b3-123456789abc";

const CREATED_AT = new Date("2026-11-25T10:00:00.000Z");

const CATEGORY = {
  id: CATEGORY_ID,
  name: "API Testing",
  slug: "api-testing",
};

const RESOURCE = {
  id: RESOURCE_ID,
  created_by: USER_ID,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  archived_at: null,
};

const REVISION = {
  id: "6e1c9c0a-3d24-4a77-a1b3-123456789abc",
  resource_id: RESOURCE_ID,
  revision_number: 1,
  category_id: CATEGORY_ID,
  title: "Introduction to API Testing",
  summary: "A practical introduction.",
  body_markdown: "# Introduction\n\nTest REST APIs.\n",
  external_url: null,
  status: "DRAFT",
  created_by: USER_ID,
  submitted_at: null,
  published_at: null,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  category: CATEGORY,
};

const INPUT = {
  categoryId: CATEGORY_ID,
  title: "Introduction to API Testing",
  summary: "A practical introduction.",
  bodyMarkdown: "# Introduction\n\nTest REST APIs.\n",
};

const CONTEXT = {
  userId: USER_ID,
  actorRoleSnapshot: "CONTRIBUTOR",
  requestId: "request-resource-001",
};

function createMockDependencies() {
  const findActiveCategory = vi.fn().mockResolvedValue(CATEGORY);
  const createResourceRecord = vi.fn().mockResolvedValue(RESOURCE);
  const createRevisionRecord = vi.fn().mockResolvedValue(REVISION);
  const createAuditRecord = vi.fn().mockResolvedValue({ id: "audit-001" });

  const transactionClient = {
    resourceCategory: {
      findFirst: findActiveCategory,
    },
    resource: {
      create: createResourceRecord,
    },
    resourceRevision: {
      create: createRevisionRecord,
    },
    auditLog: {
      create: createAuditRecord,
    },
  };

  const runTransaction = vi.fn(
    async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  );

  const dependencies = {
    prisma: {
      $transaction: runTransaction,
    },
  } as unknown as ResourceServiceDependencies;

  return {
    dependencies,
    mocks: {
      findActiveCategory,
      createResourceRecord,
      createRevisionRecord,
      createAuditRecord,
      runTransaction,
    },
  };
}

describe("Resource creation service", () => {
  it("creates a resource, its first draft revision and an audit record", async () => {
    const { dependencies, mocks } = createMockDependencies();

    const result = await createResource(INPUT, CONTEXT, dependencies);

    expect(result).toEqual({
      resource: RESOURCE,
      revision: REVISION,
    });

    expect(mocks.runTransaction).toHaveBeenCalledOnce();

    expect(mocks.findActiveCategory).toHaveBeenCalledWith({
      where: {
        id: CATEGORY_ID,
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    expect(mocks.createResourceRecord).toHaveBeenCalledWith({
      data: {
        created_by: USER_ID,
      },
    });

    expect(mocks.createRevisionRecord).toHaveBeenCalledWith({
      data: {
        resource_id: RESOURCE_ID,
        revision_number: 1,
        category_id: CATEGORY_ID,
        title: INPUT.title,
        summary: INPUT.summary,
        body_markdown: INPUT.bodyMarkdown,
        external_url: null,
        status: "DRAFT",
        created_by: USER_ID,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    expect(mocks.createAuditRecord).toHaveBeenCalledWith({
      data: {
        actor_user_id: USER_ID,
        actor_role_snapshot: "CONTRIBUTOR",
        action: "RESOURCE_CREATED",
        entity_type: "RESOURCE",
        entity_id: RESOURCE_ID,
        request_id: CONTEXT.requestId,
        after_data: {
          revisionId: REVISION.id,
          revisionNumber: 1,
          title: REVISION.title,
          categoryId: CATEGORY_ID,
          status: "DRAFT",
        },
      },
    });
  });

  it("trims the title and summary before persistence", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await createResource(
      {
        ...INPUT,
        title: "  Introduction to API Testing  ",
        summary: "  A practical introduction.  ",
      },
      CONTEXT,
      dependencies,
    );

    expect(mocks.createRevisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Introduction to API Testing",
          summary: "A practical introduction.",
        }),
      }),
    );
  });

  it("preserves Markdown content exactly as submitted", async () => {
    const { dependencies, mocks } = createMockDependencies();
    const markdown = "\n# Introduction\n\n```javascript\nexpect(true).toBe(true);\n```\n";

    await createResource(
      {
        ...INPUT,
        bodyMarkdown: markdown,
      },
      CONTEXT,
      dependencies,
    );

    expect(mocks.createRevisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body_markdown: markdown,
        }),
      }),
    );
  });

  it("rejects an inactive or nonexistent category", async () => {
    const { dependencies, mocks } = createMockDependencies();
    mocks.findActiveCategory.mockResolvedValue(null);

    await expect(createResource(INPUT, CONTEXT, dependencies)).rejects.toBeInstanceOf(
      ResourceCategoryUnavailableError,
    );

    expect(mocks.createResourceRecord).not.toHaveBeenCalled();
    expect(mocks.createRevisionRecord).not.toHaveBeenCalled();
    expect(mocks.createAuditRecord).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only titles", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await expect(
      createResource(
        {
          ...INPUT,
          title: "   ",
        },
        CONTEXT,
        dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidResourceInputError);

    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only summaries", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await expect(
      createResource(
        {
          ...INPUT,
          summary: "   ",
        },
        CONTEXT,
        dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidResourceInputError);

    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only Markdown bodies", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await expect(
      createResource(
        {
          ...INPUT,
          bodyMarkdown: " \n  ",
        },
        CONTEXT,
        dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidResourceInputError);

    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("normalises an empty external URL to null", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await createResource(
      {
        ...INPUT,
        externalUrl: "   ",
      },
      CONTEXT,
      dependencies,
    );

    expect(mocks.createRevisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          external_url: null,
        }),
      }),
    );
  });

  it("accepts a valid HTTPS external URL", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await createResource(
      {
        ...INPUT,
        externalUrl: "https://example.com/api-testing",
      },
      CONTEXT,
      dependencies,
    );

    expect(mocks.createRevisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          external_url: "https://example.com/api-testing",
        }),
      }),
    );
  });

  it("rejects non-HTTP external URLs", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await expect(
      createResource(
        {
          ...INPUT,
          externalUrl: "javascript:alert(1)",
        },
        CONTEXT,
        dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidResourceInputError);

    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("rejects external URLs containing embedded credentials", async () => {
    const { dependencies, mocks } = createMockDependencies();

    await expect(
      createResource(
        {
          ...INPUT,
          externalUrl: "https://user:password@example.com/resource",
        },
        CONTEXT,
        dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidResourceInputError);

    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("propagates an audit-log failure", async () => {
    const { dependencies, mocks } = createMockDependencies();
    mocks.createAuditRecord.mockRejectedValue(new Error("Audit insert failed"));

    await expect(createResource(INPUT, CONTEXT, dependencies)).rejects.toThrow(
      "Audit insert failed",
    );
  });
});
