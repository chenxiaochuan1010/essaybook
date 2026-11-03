import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { forbidden, unauthorized } from '../lib/errors.js';
import {
  cancelSettlement,
  confirmSettlement,
  getFeesPayload,
  requestSettlement,
} from '../services/fees.js';

const idParams = z.object({ id: z.string().min(1) });

export async function feeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/fees', async () => getFeesPayload());

  app.post('/api/fees/request', async (request) => {
    if (!request.user) throw unauthorized();
    if (request.user.role !== 'author') {
      throw forbidden('只有小朋友可以申请稿费结算');
    }
    return requestSettlement(request.user.id);
  });

  app.post('/api/fees/requests/:id/confirm', async (request) => {
    if (!request.user) throw unauthorized();
    if (request.user.role === 'author') {
      throw forbidden('只有爸爸妈妈可以确认结算');
    }
    const { id } = idParams.parse(request.params);
    return confirmSettlement(id, request.user.id);
  });

  app.post('/api/fees/requests/:id/cancel', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    return cancelSettlement(id, request.user.id);
  });
}
