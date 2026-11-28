export class ResourceNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "ResourceNotFoundError";
  }
}

export class ResourceCategoryUnavailableError extends Error {
  constructor() {
    super("The selected resource category does not exist or is inactive.");
    this.name = "ResourceCategoryUnavailableError";
  }
}

export class InvalidResourceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResourceInputError";
  }
}
