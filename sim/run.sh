#!/usr/bin/env bash
# 无头模拟运行器。用法：
#   ./sim/run.sh              跑难度报告 report.ts
#   ./sim/run.sh foo.ts       跑 sim/foo.ts
# 核心源码零依赖纯 TS，node 直接跑，不碰 Cocos 编辑器。
set -e
cd "$(dirname "$0")/.."
SCRIPT="${1:-report.ts}"
shift || true
exec node \
  --import ./sim/loader.mjs \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  "sim/$SCRIPT" "$@"
