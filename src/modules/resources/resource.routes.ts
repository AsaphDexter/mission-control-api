import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createResource,
  getResourceById,
  listAllResources,
  listOwnResources,
  listPublishedResources,
  type CreateResourceInput,
  type ResourcePaginationInput,
} from "./resource.service.js";
import { userHasPermissions } from "../authorization/authorization.service.js";
import {
  InvalidResourceInputError,
  ResourceCategoryUnavailableError,
  ResourceNotFoundError,
} from "./resource.errors.js";
import { createResourceSchema, listResourcesSchema, resourceIdSchema } from "./resource.schemas.js";

interface CreateResourceBody {
  categoryId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  externalUrl?: string | null;
}

interface ListResourcesQuery {
  limit?: number;
  offset?: number;
}

interface ResourceIdParams {
  id: string;
}

interface ResourceSummaryRecord {
  id: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  revisions: Array<{
    id: string;
    revision_number: number;
    title: string;
    summary: string;
    status: string;
    published_at: Date | null;
    category: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
}

function getPagination(query: ListResourcesQuery): ResourcePaginationInput {
  return {
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
  };
}

function serialiseResourceSummary(resource: ResourceSummaryRecord) {
  const revision = resource.revisions[0] ?? null;

  return {
    id: resource.id,
    createdAt: resource.created_at.toISOString(),
    updatedAt: resource.updated_at.toISOString(),
    archivedAt: resource.archived_at?.toISOString() ?? null,
    latestRevision: revision
      ? {
          id: revision.id,
          revisionNumber: revision.revision_number,
          title: revision.title,
          summary: revision.summary,
          status: revision.status,
          publishedAt: revision.published_at?.toISOString() ?? null,
          category: revision.category,
        }
      : null,
  };
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
    "The resource request contains invalid or missing fields.",
  );
}

function handleResourceError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ResourceCategoryUnavailableError) {
    return reply
      .code(422)
      .send(errorResponse(request.id, "RESOURCE_CATEGORY_UNAVAILABLE", error.message));
  }

  if (error instanceof InvalidResourceInputError) {
    return reply.code(400).send(errorResponse(request.id, "VALIDATION_ERROR", error.message));
  }

  if (error instanceof ResourceNotFoundError) {
    return reply.code(404).send(errorResponse(request.id, "RESOURCE_NOT_FOUND", error.message));
  }

  request.log.error({ err: error }, "Resource operation failed.");

  return reply
    .code(500)
    .send(
      errorResponse(
        request.id,
        "INTERNAL_SERVER_ERROR",
        "An unexpected error occurred while processing the resource request.",
      ),
    );
}

