<p align="center">
  <img src="apps/web/public/icons/icon-192.png" width="96" alt="作文本" />
</p>

<h1 align="center">作文本</h1>

<p align="center">
  家庭作文协作本：孩子在 iPad 上写，爸爸妈妈异步修订，孩子逐条决定接受或拒绝。
</p>

<p align="center">
  <img src="docs/screenshots/profile.png" width="760" alt="身份选择页" />
</p>

## 为什么做这个

孩子用系统备忘录写作文，遇到三个问题：

1. 家长修订时误删段落，找不回来；
2. 修改直接覆盖原文，不知道谁改了什么；
3. 孩子没有决定权，改好改坏都由家长说了算。

作文本把「写作」和「修订」拆开：家长改的是修订副本，提交后变成一条条建议，
孩子逐条决定接受还是拒绝。原文、历史版本和每一次修改都留着。

它不是实时协作工具，也不需要所有人同时在线——更像把作文本递过去，改好再递回来。

## 它怎么工作

1. 孩子在 iPad 上写作，正文自动保存到家里的 NAS
2. 写完点「交给爸妈修订」，正文暂时锁定
3. 爸爸、妈妈各自在修订副本上修改，提交时自动生成逐条 diff
4. 孩子看到红绿修订标记，逐条接受或拒绝；两人改到同一处时选择保留哪条
5. 点「完成并生成成品」：打字机逐字打出全文，盖上「已完稿」印章，可打印或存为 PDF
6. 成品按字数结算稿费；孩子申请，爸妈确认，记录留在稿费历史里

## 功能

- 三人身份：小朋友（作者）、爸爸、妈妈（审阅者），无需密码
- 第一次进入填写小朋友的名字，之后可在设置里修改
- 纯文本写作，自动首行缩进，中文输入法友好（原生 `textarea`）
- 自动保存 + 每 10 分钟自动版本点；历史里可以手动「打一个标记」
- 提交审阅后正文锁定，爸妈各自在修订副本里修改
- 提交时自动生成逐条修改（新增 / 删除 / 修改），孩子逐条接受或拒绝
- 爸妈改了同一处时明确提示冲突，由孩子选择保留哪条
- 一键「完成并生成成品」：打字机动画 +「已完稿」印章，可打印 / 存 PDF
- 完成过的作文重新修改后，可以直接再次生成成品，不必再走一轮爸妈审阅
- 成品按字数结算稿费；支持申请结算、爸妈确认、稿费历史
- 成品锁定编辑，可随时「继续修改」；每篇成品有固定的「第 N 篇」编号
- 版本历史、恢复任意版本（恢复本身也会生成新版本）
- 删除进回收站；小朋友可删、可恢复，只有爸爸妈妈能彻底删除
- 自动 / 手动数据库备份，带完整性校验；Markdown 单篇 / 全量导出
- 明亮 / 暗色主题
- iPad「添加到主屏幕」使用

## 一些设计决定

- **原生 `textarea`**：iPad Safari 上中文输入法最稳，不用 contenteditable。
- **服务端 SQLite**：正文先落到 NAS，不依赖浏览器 localStorage，换设备/清缓存不丢稿。
- **不可变版本**：提交审阅、合并、恢复都生成新版本，永远不覆盖历史。
- **家庭内网优先**：服务跑在 NAS 上，iPad/Mac 在同一 Wi-Fi 直接访问；需要出门时再开 Tailscale。
- **没有 PIN**：靠家庭网络边界；不要把端口暴露到公网。
- **成品是纸**：衬线、暖白纸面、红印章，和工具界面区分开；稿费是给小朋友的仪式感。
- **无离线写作**：MVP 明确不做离线，所有保存都落在 NAS。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite |
| 路由 / 数据 | React Router + TanStack Query |
| 编辑器 | 原生 `<textarea>` |
| 后端 | Fastify + Zod |
| 数据库 | SQLite（`node:sqlite`，WAL） |
| Diff | diff-match-patch，中文按字符聚合 |
| PWA | vite-plugin-pwa / Workbox |
| 测试 | Vitest + 无头 Chrome 全流程测试 |
| 部署 | Docker Compose，NAS 数据卷 |

前端和服务端共用 `packages/core` 里的 diff、冲突检测、合并和字数统计，避免两端算法不一致。

## 本地开发

要求 Node 24+（使用内置 `node:sqlite`，不需要编译原生模块）。

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173（Vite，`/api` 代理到 3000）
- 后端：http://localhost:3000
- 数据库：`apps/server/data/essaybook.sqlite`
- 默认身份：小朋友 / 爸爸 / 妈妈（首次启动自动创建）

生产构建：

```bash
npm run build
npm start          # 由后端直接托管 apps/web/dist
```

## 部署

部署到家里的 NAS：见 [deploy/README.md](deploy/README.md)。

- 默认是家庭内网模式：`http://NAS-IP:3000`
- 出门需要访问时，可选用 Tailscale 提供 HTTPS
- 不要把 3000 端口转发到公网；应用没有 PIN

## 数据与隐私

- 所有作文、版本、修订和稿费记录都在家里的 NAS 上，不经过第三方云。
- **这个仓库不包含任何用户作文、数据库、备份或 `.env`。**
  `data/`、`apps/server/data/`、`artifacts/` 和 `.env` 都在 `.gitignore` 里。
- README 里的截图只显示身份选择页，不含任何作文内容。
- 自动备份和主数据库在同一块硬盘上，能防误删，但防不了硬盘损坏。
  请按部署文档再把 `data/backups/` 同步到另一块硬盘或另一台设备。

## 测试

```bash
npm test           # core 的 diff / 冲突 / 合并 / 字数单元测试
npm run typecheck  # core / server / web 类型检查
npm run test:smoke # 需要后端运行：完整 API 流程
npm run test:ui    # 需要后端运行 + 本机 Chrome：无头浏览器跑完整 UI 流程
```

`test:ui` 会生成截图到 `artifacts/ui/`，截图不进入仓库。

测试使用合成的示例作文和示例人名，不包含任何真实用户内容。

## 目录结构

```
apps/
  server/        Fastify + node:sqlite
  web/           React + Vite + PWA
packages/
  core/          diff、冲突检测、合并、字数统计
deploy/          NAS + Docker 部署说明与预检脚本
docs/            README 截图
scripts/         冒烟测试、UI 全流程测试、备份校验、数据重置
data/            本地运行时数据（gitignore）
```

## 已知限制

- 不做离线写作
- 不做实时协作
- 不支持图片 / 富文本
- 单家庭、三个固定身份；没有 PIN
- 家庭内网 HTTP 下，PWA 的 Service Worker 不生效（应用仍可在线使用）
- 成品打印走浏览器「打印 → 存为 PDF」

## License

个人 / 家庭项目，暂未指定开源许可证。如果需要复用代码，请先联系作者。
