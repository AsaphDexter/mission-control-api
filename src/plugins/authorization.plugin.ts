import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  userHasPermissions,
  type PermissionMatchMode,
} from "../modules/authorization/authorization.service.js";
import type { PermissionCode } from "../modules/authorization/permission-catalog.js";

export interface AuthorizationGuardOptions {
  mode?: PermissionMatchMode;
}

export type AuthorizationGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyInstance {
    authorize: (
      permissions: PermissionCode | readonly PermissionCode[],
      options?: AuthorizationGuardOptions,
    ) => AuthorizationGuard;
  }
}

function authorizationError(requestId: string, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}

export function registerAuthorization(app: FastifyInstance): void {
  app.decorate(
    "authorize",
    (
      permissions: PermissionCode | readonly PermissionCode[],
      options: AuthorizationGuardOptions = {},
    ): AuthorizationGuard => {
      const requiredPermissions =
        typeof permissions === "string" ? [permissions] : [...permissions];

      if (requiredPermissions.length === 0) {
        throw new Error("An authorization guard requires at least one permission.");
      }

      const mode = options.mode ?? "all";

      return async (request, reply): Promise<void> => {
        const authenticatedUser = request.authenticatedUser;

        if (!authenticatedUser) {
          reply
            .code(401)
            .send(
              authorizationError(
                request.id,
                "UNAUTHENTICATED",
                "A valid bearer access token is required.",
              ),
            );
          return;
        }

        try {
          const authorized = await userHasPermissions(
            authenticatedUser.id,
            requiredPermissions,
            {
              prisma: app.prisma,
            },
            mode,
          );

          if (!authorized) {
            reply
              .code(403)
              .send(
                authorizationError(
                  request.id,
                  "FORBIDDEN",
                  "You do not have permission to perform this operation.",
                ),
              );
          }
        } catch (error) {
          request.log.error(
            { err: error, userId: authenticatedUser.id },
            "Authorization check failed.",
          );

          reply
            .code(503)
            .send(
              authorizationError(
                request.id,
                "AUTHORIZATION_UNAVAILABLE",
                "Authorization is temporarily unavailable.",
              ),
            );
        }
      };
    },
  );
}
