import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/** Game-layer extras (helper, phone, diary, images, voice). Filled in by later tiers. */
export function registerGame(_app: FastifyInstance, _ctx: AppContext) {}
