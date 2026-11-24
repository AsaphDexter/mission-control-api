import type { PrismaClient } from "../../generated/prisma/client.js";
import {
  InvalidResourceCategoryInputError,
  ResourceCategoryNotFoundError,
  ResourceCategorySlugConflictError,
} from "./category.errors.js";

export interface CategoryServiceDependencies {
  prisma: PrismaClient;
}

export interface CreateResourceCategoryInput {
  name: string;
  slug: string;
  description?: string | null;
}

export interface UpdateResourceCategoryInput {
  name?: string;
  slug?: string;
  description?: string | null;
  is_active?: boolean;
}

export interface ListResourceCategoriesInput {
  includeInactive?: boolean;
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function normaliseName(name: string): string {
  const normalised = name.trim();

  if (!normalised) {
    throw new InvalidResourceCategoryInputError("Category name cannot be empty.");
  }

  return normalised;
}

function normaliseSlug(slug: string): string {
  const normalised = slug.trim();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalised)) {
    throw new InvalidResourceCategoryInputError(
      "Category slug must contain lowercase letters, numbers and single hyphens only.",
    );
  }

  return normalised;
}

function normaliseDescription(description: string | null | undefined): string | null {
  if (description == null) {
    return null;
  }

  return description.trim() || null;
}

export async function createResourceCategory(
  input: CreateResourceCategoryInput,
  dependencies: CategoryServiceDependencies,
) {
  const data = {
    name: normaliseName(input.name),
    slug: normaliseSlug(input.slug),
    description: normaliseDescription(input.description),
  };

  try {
    return await dependencies.prisma.resourceCategory.create({
      data,
    });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      throw new ResourceCategorySlugConflictError();
    }

    throw error;
  }
}

export async function listResourceCategories(
  input: ListResourceCategoriesInput,
  dependencies: CategoryServiceDependencies,
) {
  return dependencies.prisma.resourceCategory.findMany({
    ...(!input.includeInactive && {
      where: {
        is_active: true,
      },
    }),
    orderBy: [{ name: "asc" }, { slug: "asc" }],
  });
}

export async function getResourceCategoryById(
  id: string,
  dependencies: CategoryServiceDependencies,
) {
  const category = await dependencies.prisma.resourceCategory.findUnique({
    where: {
      id,
    },
  });

  if (!category) {
    throw new ResourceCategoryNotFoundError();
  }

  return category;
}

export async function updateResourceCategory(
  id: string,
  input: UpdateResourceCategoryInput,
  dependencies: CategoryServiceDependencies,
) {
  const data: {
    name?: string;
    slug?: string;
    description?: string | null;
    is_active?: boolean;
  } = {};

  if (input.name !== undefined) {
    data.name = normaliseName(input.name);
  }

  if (input.slug !== undefined) {
    data.slug = normaliseSlug(input.slug);
  }

  if (input.description !== undefined) {
    data.description = normaliseDescription(input.description);
  }

  if (input.is_active !== undefined) {
    data.is_active = input.is_active;
  }

  try {
    return await dependencies.prisma.resourceCategory.update({
      where: {
        id,
      },
      data,
    });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      throw new ResourceCategorySlugConflictError();
    }

    if (hasPrismaErrorCode(error, "P2025")) {
      throw new ResourceCategoryNotFoundError();
    }

    throw error;
  }
}
