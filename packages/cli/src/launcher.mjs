function quotePosixLiteral(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function escapeBatchLiteral(value) {
  return value.replaceAll('%', '%%')
}

export function createPosixInstalledLauncher(source) {
  return [
    '#!/bin/sh',
    'set -eu',
    'electron_host=' + quotePosixLiteral(source.electronHost),
    'cli_module=' + quotePosixLiteral(source.modulePath),
    'if [ ! -f "$electron_host" ] || [ ! -x "$electron_host" ] || [ ! -f "$cli_module" ]; then',
    '  echo "DeepChat CLI bundled resources are unavailable." >&2',
    '  exit 127',
    'fi',
    'ELECTRON_RUN_AS_NODE=1 exec "$electron_host" "$cli_module" "$@"',
    ''
  ].join('\n')
}

export function createWindowsInstalledLauncher(source) {
  const cliModule = escapeBatchLiteral(source.modulePath)
  const electronHost = escapeBatchLiteral(source.electronHost)
  return [
    '@echo off',
    'setlocal',
    `set "cli_module=${cliModule}"`,
    `set "electron_host=${electronHost}"`,
    'if not exist "%electron_host%" goto missing_runtime',
    'if exist "%electron_host%\\" goto missing_runtime',
    'if not exist "%cli_module%" goto missing_runtime',
    'set ELECTRON_RUN_AS_NODE=1',
    '"%electron_host%" "%cli_module%" %*',
    'exit /b %errorlevel%',
    ':missing_runtime',
    'echo DeepChat CLI bundled resources are unavailable. 1>&2',
    'exit /b 127',
    ''
  ].join('\r\n')
}

export const BUNDLED_POSIX_LAUNCHER = `#!/bin/sh
set -eu

case "$0" in
  */*) script_dir=\${0%/*} ;;
  *) script_dir=. ;;
esac
script_dir=$(CDPATH= cd -P -- "$script_dir" && pwd)
cli_module="$script_dir/deepchat.mjs"
electron_host=""
for candidate in \\
  "$script_dir/../../../MacOS/DeepChat" \\
  "$script_dir/../../../deepchat.bin" \\
  "$script_dir/../../../DeepChat" \\
  "$script_dir/../../../deepchat" \\
  "$script_dir/../../../DeepChat.exe" \\
  "$script_dir/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \\
  "$script_dir/../../node_modules/electron/dist/electron" \\
  "$script_dir/../../node_modules/electron/dist/electron.exe"
do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    electron_host="$candidate"
    break
  fi
done
if [ -n "$electron_host" ] && [ -f "$cli_module" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$electron_host" "$cli_module" "$@"
fi
echo "DeepChat CLI bundled resources are unavailable." >&2
exit 127
`

export const BUNDLED_WINDOWS_LAUNCHER = `@echo off\r
setlocal\r
set "cli_module=%~dp0deepchat.mjs"\r
set "electron_host=%~dp0..\\..\\node_modules\\electron\\dist\\electron.exe"\r
if not exist "%electron_host%" set "electron_host=%~dp0..\\..\\..\\DeepChat.exe"\r
if not exist "%electron_host%" set "electron_host=%~dp0..\\..\\..\\DeepChat"\r
if not exist "%electron_host%" goto missing_runtime\r
if exist "%electron_host%\\" goto missing_runtime\r
if not exist "%cli_module%" goto missing_runtime\r
set ELECTRON_RUN_AS_NODE=1\r
"%electron_host%" "%cli_module%" %*\r
exit /b %errorlevel%\r
:missing_runtime\r
echo DeepChat CLI bundled resources are unavailable. 1>&2\r
exit /b 127\r
`