export async function resourceRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateResourceBody }>(
    "/api/v1/resources",
    {
      preHandler: [app.authenticate, app.authorize("resources.create")],
      schema: createResourceSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      const authenticatedUser = request.authenticatedUser;

      if (!authenticatedUser) {
        return reply
          .code(401)
          .send(
            errorResponse(
              request.id,
              "UNAUTHENTICATED",
              "A valid authenticated session is required.",
            ),
          );
      }

      try {
        const input: CreateResourceInput = request.body;

        const actorRoleSnapshot = authenticatedUser.roles.includes("ADMINISTRATOR")
          ? "ADMINISTRATOR"
          : authenticatedUser.roles.includes("CONTRIBUTOR")
            ? "CONTRIBUTOR"
            : null;

        const result = await createResource(
          input,
          {
            userId: authenticatedUser.id,
            actorRoleSnapshot,
            requestId: request.id,
          },
          {
            prisma: app.prisma,
          },
        );

        return reply.code(201).send({
          data: {
            resource: {
              id: result.resource.id,
              createdAt: result.resource.created_at.toISOString(),
              updatedAt: result.resource.updated_at.toISOString(),
              revision: {
                id: result.revision.id,
                revisionNumber: result.revision.revision_number,
                category: {
                  id: result.revision.category.id,
                  name: result.revision.category.name,
                  slug: result.revision.category.slug,
                },
                title: result.revision.title,
                summary: result.revision.summary,
                bodyMarkdown: result.revision.body_markdown,
                externalUrl: result.revision.external_url,
                status: result.revision.status,
                createdAt: result.revision.created_at.toISOString(),
                updatedAt: result.revision.updated_at.toISOString(),
              },
            },
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        return handleResourceError(error, request, reply);
      }
    },
  );

  app.get<{ Querystring: ListResourcesQuery }>(
    "/api/v1/resources",
    {
      preHandler: [app.authenticate, app.authorize("resources.read.published")],
      schema: listResourcesSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      try {
        const pagination = getPagination(request.query);
        const result = await listPublishedResources(pagination, {
          prisma: app.prisma,
        });

        return reply.code(200).send({
          data: {
            resources: result.resources.map(serialiseResourceSummary),
          },
          meta: {
            requestId: request.id,
            pagination: {
              ...pagination,
              total: result.total,
            },
          },
        });
      } catch (error) {
        return handleResourceError(error, request, reply);
      }
    },
  );

  app.get<{ Querystring: ListResourcesQuery }>(
    "/api/v1/resources/mine",
    {
      preHandler: [app.authenticate, app.authorize("resources.read.own")],
      schema: listResourcesSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      const user = request.authenticatedUser;

      if (!user) {
        return reply
          .code(401)
          .send(
            errorResponse(
              request.id,
              "UNAUTHENTICATED",
              "A valid authenticated session is required.",
            ),
          );
      }

      try {
        const pagination = getPagination(request.query);
        const result = await listOwnResources(user.id, pagination, {
          prisma: app.prisma,
        });

        return reply.code(200).send({
          data: {
            resources: result.resources.map(serialiseResourceSummary),
          },
          meta: {
            requestId: request.id,
            pagination: {
              ...pagination,
              total: result.total,
            },
          },
        });
      } catch (error) {
        return handleResourceError(error, request, reply);
      }
    },
  );

  app.get<{ Querystring: ListResourcesQuery }>(
    "/api/v1/resources/all",
    {
      preHandler: [app.authenticate, app.authorize("resources.read.all")],
      schema: listResourcesSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      try {
        const pagination = getPagination(request.query);
        const result = await listAllResources(pagination, {
          prisma: app.prisma,
        });

        return reply.code(200).send({
          data: {
            resources: result.resources.map(serialiseResourceSummary),
          },
          meta: {
            requestId: request.id,
            pagination: {
              ...pagination,
              total: result.total,
            },
          },
        });
      } catch (error) {
        return handleResourceError(error, request, reply);
      }
    },
  );

  app.get<{ Params: ResourceIdParams }>(
    "/api/v1/resources/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize(["resources.read.published", "resources.read.own", "resources.read.all"], {
          mode: "any",
        }),
      ],
      schema: resourceIdSchema,
      attachValidation: true,
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send(validationErrorResponse(request.id));
      }

      const user = request.authenticatedUser;

      if (!user) {
        return reply
          .code(401)
          .send(
            errorResponse(
              request.id,
              "UNAUTHENTICATED",
              "A valid authenticated session is required.",
            ),
          );
      }

      try {
        const [canReadOwn, canReadAll] = await Promise.all([
          userHasPermissions(user.id, ["resources.read.own"], { prisma: app.prisma }),
          userHasPermissions(user.id, ["resources.read.all"], { prisma: app.prisma }),
        ]);

        const resource = await getResourceById(
          request.params.id,
          {
            userId: user.id,
            canReadOwn,
            canReadAll,
          },
          {
            prisma: app.prisma,
          },
        );

        return reply.code(200).send({
          data: {
            resource: {
              id: resource.id,
              createdAt: resource.created_at.toISOString(),
              updatedAt: resource.updated_at.toISOString(),
              archivedAt: resource.archived_at?.toISOString() ?? null,
              revisions: resource.revisions.map((revision) => ({
                id: revision.id,
                revisionNumber: revision.revision_number,
                title: revision.title,
                summary: revision.summary,
                bodyMarkdown: revision.body_markdown,
                externalUrl: revision.external_url,
                status: revision.status,
                submittedAt: revision.submitted_at?.toISOString() ?? null,
                publishedAt: revision.published_at?.toISOString() ?? null,
                createdAt: revision.created_at.toISOString(),
                updatedAt: revision.updated_at.toISOString(),
                category: revision.category,
              })),
            },
          },
          meta: {
            requestId: request.id,
          },
        });
      } catch (error) {
        return handleResourceError(error, request, reply);
      }
    },
  );
}
