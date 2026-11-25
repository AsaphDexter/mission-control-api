import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createResource, type CreateResourceInput } from "./resource.service.js";
import { InvalidResourceInputError, ResourceCategoryUnavailableError } from "./resource.errors.js";
import { createResourceSchema } from "./resource.schemas.js";

interface CreateResourceBody {
  categoryId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  externalUrl?: string | null;
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

  request.log.error({ err: error }, "Resource creation failed.");

  return reply
    .code(500)
    .send(
      errorResponse(
        request.id,
        "INTERNAL_SERVER_ERROR",
        "An unexpected error occurred while creating the resource.",
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
}
