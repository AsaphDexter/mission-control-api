import { describe, expect, it, vi } from "vitest";

import {
  InvalidResourceInputError,
  ResourceCategoryUnavailableError,
  ResourceNotFoundError,
} from "../src/modules/resources/resource.errors.js";

import {
  createResource,
  getResourceById,
  listAllResources,
  listOwnResources,
  listPublishedResources,
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

const PUBLISHED_REVISION = {
  ...REVISION,
  id: "7e1c9c0a-3d24-4a77-a1b3-123456789abc",
  status: "PUBLISHED",
  published_at: CREATED_AT,
};

const DRAFT_REVISION = {
  ...REVISION,
  id: "9e1c9c0a-3d24-4a77-a1b3-123456789abc",
  revision_number: 2,
  title: "Advanced API Testing",
  status: "DRAFT",
};

const RESOURCE_WITH_REVISIONS = {
  ...RESOURCE,
  revisions: [DRAFT_REVISION, PUBLISHED_REVISION],
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
  const findResourceCount = vi.fn().mockResolvedValue(0);
  const findResources = vi.fn().mockResolvedValue([]);
  const findResourceById = vi.fn().mockResolvedValue(null);

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
      resource: {
        count: findResourceCount,
        findMany: findResources,
        findUnique: findResourceById,
      },
      $transaction: runTransaction,
    },
  } as unknown as ResourceServiceDependencies;

  return {
    dependencies,
    mocks: {
      findResourceCount,
      findResources,
      findResourceById,
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

describe("Resource retrieval service", () => {
  it("lists only active resources with published revisions", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceCount.mockResolvedValue(1);
    mocks.findResources.mockResolvedValue([
      {
        ...RESOURCE,
        revisions: [PUBLISHED_REVISION],
      },
    ]);

    const result = await listPublishedResources({ limit: 10, offset: 5 }, dependencies);

    expect(result.total).toBe(1);
    expect(result.resources).toHaveLength(1);

    expect(mocks.findResourceCount).toHaveBeenCalledWith({
      where: {
        archived_at: null,
        revisions: {
          some: {
            status: "PUBLISHED",
          },
        },
      },
    });

    expect(mocks.findResources).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archived_at: null,
          revisions: {
            some: {
              status: "PUBLISHED",
            },
          },
        },
        orderBy: [
          {
            created_at: "desc",
          },
          {
            id: "desc",
          },
        ],
        skip: 5,
        take: 10,
      }),
    );
  });

  it("lists only resources created by the requested owner", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceCount.mockResolvedValue(1);
    mocks.findResources.mockResolvedValue([RESOURCE_WITH_REVISIONS]);

    const result = await listOwnResources(USER_ID, { limit: 15, offset: 2 }, dependencies);

    expect(result.total).toBe(1);
    expect(result.resources).toHaveLength(1);

    expect(mocks.findResourceCount).toHaveBeenCalledWith({
      where: {
        created_by: USER_ID,
      },
    });

    expect(mocks.findResources).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_by: USER_ID,
        },
        orderBy: [
          {
            created_at: "desc",
          },
          {
            id: "desc",
          },
        ],
        skip: 2,
        take: 15,
      }),
    );
  });

  it("lists all resources without restricting ownership or archive status", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceCount.mockResolvedValue(2);
    mocks.findResources.mockResolvedValue([
      RESOURCE_WITH_REVISIONS,
      {
        ...RESOURCE,
        id: "ae1c9c0a-3d24-4a77-a1b3-123456789abc",
        archived_at: CREATED_AT,
        created_by: "be1c9c0a-3d24-4a77-a1b3-123456789abc",
        revisions: [PUBLISHED_REVISION],
      },
    ]);

    const result = await listAllResources({ limit: 20, offset: 0 }, dependencies);

    expect(result.total).toBe(2);
    expect(result.resources).toHaveLength(2);

    expect(mocks.findResourceCount).toHaveBeenCalledOnce();
    expect(mocks.findResources).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          {
            created_at: "desc",
          },
          {
            id: "desc",
          },
        ],
        skip: 0,
        take: 20,
      }),
    );

    expect(mocks.findResources.mock.calls[0]?.[0]).not.toHaveProperty("where");
  });

  it("returns only published revisions to published-only readers", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceById.mockResolvedValue(RESOURCE_WITH_REVISIONS);

    const result = await getResourceById(
      RESOURCE_ID,
      {
        userId: USER_ID,
        canReadOwn: false,
        canReadAll: false,
      },
      dependencies,
    );

    expect(result.revisions).toEqual([PUBLISHED_REVISION]);
    expect(result.revisions.every((revision) => revision.status === "PUBLISHED")).toBe(true);
  });

  it("returns all revisions to the resource owner with read.own permission", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceById.mockResolvedValue(RESOURCE_WITH_REVISIONS);

    const result = await getResourceById(
      RESOURCE_ID,
      {
        userId: USER_ID,
        canReadOwn: true,
        canReadAll: false,
      },
      dependencies,
    );

    expect(result.revisions).toEqual([DRAFT_REVISION, PUBLISHED_REVISION]);
  });

  it("does not expose another owner's drafts to a user with read.own permission", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceById.mockResolvedValue({
      ...RESOURCE_WITH_REVISIONS,
      created_by: "be1c9c0a-3d24-4a77-a1b3-123456789abc",
    });

    const result = await getResourceById(
      RESOURCE_ID,
      {
        userId: USER_ID,
        canReadOwn: true,
        canReadAll: false,
      },
      dependencies,
    );

    expect(result.revisions).toEqual([PUBLISHED_REVISION]);
  });

  it("hides archived resources from published-only readers", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceById.mockResolvedValue({
      ...RESOURCE_WITH_REVISIONS,
      archived_at: CREATED_AT,
    });

    await expect(
      getResourceById(
        RESOURCE_ID,
        {
          userId: USER_ID,
          canReadOwn: false,
          canReadAll: false,
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("allows administrators to retrieve archived resources and all revisions", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceById.mockResolvedValue({
      ...RESOURCE_WITH_REVISIONS,
      created_by: "be1c9c0a-3d24-4a77-a1b3-123456789abc",
      archived_at: CREATED_AT,
    });

    const result = await getResourceById(
      RESOURCE_ID,
      {
        userId: USER_ID,
        canReadOwn: false,
        canReadAll: true,
      },
      dependencies,
    );

    expect(result.archived_at).toEqual(CREATED_AT);
    expect(result.revisions).toEqual([DRAFT_REVISION, PUBLISHED_REVISION]);
  });

  it("throws ResourceNotFoundError when the resource does not exist", async () => {
    const { dependencies, mocks } = createMockDependencies();

    mocks.findResourceById.mockResolvedValue(null);

    await expect(
      getResourceById(
        RESOURCE_ID,
        {
          userId: USER_ID,
          canReadOwn: false,
          canReadAll: false,
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
