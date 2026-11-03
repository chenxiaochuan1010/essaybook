# 作文本部署说明（NAS 家庭内网）

目标：服务只在家里 NAS 上运行，iPad / Mac 在同一个 Wi-Fi 下访问
`http://NAS-IP:3000`，不依赖 VPN。默认不暴露到公网。

> **安全边界**：应用没有 PIN。只在家里可信的 Wi-Fi 下使用，**不要把 3000 端口
> 转发到公网**。需要出门访问时，再看第五节的 Tailscale 可选方案。

## 一、需要准备

- 一台能跑 Docker 的 NAS（群晖、威联通、Unraid 或 Linux 小主机）
- NAS 的局域网 IP 建议做 DHCP 保留，例如 `192.168.1.100`
- 不需要 Tailscale

## 二、首次部署

### 0. 先跑预检

把项目目录拷到 NAS 上，例如 `/volume1/docker/essaybook`，在项目根目录运行：

```bash
sh deploy/preflight.sh
```

确认 Docker / Compose 在、架构是 x86_64、3000 端口空闲、data 目录可写。

> DSM 7.1 的 Docker 包只有 Compose v1（`docker-compose`），没有 `docker compose`。
> 项目里的 compose 文件带 `version: "3.8"`，用 `sudo docker-compose` 即可。

### 1. 配置本机参数

```bash
cd /volume1/docker/essaybook
cp .env.example .env
```

编辑 `.env`：

```dotenv
PUID=1000
PGID=1000
LAN_BIND=0.0.0.0
APP_PORT=3000
COOKIE_SECURE=false
TZ=Asia/Shanghai
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=30
```

- `PUID` / `PGID`：运行容器的用户。用 `id` 查看；群晖常见 `1026:100`。
- `LAN_BIND`：`0.0.0.0` 监听所有网卡；只想绑定局域网 IP 可改成 `192.168.1.100`。
- `APP_PORT`：默认 3000。
- `COOKIE_SECURE`：家庭内网 HTTP 用 `false`；以后切到 Tailscale HTTPS 时改 `true`。

### 2. 数据目录权限

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```

容器用 `.env` 里的用户运行，`data/` 必须让这个用户可写，否则 SQLite 会启动失败。

### 3. 构建并启动

```bash
sudo /usr/local/bin/docker-compose up -d --build
sudo /usr/local/bin/docker-compose ps
sudo /usr/local/bin/docker-compose logs --tail=100
```

看到 `Up` 后，先在 NAS 本机验证：

```bash
curl -sS http://127.0.0.1:3000/api/health
# {"ok":true,...}
```

### 4. 从局域网访问

在 NAS 上：

```bash
curl -sS http://192.168.1.100:3000/api/health
```

在 Mac / iPad 的 Safari 打开：

```
http://192.168.1.100:3000
```

如果打不开：

- DSM 防火墙放行局域网到 TCP 3000
- 确认 NAS 的 IP 没变（建议 DHCP 保留）
- **不要在路由器上把 3000 转发到公网**

## 三、iPad 上的使用

1. Safari 打开 `http://NAS-IP:3000`
2. 点分享 → 「添加到主屏幕」
3. 从主屏幕进入，第一次以小朋友身份进入会要求填名字

> 说明：HTTP 下 Service Worker 不会注册，PWA 的离线壳不生效；应用仍然可以在线正常使用
> （MVP 本来不做离线写作）。以后如果启用 Tailscale HTTPS，PWA 壳会自动生效。

### 真机验收清单

- [ ] iPad Safari 打开 `http://NAS-IP:3000`，能进身份选择页
- [ ] 第一次以小朋友身份进入，能填写名字
- [ ] 中文输入法：拼音、候选词、标点、长按选词、撤销都正常
- [ ] 空白正文点一下会自动出现首行缩进，回车后下一段也缩进
- [ ] 键盘弹起时不遮挡正在写的那一行，底部按钮仍可点
- [ ] 切到别的 App 再回来，刚写的内容还在
- [ ] 横屏 / 竖屏 / 分屏切换后布局不破
- [ ] 「添加到主屏幕」后全屏运行，状态栏颜色正常
- [ ] 孩子提交审阅 → 爸爸修订 → 妈妈修订 → 孩子逐条处理
- [ ] 冲突提示能二选一，完成后能生成成品
- [ ] 成品打字机动画、跳过、打印 / 存 PDF 都正常
- [ ] 稿费申请 → 爸妈确认 → 未结算清零、累计增加、历史记录有结算人
- [ ] 暗色主题在 iPad 上对比度正常，成品纸面仍是浅色
- [ ] 删除 → 回收站恢复；爸妈能彻底删除

## 四、数据与备份

容器里的 `/app/data` 挂载到宿主机的 `./data`，里面主要有：

```
data/
├── essaybook.sqlite        # 主数据库（作文、版本、修订记录）
├── essaybook.sqlite-wal    # SQLite 预写日志
└── backups/                # 数据库快照
    └── essaybook-2026-11-01T01-12-52-433Z-auto.sqlite
```

