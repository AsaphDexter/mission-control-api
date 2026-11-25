import type { PrismaClient } from "../../generated/prisma/client.js";
import { InvalidResourceInputError, ResourceCategoryUnavailableError } from "./resource.errors.js";

export interface CreateResourceInput {
  categoryId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  externalUrl?: string | null;
}

export interface CreateResourceContext {
  userId: string;
  actorRoleSnapshot: string | null;
  requestId: string;
}

export interface ResourceServiceDependencies {
  prisma: PrismaClient;
}

function normaliseRequiredText(value: string, field: string, maximumLength?: number): string {
  const normalised = value.trim();

  if (!normalised) {
    throw new InvalidResourceInputError(`${field} cannot be empty.`);
  }

  if (maximumLength !== undefined && normalised.length > maximumLength) {
    throw new InvalidResourceInputError(`${field} cannot exceed ${maximumLength} characters.`);
  }

  return normalised;
}

function normaliseMarkdownBody(bodyMarkdown: string): string {
  if (!bodyMarkdown.trim()) {
    throw new InvalidResourceInputError("Resource body cannot be empty.");
  }

  return bodyMarkdown;
}

function normaliseExternalUrl(externalUrl: string | null | undefined): string | null {
  if (externalUrl == null || externalUrl.trim() === "") {
    return null;
  }

  const normalised = externalUrl.trim();

  if (normalised.length > 2048) {
    throw new InvalidResourceInputError("External URL cannot exceed 2048 characters.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalised);
  } catch {
    throw new InvalidResourceInputError("External URL must be a valid absolute URL.");
  }

  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username.length > 0 ||
    parsedUrl.password.length > 0
  ) {
    throw new InvalidResourceInputError(
      "External URL must use HTTP or HTTPS and cannot contain embedded credentials.",
    );
  }

  return normalised;
}

export async function createResource(
  input: CreateResourceInput,
  context: CreateResourceContext,
  dependencies: ResourceServiceDependencies,
) {
  const title = normaliseRequiredText(input.title, "Resource title", 200);
  const summary = normaliseRequiredText(input.summary, "Resource summary", 500);
  const bodyMarkdown = normaliseMarkdownBody(input.bodyMarkdown);
  const externalUrl = normaliseExternalUrl(input.externalUrl);

  return dependencies.prisma.$transaction(async (transaction) => {
    const category = await transaction.resourceCategory.findFirst({
      where: {
        id: input.categoryId,
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    if (!category) {
      throw new ResourceCategoryUnavailableError();
    }

    const resource = await transaction.resource.create({
      data: {
        created_by: context.userId,
      },
    });

    const revision = await transaction.resourceRevision.create({
      data: {
        resource_id: resource.id,
        revision_number: 1,
        category_id: category.id,
        title,
        summary,
        body_markdown: bodyMarkdown,
        external_url: externalUrl,
        status: "DRAFT",
        created_by: context.userId,
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

    await transaction.auditLog.create({
      data: {
        actor_user_id: context.userId,
        actor_role_snapshot: context.actorRoleSnapshot,
        action: "RESOURCE_CREATED",
        entity_type: "RESOURCE",
        entity_id: resource.id,
        request_id: context.requestId,
        after_data: {
          revisionId: revision.id,
          revisionNumber: revision.revision_number,
          title: revision.title,
          categoryId: category.id,
          status: revision.status,
        },
      },
    });

    return {
      resource,
      revision,
    };
  });
}
