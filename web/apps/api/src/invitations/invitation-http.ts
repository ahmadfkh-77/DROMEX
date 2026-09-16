import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { FORBIDDEN, INTERNAL_ERROR, UNAUTHORIZED, errorName } from '../auth/http.ts';
import type { AdminInvitationService, InvitationResult } from './admin-invitations.ts';

/**
 * The Owner's Admin invitation routes (DEC-440). Each is classified `owner`,
 * so the authentication guard admits only a fully authenticated,
 * MFA-complete Owner session and, for POST, a trusted Origin; the service
 * then checks the Owner again inside its own transaction (DEC-428).
 *
 * Responses carry only the safe invitation view. No token, hash, link,
 * delivery id, idempotency key, provider id, or message content is ever
 * returned, and failures are fixed codes.
 */

export const OWNER_INVITATIONS_PATH = '/api/owner/invitations';

const BODY_LIMIT = 1024;
const STATUS: Record<Exclude<InvitationResult, { ok: true }>['error'], number> = {
  forbidden: 403,
  invalid_email: 400,
  account_exists: 409,
  invitation_pending: 409,
  invitation_not_pending: 409,
  not_found: 404,
  rate_limited: 429,
};

/** Exactly `{ email }` and nothing else; anything else is treated as no email. */
function emailFrom(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === 'email' ? (body as { email: unknown }).email : undefined;
}

function actorOf(request: FastifyRequest) {
  const identity = request.dromexIdentity;
  return identity === null ? null : { userId: identity.user.id, name: identity.user.name };
}

function send(reply: FastifyReply, result: InvitationResult, successStatus: number): FastifyReply {
  if (result.ok) return reply.code(successStatus).send({ invitation: result.invitation });
  if (result.error === 'rate_limited') {
    reply.header('retry-after', String(Math.min(result.retryAfterSeconds, 24 * 60 * 60)));
    return reply.code(429).send({ error: 'too_many_requests' });
  }
  if (result.error === 'forbidden') return reply.code(403).send(FORBIDDEN);
  return reply.code(STATUS[result.error]).send({ error: result.error });
}

export function registerInvitationRoutes(app: FastifyInstance, service: AdminInvitationService): void {
  const failed = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    request.log.error({ errorName: errorName(error) }, 'invitation operation failed');
    return reply.code(500).send(INTERNAL_ERROR);
  };

  app.get(OWNER_INVITATIONS_PATH, { config: { access: 'owner' } }, async (request, reply) => {
    const actor = actorOf(request);
    if (actor === null) return reply.code(401).send(UNAUTHORIZED);
    try {
      const result = await service.list(actor);
      return result.ok ? reply.send({ invitations: result.invitations }) : reply.code(403).send(FORBIDDEN);
    } catch (error) {
      return failed(request, reply, error);
    }
  });

  app.post(OWNER_INVITATIONS_PATH, { config: { access: 'owner' }, bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const actor = actorOf(request);
    if (actor === null) return reply.code(401).send(UNAUTHORIZED);
    try {
      return send(reply, await service.create(actor, emailFrom(request.body), request.ip), 201);
    } catch (error) {
      return failed(request, reply, error);
    }
  });

  for (const action of ['resend', 'cancel'] as const) {
    app.post<{ Params: { id: string } }>(
      `${OWNER_INVITATIONS_PATH}/:id/${action}`,
      { config: { access: 'owner' }, bodyLimit: BODY_LIMIT },
      async (request, reply) => {
        const actor = actorOf(request);
        if (actor === null) return reply.code(401).send(UNAUTHORIZED);
        try {
          const result = await service[action](actor, request.params.id, request.ip);
          return send(reply, result, 200);
        } catch (error) {
          return failed(request, reply, error);
        }
      },
    );
  }
}
