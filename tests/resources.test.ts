import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createAccessToken } from "../src/modules/auth/security/access-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const TEST_SESSION_ID = "f13c9c0a-3d24-4a77-a1b3-123456789abc";
const CATEGORY_ID = "3e1c9c0a-3d24-4a77-a1b3-123456789abc";
const RESOURCE_ID = "5e1c9c0a-3d24-4a77-a1b3-123456789abc";
const REVISION_ID = "6e1c9c0a-3d24-4a77-a1b3-123456789abc";

const TEST_JWT_KEY = Buffer.alloc(32, 0x73);
const TEST_JWT_SECRET = TEST_JWT_KEY.toString("base64url");

const CREATED_AT = new Date("2026-11-25T10:00:00.000Z");

const findUser = vi.fn();
const findActiveSessionToken = vi.fn();
const findRolePermissions = vi.fn();

const findResourceCount = vi.fn();
const findResources = vi.fn();
const findResourceById = vi.fn();

const findActiveCategory = vi.fn();
const createResourceRecord = vi.fn();
const createRevisionRecord = vi.fn();
const createAuditRecord = vi.fn();
const runTransaction = vi.fn();

const disconnect = vi.fn();

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

const prismaMock = {
  user: {
    findUnique: findUser,
  },
  refreshToken: {
    findFirst: findActiveSessionToken,
  },
  rolePermission: {
    findMany: findRolePermissions,
  },
  resource: {
    count: findResourceCount,
    findMany: findResources,
    findUnique: findResourceById,
  },
  $transaction: runTransaction,
  $disconnect: disconnect,
} as unknown as PrismaClient;

const CATEGORY = {
  id: CATEGORY_ID,
  name: "API Testing",
  slug: "api-testing",
};

const RESOURCE = {
  id: RESOURCE_ID,
  created_by: TEST_USER_ID,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  archived_at: null,
};

