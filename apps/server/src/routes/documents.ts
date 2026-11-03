import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createDocument,
  diffVersions,
  getDocument,
  getVersion,
  listDocuments,
  listTrash,
  listVersions,
  publishDocument,
  purgeDocument,
  reopenDocument,
  restoreDocument,
  restoreVersion,
  saveSnapshot,
  softDeleteDocument,
  updateDocument,
} from '../services/documents.js';
import { getPublishStats } from '../services/fees.js';
import { forbidden, unauthorized } from '../lib/errors.js';

const idParams = z.object({ id: z.string().min(1) });
const versionParams = z.object({ id: z.string().min(1), versionId: z.string().min(1) });

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/documents', async () => {
    return { documents: listDocuments() };
  });

  app.get('/api/stats', async () => {
    return { stats: getPublishStats() };
  });

  app.post('/api/documents', async (request) => {
    if (!request.user) throw unauthorized();
    const body = z
      .object({ title: z.string().max(200).optional() })
      .parse(request.body ?? {});
    return { document: createDocument(request.user.id, body.title ?? '') };
  });

  app.get('/api/documents/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return { document: getDocument(id) };
  });

  app.patch('/api/documents/:id', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        title: z.string().max(200).optional(),
        content: z.string().max(500_000).optional(),
      })
      .parse(request.body ?? {});
    return { document: updateDocument(id, request.user.id, body) };
  });

  app.delete('/api/documents/:id', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    softDeleteDocument(id);
    return { ok: true };
  });

  app.delete('/api/documents/:id/permanent', async (request) => {
    if (!request.user) throw unauthorized();
    if (request.user.role === 'author') {
      throw forbidden('只有爸爸妈妈可以彻底删除');
    }
    const { id } = idParams.parse(request.params);
    purgeDocument(id);
    return { ok: true };
  });

  app.post('/api/documents/:id/publish', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    return publishDocument(id, request.user.id);
  });

  app.post('/api/documents/:id/reopen', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    return { document: reopenDocument(id) };
  });

  app.post('/api/documents/:id/restore', async (request) => {
    const { id } = idParams.parse(request.params);
    return { document: restoreDocument(id) };
  });

  app.get('/api/trash', async () => {
    return { documents: listTrash() };
  });

  app.get('/api/documents/:id/versions', async (request) => {
    const { id } = idParams.parse(request.params);
    return { versions: listVersions(id) };
  });

  app.post('/api/documents/:id/versions', async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ note: z.string().max(500).optional() })
      .parse(request.body ?? {});
    return { version: saveSnapshot(id, request.user.id, body.note) };
  });

  app.get('/api/versions/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return { version: getVersion(id) };
  });

  app.get('/api/versions/:id/diff', async (request) => {
    const { id } = idParams.parse(request.params);
    const query = z.object({ against: z.string().min(1) }).parse(request.query);
    return diffVersions(id, query.against);
  });

  app.post('/api/documents/:id/versions/:versionId/restore', async (request) => {
    if (!request.user) throw unauthorized();
    const { id, versionId } = versionParams.parse(request.params);
    return {
      document: restoreVersion(id, versionId, request.user.id),
    };
  });
}
