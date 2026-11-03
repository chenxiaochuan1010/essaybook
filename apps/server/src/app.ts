import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, nowIso } from './db/index.js';
import { AppError, unauthorized } from './lib/errors.js';
import { findSession, SESSION_COOKIE } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { reviewRoutes } from './routes/review.js';
import { dataRoutes } from './routes/data.js';
import { feeRoutes } from './routes/fees.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PUBLIC_API = new Set(['/api/health', '/api/profiles', '/api/session']);

/**
 * 前端构建产物可能在开发（tsx 直接跑 src）和构建后（dist）两种目录结构下，
 * 依次尝试几个候选路径，找到包含 index.html 的那个。
 */
function resolveWebDist(): string {
  const candidates = [
    process.env.WEB_DIST,
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return path.resolve(__dirname, '../../web/dist');
}

export async function buildApp() {
  initDb();

  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const pathname = request.url.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/')) return;
    if (PUBLIC_API.has(pathname)) return;

    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw unauthorized();

    const user = findSession(token);
    if (!user) throw unauthorized('身份已过期，请重新选择');

    request.user = user;
  });

  app.get('/api/health', async () => ({ ok: true, time: nowIso() }));

  // 必须在注册路由之前设置：Fastify 的插件上下文会继承当时的错误处理器。
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '提交的内容格式不正确',
          details: error.flatten(),
        },
      });
      return;
    }

    const fastifyError = error as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    if (
      fastifyError.statusCode &&
      fastifyError.statusCode >= 400 &&
      fastifyError.statusCode < 500
    ) {
      reply.status(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code ?? 'BAD_REQUEST',
          message: fastifyError.message ?? '请求无法处理',
        },
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器出错了，请稍后再试',
      },
    });
  });

  await app.register(authRoutes);
  await app.register(documentRoutes);
  await app.register(reviewRoutes);
  await app.register(dataRoutes);
  await app.register(feeRoutes);

  const webDist = resolveWebDist();

  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      // 默认的 wildcard 路由可以在不重启服务的情况下提供新构建出来的文件。
      wildcard: true,
      // 自己控制缓存头：哈希资源长缓存，入口文件和 sw.js 每次校验。
      cacheControl: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('cache-control', 'no-cache');
        }
      },
    });

    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0] ?? '';

      if (pathname.startsWith('/api/')) {
        reply.status(404).send({
          error: { code: 'NOT_FOUND', message: '接口不存在' },
        });
        return;
      }

      // 缺失的静态资源不要返回首页，否则浏览器会把 HTML 当成 JS/CSS。
      if (/\.[a-z0-9]+$/i.test(pathname)) {
        reply.status(404).type('text/plain; charset=utf-8').send('Not Found');
        return;
      }

      // 其余路径交给前端路由。
      reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: request.url.startsWith('/api/')
            ? '接口不存在'
            : '前端尚未构建，请使用 Vite 开发服务器或先执行构建',
        },
      });
    });
  }

  return app;
}
