export class ResourceCategorySlugConflictError extends Error {
  constructor() {
    super("A resource category with this slug already exists.");
    this.name = "ResourceCategorySlugConflictError";
  }
}

export class ResourceCategoryNotFoundError extends Error {
  constructor() {
    super("The requested resource category was not found.");
    this.name = "ResourceCategoryNotFoundError";
  }
}

export class InvalidResourceCategoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResourceCategoryInputError";
  }
}
