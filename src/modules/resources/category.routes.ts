import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createResourceCategory,
  getResourceCategoryById,
  listResourceCategories,
  updateResourceCategory,
  type CreateResourceCategoryInput,
  type UpdateResourceCategoryInput,
} from "./category.service.js";

import {
  InvalidResourceCategoryInputError,
  ResourceCategoryNotFoundError,
  ResourceCategorySlugConflictError,
} from "./category.errors.js";

import {
  createResourceCategorySchema,
  listResourceCategoriesSchema,
  resourceCategoryIdSchema,
  updateResourceCategorySchema,
} from "./category.schemas.js";

interface ListCategoriesQuery {
  includeInactive?: boolean;
}

interface CategoryIdParams {
  id: string;
}

interface CreateCategoryBody {
  name: string;
  slug: string;
  description?: string | null;
}

interface UpdateCategoryBody {
  name?: string;
  slug?: string;
  description?: string | null;
  isActive?: boolean;
}

interface ResourceCategoryRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function errorResponse(requestId: string, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}

function validationErrorResponse(requestId: string) {
  return errorResponse(
    requestId,
    "VALIDATION_ERROR",
    "The resource category request contains invalid or missing fields.",
  );
}

function serialiseCategory(category: ResourceCategoryRecord) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isActive: category.is_active,
    createdAt: category.created_at.toISOString(),
    updatedAt: category.updated_at.toISOString(),
  };
}

function handleCategoryError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ResourceCategorySlugConflictError) {
    return reply
      .code(409)
      .send(errorResponse(request.id, "RESOURCE_CATEGORY_SLUG_CONFLICT", error.message));
  }

  if (error instanceof ResourceCategoryNotFoundError) {
    return reply
      .code(404)
      .send(errorResponse(request.id, "RESOURCE_CATEGORY_NOT_FOUND", error.message));
  }

  if (error instanceof InvalidResourceCategoryInputError) {
    return reply.code(400).send(errorResponse(request.id, "VALIDATION_ERROR", error.message));
  }

  request.log.error({ err: error }, "Resource category operation failed.");

  return reply
    .code(500)
    .send(
      errorResponse(
        request.id,
        "INTERNAL_SERVER_ERROR",
        "An unexpected error occurred while processing the resource category.",
      ),
    );
}

async function authorizeCategoryRead(
  app: FastifyInstance,
  request: FastifyRequest<{ Querystring: ListCategoriesQuery }>,
  reply: FastifyReply,
): Promise<void> {
  if (request.validationError) {
    return;
  }

  const includeInactive = request.query.includeInactive === true;

  const guard = includeInactive
    ? app.authorize("resources.categories.manage")
    : app.authorize(["resources.read.published", "resources.read.own", "resources.read.all"], {
        mode: "any",
      });

  await guard(request, reply);
}

export async function resourceCategoryRoutes(app: FastifyInstance): Promise<void> {
  // Create a resource category.
  app.post<{ Body: CreateCategoryBody }>(
    "/api/v1/resource-categories",
    {
      preHandler: [app.authenticate, app.authorize("resources.categories.manage")],
      schema: createResourceCategorySchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      try {
        const input: CreateResourceCategoryInput = request.body;

        const category = await createResourceCategory(input, {
          prisma: app.prisma,
        });

        return reply.code(201).send({
          data: {
            category: serialiseCategory(category),
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        return handleCategoryError(error, request, reply);
      }
    },
  );

  // List resource categories.
  app.get<{ Querystring: ListCategoriesQuery }>(
    "/api/v1/resource-categories",
    {
      preHandler: [
        app.authenticate,
        async (request, reply) => {
          await authorizeCategoryRead(app, request, reply);
        },
      ],
      schema: listResourceCategoriesSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      try {
        const categories = await listResourceCategories(
          {
            includeInactive: request.query.includeInactive === true,
          },
          {
            prisma: app.prisma,
          },
        );

        return reply.code(200).send({
          data: {
            categories: categories.map(serialiseCategory),
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        return handleCategoryError(error, request, reply);
      }
    },
  );

  // Retrieve a resource category.
  app.get<{
    Params: CategoryIdParams;
    Querystring: ListCategoriesQuery;
  }>(
    "/api/v1/resource-categories/:id",
    {
      preHandler: [
        app.authenticate,
        async (request, reply) => {
          await authorizeCategoryRead(app, request, reply);
        },
      ],
      schema: resourceCategoryIdSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      try {
        const category = await getResourceCategoryById(request.params.id, {
          prisma: app.prisma,
        });

        if (!category.is_active && request.query.includeInactive !== true) {
          throw new ResourceCategoryNotFoundError();
        }

        return reply.code(200).send({
          data: {
            category: serialiseCategory(category),
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        return handleCategoryError(error, request, reply);
      }
    },
  );

  // Update category details or change its active status.
  app.patch<{
    Params: CategoryIdParams;
    Body: UpdateCategoryBody;
  }>(
    "/api/v1/resource-categories/:id",
    {
      preHandler: [app.authenticate, app.authorize("resources.categories.manage")],
      schema: updateResourceCategorySchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      try {
        const body = request.body;

        const input: UpdateResourceCategoryInput = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isActive !== undefined ? { is_active: body.isActive } : {}),
        };

        const category = await updateResourceCategory(request.params.id, input, {
          prisma: app.prisma,
        });

        return reply.code(200).send({
          data: {
            category: serialiseCategory(category),
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        return handleCategoryError(error, request, reply);
      }
    },
  );
}
