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
});
