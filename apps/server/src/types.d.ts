import type { SessionUser } from './lib/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}
