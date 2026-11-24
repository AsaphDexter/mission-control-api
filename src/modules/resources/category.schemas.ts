const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export const listResourceCategoriesSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      includeInactive: {
        type: "boolean",
      },
    },
  },
} as const;

export const resourceCategoryIdSchema = {
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
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      includeInactive: {
        type: "boolean",
      },
    },
  },
} as const;

export const createResourceCategorySchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name", "slug"],
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: 120,
      },
      slug: {
        type: "string",
        minLength: 1,
        maxLength: 140,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      },
      description: {
        type: ["string", "null"],
      },
    },
  },
} as const;

export const updateResourceCategorySchema = {
  ...resourceCategoryIdSchema,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: 120,
      },
      slug: {
        type: "string",
        minLength: 1,
        maxLength: 140,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      },
      description: {
        type: ["string", "null"],
      },
      isActive: {
        type: "boolean",
      },
    },
  },
} as const;