- 服务每 24 小时自动做一次一致性快照（`VACUUM INTO`，不需要停服），保留最近 30 份。
- 设置页可以随时「立即备份」，并查看备份列表。
- 每份备份都会做 `PRAGMA integrity_check`，结果显示「已校验」或「校验失败」。
- 设置页还可以「导出全部作文（Markdown）」，单篇作文在版本历史页导出。

### 强烈建议：再留一份异地副本

NAS 本身会坏，误删也可能发生。任选一种：

- 群晖 Hyper Backup 定时把 `/volume1/docker/essaybook/data` 同步到 USB 硬盘或另一台 NAS
- 用 rsync 定时复制到另一台机器：

```bash
rsync -av --delete /volume1/docker/essaybook/data/backups/ user@other-host:/backup/essaybook/
```

### 从备份恢复

```bash
cd /volume1/docker/essaybook
sudo /usr/local/bin/docker-compose stop

# 先保留当前数据库，万一恢复错了还能回去
mv data/essaybook.sqlite data/essaybook.sqlite.broken
rm -f data/essaybook.sqlite-wal data/essaybook.sqlite-shm

cp data/backups/essaybook-xxxx-auto.sqlite data/essaybook.sqlite
sudo chown 1000:1000 data/essaybook.sqlite

sudo /usr/local/bin/docker-compose start
```

校验备份可以在 Mac 上做（项目里有 Node 22+）：

```bash
node scripts/check-backup.mjs "/Volumes/docker/essaybook/data/backups/essaybook-xxxx-auto.sqlite"
```

或者用 NAS 上的 sqlite3：

```bash
sqlite3 data/backups/essaybook-xxxx-auto.sqlite 'PRAGMA integrity_check;'
```

## 五、可选：以后想在外网访问

如果以后需要出门也能用，可以再装 Tailscale；家庭内网模式不用改端口绑定。

1. 安装 Synology 版 Tailscale（DSM 7 / x86_64）
2. 登录同一个 tailnet，关闭这台 NAS 的 key 过期
3. 管理台 → DNS → 启用 MagicDNS 和 HTTPS Certificates
4. `.env` 改成 `COOKIE_SECURE=true`，重启容器
5. 提供 HTTPS：

```bash
sudo /var/packages/Tailscale/target/bin/tailscale serve --bg http://127.0.0.1:3000
sudo /var/packages/Tailscale/target/bin/tailscale serve status
```

会得到 `https://nas-name.<tailnet>.ts.net/`。注意：改成 `COOKIE_SECURE=true` 后，
局域网 HTTP 地址将无法登录，日常请使用 Tailscale HTTPS 地址。

想停掉 Tailscale 代理：

```bash
sudo /var/packages/Tailscale/target/bin/tailscale serve --https=443 off
```

## 六、升级

```bash
cd /volume1/docker/essaybook
# 重新拷贝项目文件（没有 git remote 时）
sudo /usr/local/bin/docker-compose up -d --build
```

数据库结构变更会在启动时自动执行 `CREATE TABLE IF NOT EXISTS`；升级前建议先在设置页点一次「立即备份」。

## 七、环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` / `1000` | 容器运行用户；群晖常见 `1026` / `100`，用 `id` 确认 |
| `LAN_BIND` | `0.0.0.0` | 监听地址；可改成 NAS 的局域网 IP |
| `APP_PORT` | `3000` | 宿主机端口 |
| `COOKIE_SECURE` | 生产环境为 `true` | 家庭 HTTP 用 `false`；Tailscale HTTPS 用 `true` |
| `TZ` | `Asia/Shanghai` | 时区，影响「今日稿费」的日期边界 |
| `BACKUP_INTERVAL_HOURS` | `24` | 自动备份间隔，设为 `0` 关闭 |
| `BACKUP_KEEP` | `30` | 保留多少份自动备份 |
| `BACKUP_DISABLED` | `false` | 设为 `true` 完全关闭自动备份 |

## 八、常见问题

**打开页面一直停在「正在连接家里的书架」**
检查 NAS 上的容器是否在运行；在 NAS 上 `curl http://127.0.0.1:3000/api/health`
看服务本身是否正常；再检查 Mac/iPad 是否和 NAS 在同一个 Wi-Fi、NAS 的 IP 是否变了。

**能打开页面，但一操作就提示「请先选择身份」**
Cookie 的 Secure 设置和访问协议不匹配。HTTP 访问时 `.env` 里 `COOKIE_SECURE=false`；
HTTPS 访问时改成 `true`，然后 `docker-compose up -d` 重启容器。

**iPad 上写作时中文输入有问题吗？**
编辑器用的是原生 `textarea`，中文输入法在 iPad Safari 上最稳；没有使用 contenteditable。

**数据目录权限报错**
群晖上常见 1026:100（用 `id` 确认）。如果 `id` 显示 1026:100，就把下面的 1000:1000 换成 1026:100：
`sudo chown -R 1000:1000 data`。

**想换端口**
修改 `.env` 的 `APP_PORT`，例如 `8080`，然后重启容器；访问 `http://NAS-IP:8080`。

**局域网里其他人能看到吗？**
会。应用没有 PIN，能连到家里 Wi-Fi 的设备都能打开并切换身份。建议：
- 不要把 3000 转发到公网
- 访客网络与家庭网络隔离
- 如果以后需要更强约束，可以给应用加 PIN
