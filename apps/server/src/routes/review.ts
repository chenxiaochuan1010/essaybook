import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { unauthorized } from '../lib/errors.js';
import {
  bulkUpdateChangeStatus,
  cancelRound,
  getRound,
  getRoundConflicts,
  getSubmission,
  mergeRound,
  submitForReview,
  submitReview,
  updateChangeStatus,
  withdrawSubmission,
} from '../services/review.js';

const idParams = z.object({ id: z.string().min(1) });

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/documents/:id/rounds', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    return { round: submitForReview(id, request.user.id) };
  });

  app.get('/api/rounds/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return { round: getRound(id) };
  });

  app.post('/api/rounds/:id/cancel', async (request) => {
    const { id } = idParams.parse(request.params);
    return { round: cancelRound(id) };
  });

  app.post('/api/rounds/:id/submissions', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ content: z.string().max(500_000) })
      .parse(request.body);
    return {
      submission: submitReview(id, request.user.id, body.content),
    };
  });

  app.get('/api/submissions/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return { submission: getSubmission(id) };
  });

  app.post('/api/submissions/:id/withdraw', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    withdrawSubmission(id, request.user.id);
    return { ok: true };
  });

  app.patch('/api/changes/:id', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ status: z.enum(['accepted', 'rejected']) })
      .parse(request.body);
    return {
      change: updateChangeStatus(id, body.status, request.user.id),
    };
  });

  app.post('/api/rounds/:id/changes/bulk', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        status: z.enum(['accepted', 'rejected']),
        reviewerId: z.string().min(1).optional(),
      })
      .parse(request.body);
    return bulkUpdateChangeStatus(id, body.status, request.user.id, body.reviewerId);
  });

  app.get('/api/rounds/:id/conflicts', async (request) => {
    const { id } = idParams.parse(request.params);
    return getRoundConflicts(id);
  });

  app.post('/api/rounds/:id/merge', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    return mergeRound(id, request.user.id);
  });
}
