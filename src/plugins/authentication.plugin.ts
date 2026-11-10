import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  AccessTokenConfigurationError,
  verifyAccessToken,
} from "../modules/auth/security/access-token.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  authVersion: number;
  roles: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

function sendAuthenticationError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
): void {
  reply.code(statusCode).send({
    error: {
      code,
      message,
      requestId,
    },
  });
}

export function registerAuthentication(
  app: FastifyInstance,
): void {
  app.decorateRequest("authenticatedUser", null);

  app.decorate(
    "authenticate",
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const authorization = request.headers.authorization;

      const match = authorization
        ? /^Bearer\s+(\S+)$/i.exec(authorization)
        : null;

const accessToken = match?.[1];

if (!accessToken) {
  sendAuthenticationError(
    reply,
    request.id,
    401,
    "UNAUTHENTICATED",
    "A valid bearer access token is required.",
  );
  return;
}

      let claims;

      try {
        claims = await verifyAccessToken(accessToken);
      } catch (error) {
        if (error instanceof AccessTokenConfigurationError) {
          request.log.error(
            { err: error },
            "Access-token configuration is invalid.",
          );

          sendAuthenticationError(
            reply,
            request.id,
            503,
            "SERVICE_UNAVAILABLE",
            "Authentication is temporarily unavailable.",
          );
          return;
        }

        sendAuthenticationError(
          reply,
          request.id,
          401,
          "INVALID_ACCESS_TOKEN",
          "The access token is invalid or expired.",
        );
        return;
      }

      let user;

      try {
        user = await app.prisma.user.findUnique({
          where: {
            id: claims.userId,
          },
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            display_name: true,
            status: true,
            auth_version: true,
            email_verified_at: true,
            user_roles: {
              where: {
                revoked_at: null,
              },
              select: {
                role: {
                  select: {
                    code: true,
                  },
                },
              },
            },
          },
        });
      } catch (error) {
        request.log.error(
          { err: error },
          "Could not validate the authenticated account.",
        );

        sendAuthenticationError(
          reply,
          request.id,
          503,
          "SERVICE_UNAVAILABLE",
          "Authentication is temporarily unavailable.",
        );
        return;
      }

      if (
        !user ||
        user.status !== "ACTIVE" ||
        user.email_verified_at === null ||
        user.auth_version !== claims.authVersion
      ) {
        sendAuthenticationError(
          reply,
          request.id,
          401,
          "SESSION_INVALID",
          "The account session is no longer valid. Please authenticate again.",
        );
        return;
      }

      request.authenticatedUser = {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        displayName: user.display_name,
        authVersion: user.auth_version,
        roles: user.user_roles.map(
          (userRole) => userRole.role.code,
        ),
      };
    },
  );
}