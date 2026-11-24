import { describe, expect, it, vi } from "vitest";

import {
  InvalidResourceCategoryInputError,
  ResourceCategoryNotFoundError,
  ResourceCategorySlugConflictError,
} from "../src/modules/resources/category.errors.js";
import {
  createResourceCategory,
  getResourceCategoryById,
  listResourceCategories,
  updateResourceCategory,
  type CategoryServiceDependencies,
} from "../src/modules/resources/category.service.js";

function createMockDependencies() {
  const create = vi.fn();
  const findMany = vi.fn();
  const findUnique = vi.fn();
  const update = vi.fn();

  const dependencies = {
    prisma: {
      resourceCategory: {
        create,
        findMany,
        findUnique,
        update,
      },
    },
  } as unknown as CategoryServiceDependencies;

  return {
    dependencies,
    mocks: {
      create,
      findMany,
      findUnique,
      update,
    },
  };
}

describe("Resource category service", () => {
  describe("createResourceCategory", () => {
    it("creates a category with valid input", async () => {
      const { dependencies, mocks } = createMockDependencies();
      const created = {
        id: "cat-1",
        name: "API Testing",
        slug: "api-testing",
        description: "Guides for testing REST and GraphQL APIs",
        is_active: true,
      };
      mocks.create.mockResolvedValue(created);

      const result = await createResourceCategory(
        {
          name: "API Testing",
          slug: "api-testing",
          description: "Guides for testing REST and GraphQL APIs",
        },
        dependencies,
      );

      expect(result).toEqual(created);
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          name: "API Testing",
          slug: "api-testing",
          description: "Guides for testing REST and GraphQL APIs",
        },
      });
    });

    it("trims whitespace from category name", async () => {
      const { dependencies, mocks } = createMockDependencies();
      mocks.create.mockResolvedValue({
        id: "cat-2",
        name: "Test Automation",
        slug: "test-automation",
        description: null,
        is_active: true,
      });

      await createResourceCategory(
        {
          name: "  Test Automation  ",
          slug: "test-automation",
        },
        dependencies,
      );

      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          name: "Test Automation",
          slug: "test-automation",
          description: null,
        },
      });
    });

    it("normalises empty or whitespace-only description to null", async () => {
      const { dependencies, mocks } = createMockDependencies();
      mocks.create.mockResolvedValue({
        id: "cat-3",
        name: "Performance",
        slug: "performance",
        description: null,
        is_active: true,
      });

      await createResourceCategory(
        {
          name: "Performance",
          slug: "performance",
          description: "   ",
        },
        dependencies,
      );

      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          name: "Performance",
          slug: "performance",
          description: null,
        },
      });
    });

    it("rejects an empty or whitespace-only category name", async () => {
      const { dependencies, mocks } = createMockDependencies();

      await expect(
        createResourceCategory(
          {
            name: "   ",
            slug: "valid-slug",
          },
          dependencies,
        ),
      ).rejects.toBeInstanceOf(InvalidResourceCategoryInputError);

      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid category slug", async () => {
      const { dependencies, mocks } = createMockDependencies();

      await expect(
        createResourceCategory(
          {
            name: "Invalid Slug Category",
            slug: "Invalid_Slug!",
          },
          dependencies,
        ),
      ).rejects.toBeInstanceOf(InvalidResourceCategoryInputError);

      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("throws a conflict error when slug already exists (P2002)", async () => {
      const { dependencies, mocks } = createMockDependencies();
      mocks.create.mockRejectedValue({ code: "P2002" });

      await expect(
        createResourceCategory(
          {
            name: "Duplicate Slug",
            slug: "duplicate-slug",
          },
          dependencies,
        ),
      ).rejects.toBeInstanceOf(ResourceCategorySlugConflictError);
    });
  });

  describe("listResourceCategories", () => {
    it("returns active categories only by default", async () => {
      const { dependencies, mocks } = createMockDependencies();
      const activeCategories = [
        { id: "cat-1", name: "Accessibility", slug: "accessibility", is_active: true },
      ];
      mocks.findMany.mockResolvedValue(activeCategories);

      const result = await listResourceCategories({}, dependencies);

      expect(result).toEqual(activeCategories);
      expect(mocks.findMany).toHaveBeenCalledWith({
        where: {
          is_active: true,
        },
        orderBy: [{ name: "asc" }, { slug: "asc" }],
      });
    });

    it("returns all categories when includeInactive is true", async () => {
      const { dependencies, mocks } = createMockDependencies();
      const allCategories = [
        { id: "cat-1", name: "Accessibility", slug: "accessibility", is_active: true },
        { id: "cat-2", name: "Legacy", slug: "legacy", is_active: false },
      ];
      mocks.findMany.mockResolvedValue(allCategories);

      const result = await listResourceCategories({ includeInactive: true }, dependencies);

      expect(result).toEqual(allCategories);
      expect(mocks.findMany).toHaveBeenCalledWith({
        orderBy: [{ name: "asc" }, { slug: "asc" }],
      });
    });
  });

  describe("getResourceCategoryById", () => {
    it("returns an existing category", async () => {
      const { dependencies, mocks } = createMockDependencies();
      const category = {
        id: "cat-1",
        name: "Security",
        slug: "security",
        description: null,
        is_active: true,
      };
      mocks.findUnique.mockResolvedValue(category);

      const result = await getResourceCategoryById("cat-1", dependencies);

      expect(result).toEqual(category);
      expect(mocks.findUnique).toHaveBeenCalledWith({
        where: { id: "cat-1" },
      });
    });

    it("throws a not-found error when category does not exist", async () => {
      const { dependencies, mocks } = createMockDependencies();
      mocks.findUnique.mockResolvedValue(null);

      await expect(getResourceCategoryById("missing-id", dependencies)).rejects.toBeInstanceOf(
        ResourceCategoryNotFoundError,
      );
    });
  });

  describe("updateResourceCategory", () => {
    it("updates permitted fields and normalises values", async () => {
      const { dependencies, mocks } = createMockDependencies();
      const updated = {
        id: "cat-1",
        name: "Updated Name",
        slug: "updated-slug",
        description: null,
        is_active: false,
      };
      mocks.update.mockResolvedValue(updated);

      const result = await updateResourceCategory(
        "cat-1",
        {
          name: "  Updated Name  ",
          slug: "updated-slug",
          description: "  ",
          is_active: false,
        },
        dependencies,
      );

      expect(result).toEqual(updated);
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: "cat-1" },
        data: {
          name: "Updated Name",
          slug: "updated-slug",
          description: null,
          is_active: false,
        },
      });
    });

    it("throws a conflict error when updating to a duplicate slug (P2002)", async () => {
      const { dependencies, mocks } = createMockDependencies();
      mocks.update.mockRejectedValue({ code: "P2002" });

      await expect(
        updateResourceCategory("cat-1", { slug: "existing-slug" }, dependencies),
      ).rejects.toBeInstanceOf(ResourceCategorySlugConflictError);
    });

    it("throws a not-found error when category to update does not exist (P2025)", async () => {
      const { dependencies, mocks } = createMockDependencies();
      mocks.update.mockRejectedValue({ code: "P2025" });

      await expect(
        updateResourceCategory("missing-id", { name: "New Name" }, dependencies),
      ).rejects.toBeInstanceOf(ResourceCategoryNotFoundError);
    });
  });
});
