import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createAccessToken } from "../src/modules/auth/security/access-token.js";

const TEST_USER_ID = "8e1c9c0a-3d24-4a77-a1b3-123456789abc";
const TEST_SESSION_ID = "f13c9c0a-3d24-4a77-a1b3-123456789abc";

const TEST_JWT_KEY = Buffer.alloc(32, 0x73);
const TEST_JWT_SECRET = TEST_JWT_KEY.toString("base64url");

const findUser = vi.fn();
const findActiveSessionToken = vi.fn();
const findRolePermissions = vi.fn();

const createCategory = vi.fn();
const findCategories = vi.fn();
const findCategory = vi.fn();
const updateCategory = vi.fn();

const disconnect = vi.fn();

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
  resourceCategory: {
    create: createCategory,
    findMany: findCategories,
    findUnique: findCategory,
    update: updateCategory,
  },
  $disconnect: disconnect,
} as unknown as PrismaClient;

const ACTIVE_CATEGORY = {
  id: "3e1c9c0a-3d24-4a77-a1b3-123456789abc",
  name: "Automation Testing",
  slug: "automation-testing",
  description: "Resources about automation testing.",
  is_active: true,
  created_at: new Date("2026-11-01T10:00:00.000Z"),
  updated_at: new Date("2026-11-01T10:00:00.000Z"),
};

const INACTIVE_CATEGORY = {
  ...ACTIVE_CATEGORY,
  id: "4e1c9c0a-3d24-4a77-a1b3-123456789abc",
  name: "Legacy Testing",
  slug: "legacy-testing",
  is_active: false,
};

function activeUser() {
  return {
    id: TEST_USER_ID,
    email: "amina@example.com",
    first_name: "Amina",
    last_name: "Okafor",
    display_name: "Amina",
    status: "ACTIVE",
    auth_version: 1,
    email_verified_at: new Date("2026-11-01T10:00:00.000Z"),
    user_roles: [
      {
        role: {
          code: "LEARNER",
        },
      },
    ],
  };
}

let previousJwtSecret: string | undefined;

describe("Resource category HTTP routes", () => {
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

    findActiveSessionToken.mockReset().mockResolvedValue({ id: "test-refresh-token-id" });

    findRolePermissions.mockReset().mockResolvedValue([]);

    createCategory.mockReset();
    findCategories.mockReset().mockResolvedValue([]);
    findCategory.mockReset().mockResolvedValue(null);
    updateCategory.mockReset();

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

  it("rejects unauthenticated category creation with HTTP 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resource-categories",
      payload: {
        name: "Automation Testing",
        slug: "automation-testing",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("rejects category creation without management permission", async () => {
    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resource-categories",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Automation Testing",
        slug: "automation-testing",
      },
    });

    expectError(response, 403, "FORBIDDEN");
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("creates a category for an authorised administrator", async () => {
    grantPermissions("resources.categories.manage");
    createCategory.mockResolvedValue(ACTIVE_CATEGORY);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resource-categories",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Automation Testing",
        slug: "automation-testing",
        description: "Resources about automation testing.",
      },
    });

    expect(response.statusCode).toBe(201);

    expect(response.json().data.category).toMatchObject({
      id: ACTIVE_CATEGORY.id,
      name: ACTIVE_CATEGORY.name,
      slug: ACTIVE_CATEGORY.slug,
      isActive: true,
    });

    expect(createCategory).toHaveBeenCalledOnce();
  });

  it("rejects an invalid category slug", async () => {
    grantPermissions("resources.categories.manage");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resource-categories",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Automation Testing",
        slug: "Automation Testing",
      },
    });

    expectError(response, 400, "VALIDATION_ERROR");
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("returns HTTP 409 when the category slug already exists", async () => {
    grantPermissions("resources.categories.manage");

    createCategory.mockRejectedValue({
      code: "P2002",
    });

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/resource-categories",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Automation Testing",
        slug: "automation-testing",
      },
    });

    expectError(response, 409, "RESOURCE_CATEGORY_SLUG_CONFLICT");
  });

  it("lists active categories for an authenticated resource reader", async () => {
    grantPermissions("resources.read.published");

    findCategories.mockResolvedValue([ACTIVE_CATEGORY]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resource-categories",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json().data.categories).toHaveLength(1);

    expect(findCategories).toHaveBeenCalledWith({
      where: {
        is_active: true,
      },
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    });
  });

  it("prevents ordinary readers from requesting inactive categories", async () => {
    grantPermissions("resources.read.published");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resource-categories?includeInactive=true",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 403, "FORBIDDEN");
    expect(findCategories).not.toHaveBeenCalled();
  });

  it("allows administrators to list inactive categories", async () => {
    grantPermissions("resources.categories.manage");

    findCategories.mockResolvedValue([ACTIVE_CATEGORY, INACTIVE_CATEGORY]);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resource-categories?includeInactive=true",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.categories).toHaveLength(2);

    expect(findCategories).toHaveBeenCalledWith({
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    });
  });

  it("retrieves an existing category", async () => {
    grantPermissions("resources.read.published");

    findCategory.mockResolvedValue(ACTIVE_CATEGORY);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resource-categories/${ACTIVE_CATEGORY.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.category.slug).toBe(ACTIVE_CATEGORY.slug);
  });

  it("returns HTTP 404 when a category does not exist", async () => {
    grantPermissions("resources.read.published");

    findCategory.mockResolvedValue(null);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resource-categories/${ACTIVE_CATEGORY.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 404, "RESOURCE_CATEGORY_NOT_FOUND");
  });

  it("does not expose inactive categories through individual retrieval", async () => {
    grantPermissions("resources.read.published");

    findCategory.mockResolvedValue(INACTIVE_CATEGORY);

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/resource-categories/${INACTIVE_CATEGORY.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 404, "RESOURCE_CATEGORY_NOT_FOUND");
  });

  it("updates a category for an authorised administrator", async () => {
    grantPermissions("resources.categories.manage");

    updateCategory.mockResolvedValue({
      ...ACTIVE_CATEGORY,
      name: "Software Quality Assurance",
      is_active: false,
    });

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/resource-categories/${ACTIVE_CATEGORY.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Software Quality Assurance",
        isActive: false,
      },
    });

    expect(response.statusCode).toBe(200);

    expect(updateCategory).toHaveBeenCalledWith({
      where: {
        id: ACTIVE_CATEGORY.id,
      },
      data: {
        name: "Software Quality Assurance",
        is_active: false,
      },
    });

    expect(response.json().data.category.isActive).toBe(false);
  });

  it("rejects category updates without management permission", async () => {
    grantPermissions("resources.read.published");

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/resource-categories/${ACTIVE_CATEGORY.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Unauthorised Update",
      },
    });

    expectError(response, 403, "FORBIDDEN");
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("returns HTTP 404 when updating a category that does not exist", async () => {
    grantPermissions("resources.categories.manage");

    updateCategory.mockRejectedValue({
      code: "P2025",
    });

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/resource-categories/${ACTIVE_CATEGORY.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: "Updated Category",
      },
    });

    expectError(response, 404, "RESOURCE_CATEGORY_NOT_FOUND");
  });

  it("returns HTTP 500 when the category database operation fails", async () => {
    grantPermissions("resources.read.published");

    findCategories.mockRejectedValue(new Error("Database unavailable"));

    const token = await makeAccessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/resource-categories",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expectError(response, 500, "INTERNAL_SERVER_ERROR");
  });
});
