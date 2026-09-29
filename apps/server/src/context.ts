import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Bus } from './bus.js';
import type { Config } from './config.js';
import type { DB } from './db/index.js';

export interface AppContext {
  cfg: Config;
  db: DB;
  bus: Bus;
}

export interface SessionUser {
  id: string;
  username: string;
  sessionId: string;
  csrf: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    clientId?: string;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function owner(req: FastifyRequest): string {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  return req.user.id;
}

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
