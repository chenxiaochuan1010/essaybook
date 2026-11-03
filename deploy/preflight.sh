#!/bin/sh
# 在 NAS 的项目目录里运行：sh deploy/preflight.sh
# 只做检查和输出，不修改任何东西。

set -u

echo "== 系统 =="
uname -a
echo

echo "== 架构 =="
uname -m
echo

echo "== Docker =="
if command -v docker >/dev/null 2>&1; then
  docker --version
  docker info --format 'Server: {{.ServerVersion}} / Storage: {{.Driver}}' 2>/dev/null || true
else
  echo "未找到 docker"
fi
echo

echo "== Docker Compose =="
if docker compose version >/dev/null 2>&1; then
  docker compose version
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose --version
else
  echo "未找到 docker compose / docker-compose"
fi
echo

echo "== Tailscale =="
if command -v tailscale >/dev/null 2>&1; then
  tailscale version
  tailscale status 2>/dev/null | head -3
else
  echo "未找到 tailscale"
fi
echo

echo "== 当前用户 =="
id
echo

echo "== 当前目录 =="
pwd
echo

echo "== 磁盘 =="
df -h . | tail -1
echo

echo "== 3000 端口 =="
if command -v ss >/dev/null 2>&1; then
  ss -ltn 2>/dev/null | grep ':3000 ' || echo "3000 空闲"
elif command -v netstat >/dev/null 2>&1; then
  netstat -ltn 2>/dev/null | grep ':3000 ' || echo "3000 空闲"
else
  echo "没有 ss/netstat，跳过端口检查"
fi
echo

echo "== data 目录 =="
if [ -d data ]; then
  ls -ld data
  if touch data/.write-test 2>/dev/null; then
    rm -f data/.write-test
    echo "data/ 可写"
  else
    echo "data/ 不可写，需要 chown 到 .env 里的 PUID:PGID"
  fi
else
  echo "data/ 不存在，部署时创建"
fi
echo

echo "== 服务健康检查 =="
if command -v curl >/dev/null 2>&1; then
  curl -fsS --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || echo "服务未运行（正常，部署后再检查）"
else
  echo "没有 curl，跳过"
fi
