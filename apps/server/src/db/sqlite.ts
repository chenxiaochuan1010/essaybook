import type * as NodeSqlite from 'node:sqlite';

/**
 * 通过 process.getBuiltinModule 取到 node:sqlite。
 *
 * 原因：部分打包器（esbuild 旧版本）还不认识 `node:sqlite` 这个内置模块，
 * 会把 `import ... from "node:sqlite"` 改写成 `from "sqlite"`，导致运行时找不到包。
 * 运行时用字符串取内置模块可以绕开这个问题，类型仍然来自 @types/node。
 */
export const sqlite = process.getBuiltinModule(
  'node:sqlite',
) as unknown as typeof NodeSqlite;

export const DatabaseSync = sqlite.DatabaseSync;
