import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { FORBIDDEN, INTERNAL_ERROR, UNAUTHORIZED, errorName } from '../auth/http.ts';
import type { AccountRefusalCode, AccountResult, AdminAccountService } from './admin-accounts.ts';

/**
 * The Owner's account-management routes (checkpoint 4E). Each is classified
 * `owner`, so the authentication guard admits only a fully authenticated,
 * MFA-complete Owner session and, for POST, a trusted Origin, and audits any
 * other authenticated caller it refuses; the service then checks the Owner
 * again (DEC-428).
 *
 * Responses carry only the safe account views and fixed error codes, and are
 * never cached. A status change takes exactly `{ reason }`; a revocation takes
 * an empty body. Anything else is refused before the service runs.
 */

export const OWNER_ACCOUNTS_PATH = '/api/owner/accounts';

/** A reason is at most 500 characters; this leaves room for JSON and 4-byte characters. */
const BODY_LIMIT = 4096;

const STATUS: Record<AccountRefusalCode, number> = {
  forbidden: 403,
  not_found: 404,
  session_not_found: 404,
  invalid_reason: 400,
  owner_protected: 409,
  account_not_active: 409,
  account_not_disabled: 409,
};

type Params = { userId: string; sessionRef?: string };

function actorOf(request: FastifyRequest) {
  const identity = request.dromexIdentity;
  return identity === null ? null : { userId: identity.user.id, name: identity.user.name };
}

/** Exactly `{ reason }`; anything else is treated as no reason, which the service refuses and audits. */
function reasonFrom(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === 'reason' ? (body as { reason: unknown }).reason : undefined;
}

/** No body, or an empty JSON object. */
function isEmptyBody(body: unknown): boolean {
  return body === undefined || body === null || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);
}

function send(reply: FastifyReply, result: AccountResult): FastifyReply {
  if (result.ok) return reply.code(200).send({ account: result.account });
  if (result.error === 'forbidden') return reply.code(403).send(FORBIDDEN);
  return reply.code(STATUS[result.error]).send({ error: result.error });
}

export function registerAccountRoutes(app: FastifyInstance, service: AdminAccountService): void {
  const failed = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    request.log.error({ errorName: errorName(error) }, 'account operation failed');
    return reply.code(500).send(INTERNAL_ERROR);
  };

  /** Registers one Owner route whose every response is marked uncacheable. */
  function route(
    method: 'GET' | 'POST',
    url: string,
    handler: (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply, actor: { userId: string; name: string }) => Promise<unknown>,
  ): void {
    app.route<{ Params: Params }>({
      method,
      url,
      config: { access: 'owner' },
      ...(method === 'POST' ? { bodyLimit: BODY_LIMIT } : {}),
      onSend: async (_request, reply, payload) => {
        reply.header('cache-control', 'no-store');
        return payload;
      },
      handler: async (request, reply) => {
        const actor = actorOf(request);
        if (actor === null) return reply.code(401).send(UNAUTHORIZED);
        try {
          return await handler(request, reply, actor);
        } catch (error) {
          return failed(request, reply, error);
        }
      },
    });
  }

  route('GET', OWNER_ACCOUNTS_PATH, async (_request, reply, actor) => {
    const result = await service.list(actor);
    return result.ok
      ? reply.send({ accounts: result.accounts, invitations: result.invitations })
      : reply.code(403).send(FORBIDDEN);
  });

  route('GET', `${OWNER_ACCOUNTS_PATH}/:userId`, async (request, reply, actor) =>
    send(reply, await service.detail(actor, request.params.userId)),
  );

  for (const action of ['disable', 'enable'] as const) {
    route('POST', `${OWNER_ACCOUNTS_PATH}/:userId/${action}`, async (request, reply, actor) =>
      send(reply, await service[action](actor, request.params.userId, reasonFrom(request.body), request.ip)),
    );
  }

  route('POST', `${OWNER_ACCOUNTS_PATH}/:userId/sessions/revoke-all`, async (request, reply, actor) => {
    if (!isEmptyBody(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    return send(reply, await service.revokeAllSessions(actor, request.params.userId, request.ip));
  });

  route('POST', `${OWNER_ACCOUNTS_PATH}/:userId/sessions/:sessionRef/revoke`, async (request, reply, actor) => {
    if (!isEmptyBody(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    return send(reply, await service.revokeSession(actor, request.params.userId, request.params.sessionRef ?? '', request.ip));
  });
}
