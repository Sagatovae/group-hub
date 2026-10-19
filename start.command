#!/bin/bash
set -e
cd "$(dirname "$0")"

# В Codex Desktop может быть готовый Node.js, даже если системная версия устарела.
group_hub_node_bin="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if [ -x "${group_hub_node_bin}/node" ]; then
  export PATH="${group_hub_node_bin}:${PATH}"
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)'; then
  echo 'Для запуска нужен Node.js 22.12 или новее. Рекомендуется Node.js 24 LTS: https://nodejs.org/'
  read -r -p 'Нажмите Enter, чтобы закрыть окно…'
  exit 1
fi

if [ ! -d node_modules ]; then
  npm ci
fi

echo 'Закройте это окно или нажмите Ctrl+C, чтобы остановить сайт.'
npm run dev -- --open
