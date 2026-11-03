import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { unauthorized } from '../lib/errors.js';
import {
  backupStatus,
  createBackup,
  deleteBackup,
  listBackups,
} from '../services/backup.js';
import { exportAllMarkdown, exportDocumentOrThrow } from '../services/export.js';

const idParams = z.object({ id: z.string().min(1) });

function sendMarkdown(
  reply: FastifyReply,
  fileName: string,
  markdown: string,
): FastifyReply {
  reply.header('content-type', 'text/markdown; charset=utf-8');
  reply.header(
    'content-disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  return reply.send(markdown);
}

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backups', async () => ({
    status: backupStatus(),
    backups: listBackups(),
  }));

  app.post('/api/backups', async (request) => {
    if (!request.user) throw unauthorized();
    return { backup: createBackup('manual') };
  });

  app.delete('/api/backups/:id', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    deleteBackup(id);
    return { ok: true };
  });

  app.get('/api/export/all', async (request, reply) => {
    if (!request.user) throw unauthorized();
    const { fileName, markdown } = exportAllMarkdown();
    return sendMarkdown(reply, fileName, markdown);
  });

  app.get('/api/export/documents/:id', async (request, reply) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    const { fileName, markdown } = exportDocumentOrThrow(id);
    return sendMarkdown(reply, fileName, markdown);
  });
}
