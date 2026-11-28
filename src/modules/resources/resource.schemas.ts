const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export const listResourcesSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
      },
      offset: {
        type: "integer",
        minimum: 0,
      },
    },
  },
} as const;

export const resourceIdSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: {
        type: "string",
        pattern: UUID_PATTERN,
      },
    },
  },
} as const;

export const createResourceSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["categoryId", "title", "summary", "bodyMarkdown"],
    properties: {
      categoryId: {
        type: "string",
        pattern: UUID_PATTERN,
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
      },
      summary: {
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
      bodyMarkdown: {
        type: "string",
        minLength: 1,
      },
      externalUrl: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: 2048,
      },
    },
  },
} as const;