const REVISION = {
  id: REVISION_ID,
  resource_id: RESOURCE_ID,
  revision_number: 1,
  category_id: CATEGORY_ID,
  title: "Introduction to API Testing",
  summary: "A practical introduction.",
  body_markdown: "# Introduction\n\nTest REST APIs.\n",
  external_url: null,
  status: "DRAFT",
  created_by: TEST_USER_ID,
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

const VALID_PAYLOAD = {
  categoryId: CATEGORY_ID,
  title: "Introduction to API Testing",
  summary: "A practical introduction.",
  bodyMarkdown: "# Introduction\n\nTest REST APIs.\n",
};

function activeUser(role = "CONTRIBUTOR") {
  return {
    id: TEST_USER_ID,
    email: "contributor@example.com",
    first_name: "Amina",
    last_name: "Okafor",
    display_name: "Amina",
    status: "ACTIVE",
    auth_version: 1,
    email_verified_at: CREATED_AT,
    user_roles: [
      {
        role: {
          code: role,
        },
      },
    ],
  };
}

let previousJwtSecret: string | undefined;

describe("Resource HTTP routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    previousJwtSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  });

  afterAll(() => {
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = previousJwtSecret;
    }
  });

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;

    findUser.mockReset().mockResolvedValue(activeUser());

    findActiveSessionToken.mockReset().mockResolvedValue({
      id: "test-refresh-token-id",
    });

    findRolePermissions.mockReset().mockResolvedValue([]);

    findResourceCount.mockReset().mockResolvedValue(0);
    findResources.mockReset().mockResolvedValue([]);
    findResourceById.mockReset().mockResolvedValue(RESOURCE_WITH_REVISIONS);

    findActiveCategory.mockReset().mockResolvedValue(CATEGORY);
    createResourceRecord.mockReset().mockResolvedValue(RESOURCE);
    createRevisionRecord.mockReset().mockResolvedValue(REVISION);
    createAuditRecord.mockReset().mockResolvedValue({
      id: "audit-001",
    });

    runTransaction
      .mockReset()
      .mockImplementation(
        async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      );

    disconnect.mockReset().mockResolvedValue(undefined);

    app = buildApp({
      logger: false,
      prisma: prismaMock,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function makeAccessToken(): Promise<string> {
    return createAccessToken(TEST_USER_ID, 1, TEST_SESSION_ID);
  }

  function grantPermissions(...codes: string[]): void {
    findRolePermissions.mockResolvedValue(
      codes.map((code) => ({
        permission: {
          code,
        },
      })),
    );
  }

  function expectError(
    response: {
      statusCode: number;
      json: () => {
        error: {
          code: string;
          requestId: string;
        };
      };
    },
    statusCode: number,
    code: string,
  ): void {
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({
      error: {
        code,
        requestId: expect.any(String),
      },
    });
  }

  it("rejects unauthenticated resource creation with HTTP 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      payload: VALID_PAYLOAD,
    });

    expect(response.statusCode).toBe(401);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects resource creation without resources.create permission", async () => {
    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expectError(response, 403, "FORBIDDEN");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects a learner without resource creation permission", async () => {
    findUser.mockResolvedValue(activeUser("LEARNER"));

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expectError(response, 403, "FORBIDDEN");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("creates a resource for an authorised contributor", async () => {
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expect(response.statusCode).toBe(201);

    expect(response.json()).toMatchObject({
      data: {
        resource: {
          id: RESOURCE_ID,
          revision: {
            id: REVISION_ID,
            revisionNumber: 1,
            title: VALID_PAYLOAD.title,
            summary: VALID_PAYLOAD.summary,
            bodyMarkdown: VALID_PAYLOAD.bodyMarkdown,
            externalUrl: null,
            status: "DRAFT",
            category: {
              id: CATEGORY_ID,
              name: "API Testing",
              slug: "api-testing",
            },
          },
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });

    expect(runTransaction).toHaveBeenCalledOnce();
    expect(findActiveCategory).toHaveBeenCalledOnce();
    expect(createResourceRecord).toHaveBeenCalledOnce();
    expect(createRevisionRecord).toHaveBeenCalledOnce();
    expect(createAuditRecord).toHaveBeenCalledOnce();
  });

  it("allows an authorised administrator to create a resource", async () => {
    findUser.mockResolvedValue(activeUser("ADMINISTRATOR"));
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expect(response.statusCode).toBe(201);
  });

  it("returns HTTP 400 for a malformed category UUID", async () => {
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        ...VALID_PAYLOAD,
        categoryId: "not-a-uuid",
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects unknown request properties", async () => {
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        ...VALID_PAYLOAD,
        createdBy: "another-user",
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects a request with missing required fields", async () => {
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        categoryId: CATEGORY_ID,
        title: VALID_PAYLOAD.title,
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("returns HTTP 422 when the selected category is inactive or unavailable", async () => {
    grantPermissions("resources.create");
    findActiveCategory.mockResolvedValue(null);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expectError(response, 422, "RESOURCE_CATEGORY_UNAVAILABLE");
    expect(createResourceRecord).not.toHaveBeenCalled();
    expect(createRevisionRecord).not.toHaveBeenCalled();
    expect(createAuditRecord).not.toHaveBeenCalled();
  });

  it("returns HTTP 400 when the external URL is invalid", async () => {
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        ...VALID_PAYLOAD,
        externalUrl: "javascript:alert(1)",
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("returns HTTP 400 for a whitespace-only Markdown body", async () => {
    grantPermissions("resources.create");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        ...VALID_PAYLOAD,
        bodyMarkdown: "   ",
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("returns HTTP 500 when resource persistence fails", async () => {
    grantPermissions("resources.create");
    createResourceRecord.mockRejectedValue(new Error("Database unavailable"));

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expectError(response, 500, "INTERNAL_SERVER_ERROR");
  });

  it("returns HTTP 500 when the audit record cannot be created", async () => {
    grantPermissions("resources.create");
    createAuditRecord.mockRejectedValue(new Error("Audit insert failed"));

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: VALID_PAYLOAD,
    });

    expectError(response, 500, "INTERNAL_SERVER_ERROR");

    expect(createResourceRecord).toHaveBeenCalledOnce();
    expect(createRevisionRecord).toHaveBeenCalledOnce();
    expect(createAuditRecord).toHaveBeenCalledOnce();
  });

  it("lists published resources with pagination and exposes only published revisions", async () => {
    grantPermissions("resources.read.published");

    findResourceCount.mockResolvedValue(1);
    findResources.mockResolvedValue([
      {
        ...RESOURCE_WITH_REVISIONS,
        revisions: [PUBLISHED_REVISION],
      },
    ]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resources?limit=10&offset=5",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.data.resources).toHaveLength(1);
    expect(body.data.resources[0]).toMatchObject({
      id: RESOURCE_ID,
      latestRevision: {
        id: PUBLISHED_REVISION.id,
        revisionNumber: 1,
        title: PUBLISHED_REVISION.title,
        status: "PUBLISHED",
      },
    });

    expect(body.data.resources[0].latestRevision.status).not.toBe("DRAFT");
    expect(body.meta.pagination).toEqual({
      limit: 10,
      offset: 5,
      total: 1,
    });

    expect(findResources).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 10,
      }),
    );
  });

  it("rejects published-resource listing without read permission", async () => {
    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resources",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 403, "FORBIDDEN");

    expect(findResourceCount).not.toHaveBeenCalled();
    expect(findResources).not.toHaveBeenCalled();
  });

  it("lists the authenticated contributor's own resources, including drafts", async () => {
    grantPermissions("resources.read.own");

    findResourceCount.mockResolvedValue(1);
    findResources.mockResolvedValue([RESOURCE_WITH_REVISIONS]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resources/mine?limit=15&offset=2",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.data.resources).toHaveLength(1);
    expect(body.data.resources[0]).toMatchObject({
      id: RESOURCE_ID,
      latestRevision: {
        id: DRAFT_REVISION.id,
        title: "Advanced API Testing",
        status: "DRAFT",
      },
    });

    expect(body.meta.pagination).toEqual({
      limit: 15,
      offset: 2,
      total: 1,
    });

    expect(findResources).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_by: TEST_USER_ID,
        },
        skip: 2,
        take: 15,
      }),
    );
  });

  it("allows administrators to list resources across all owners", async () => {
    findUser.mockResolvedValue(activeUser("ADMINISTRATOR"));
    grantPermissions("resources.read.all");

    const otherUserResourceId = "ae1c9c0a-3d24-4a77-a1b3-123456789abc";

    findResourceCount.mockResolvedValue(2);
    findResources.mockResolvedValue([
      RESOURCE_WITH_REVISIONS,
      {
        ...RESOURCE,
        id: otherUserResourceId,
        created_by: "be1c9c0a-3d24-4a77-a1b3-123456789abc",
        archived_at: CREATED_AT,
        revisions: [
          {
            ...PUBLISHED_REVISION,
            id: "ce1c9c0a-3d24-4a77-a1b3-123456789abc",
            resource_id: otherUserResourceId,
          },
        ],
      },
    ]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resources/all",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.data.resources).toHaveLength(2);
    expect(body.data.resources.map((resource: { id: string }) => resource.id)).toEqual([
      RESOURCE_ID,
      otherUserResourceId,
    ]);

    expect(body.data.resources[1].archivedAt).toBe(CREATED_AT.toISOString());

    expect(findResources).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );

    expect(findResources.mock.calls[0]?.[0]).not.toHaveProperty("where");
  });

  it("returns only published revisions to published-only readers", async () => {
    grantPermissions("resources.read.published");
    findResourceById.mockResolvedValue(RESOURCE_WITH_REVISIONS);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resources/${RESOURCE_ID}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    const revisions = body.data.resource.revisions;

    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      id: PUBLISHED_REVISION.id,
      title: PUBLISHED_REVISION.title,
      status: "PUBLISHED",
    });

    expect(revisions.some((revision: { status: string }) => revision.status === "DRAFT")).toBe(
      false,
    );
  });

  it("allows resource owners with read.own permission to see all revisions", async () => {
    grantPermissions("resources.read.own");
    findResourceById.mockResolvedValue(RESOURCE_WITH_REVISIONS);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resources/${RESOURCE_ID}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    const revisions = body.data.resource.revisions;

    expect(revisions).toHaveLength(2);
    expect(revisions.map((revision: { status: string }) => revision.status)).toEqual([
      "DRAFT",
      "PUBLISHED",
    ]);
  });

  it("hides another contributor's unpublished resource from an ordinary owner", async () => {
    grantPermissions("resources.read.own");

    findResourceById.mockResolvedValue({
      ...RESOURCE_WITH_REVISIONS,
      created_by: "be1c9c0a-3d24-4a77-a1b3-123456789abc",
      revisions: [DRAFT_REVISION],
    });

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resources/${RESOURCE_ID}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 404, "RESOURCE_NOT_FOUND");
  });

  it("returns HTTP 404 when the requested resource does not exist", async () => {
    grantPermissions("resources.read.published");
    findResourceById.mockResolvedValue(null);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resources/${RESOURCE_ID}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 404, "RESOURCE_NOT_FOUND");
  });

  it("allows administrators to inspect all revisions across resource owners", async () => {
    findUser.mockResolvedValue(activeUser("ADMINISTRATOR"));
    grantPermissions("resources.read.all");

    findResourceById.mockResolvedValue({
      ...RESOURCE_WITH_REVISIONS,
      created_by: "be1c9c0a-3d24-4a77-a1b3-123456789abc",
    });

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resources/${RESOURCE_ID}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    const revisions = response.json().data.resource.revisions;

    expect(revisions).toHaveLength(2);
    expect(revisions.map((revision: { status: string }) => revision.status)).toEqual([
      "DRAFT",
      "PUBLISHED",
    ]);
  });

  it("rejects malformed resource IDs", async () => {
    grantPermissions("resources.read.published");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resources/not-a-valid-uuid",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(findResourceById).not.toHaveBeenCalled();
  });
});
