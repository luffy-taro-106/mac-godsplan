#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if [[ -d 'dist/mac-arm64/OpenCluely Overlay.app' ]]; then
  open 'dist/mac-arm64/OpenCluely Overlay.app'
  exit $?
fi
for candidate in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
  if [[ -x "$candidate" ]] && "$candidate" --version >/dev/null 2>&1; then
    if [[ -d node_modules/electron ]]; then
      exec "$candidate" scripts/launch.js
    fi
    break
  fi
done
echo 'Install Node 22.12 or newer, then run npm ci in this folder. Or open the packaged app from dist.'
read '?Press Enter to close.'
exit 1
