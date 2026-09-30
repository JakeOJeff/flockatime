import { Hono } from 'hono';
import type { Env } from './types';

/**
 * One-line installers for snapshot-agent. The Worker serves them so each one
 * already knows its endpoint (this origin); the API key comes from the
 * dashboard's "Connect the CLI" card via FLOCKATIME_KEY, so neither script
 * holds a secret and both can be public.
 *
 * Both download the latest GitHub release, check it against the release's
 * SHA256SUMS, put it in ~/.flockatime/bin, and hand over to
 * `snapshot-agent setup`, which does the rest.
 */
type Ctx = { Bindings: Env };

export const install = new Hono<Ctx>();

const DEFAULT_REPO = 'JakeOJeff/flockatime-cli';

function fill(template: string, c: { req: { url: string }; env: Env }): string {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(c.env.CLI_REPO ?? '') ? c.env.CLI_REPO! : DEFAULT_REPO;
  return template.replaceAll('__ENDPOINT__', new URL(c.req.url).origin).replaceAll('__REPO__', repo);
}

const text = (body: string) =>
  new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

install.get('/install.ps1', (c) => text(fill(PS1, c)));
install.get('/install.sh', (c) => text(fill(SH, c)));

const PS1 = String.raw`# flockatime CLI installer for Windows. Copy the full command from your
# dashboard's "Connect the CLI" card:
#   $env:FLOCKATIME_KEY='flk_...'; irm __ENDPOINT__/install.ps1 | iex
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'  # the progress bar makes downloads crawl
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $endpoint = '__ENDPOINT__'
  $repo = '__REPO__'
  $key = $env:FLOCKATIME_KEY
  if (-not $key) {
    Write-Host 'FLOCKATIME_KEY is not set. Copy the full command from your flockatime dashboard.' -ForegroundColor Red
    return
  }

  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'amd64' }
  $asset = "snapshot-agent_windows_$arch.zip"
  $base = "https://github.com/$repo/releases/latest/download"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('flockatime-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null

  try {
    Write-Host "Downloading $asset from $repo ..."
    Invoke-WebRequest "$base/$asset" -OutFile "$tmp\$asset" -UseBasicParsing
    Invoke-WebRequest "$base/SHA256SUMS" -OutFile "$tmp\SHA256SUMS" -UseBasicParsing

    $want = $null
    foreach ($line in Get-Content "$tmp\SHA256SUMS") {
      $parts = $line -split '\s+'
      if ($parts.Count -ge 2 -and $parts[1].TrimStart('*') -eq $asset) { $want = $parts[0].ToLower() }
    }
    $have = (Get-FileHash "$tmp\$asset" -Algorithm SHA256).Hash.ToLower()
    if (-not $want -or $want -ne $have) { throw "checksum mismatch for $asset --- not installing it" }

    Expand-Archive "$tmp\$asset" -DestinationPath "$tmp\x" -Force
    $exe = Get-ChildItem "$tmp\x" -Recurse -Filter 'snapshot-agent.exe' | Select-Object -First 1
    if (-not $exe) { throw "snapshot-agent.exe not found in $asset" }

    $dir = Join-Path $HOME '.flockatime\bin'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    # A running agent holds the old binary open; stop it so it can be replaced.
    # setup starts the new one.
    Get-Process -Name 'snapshot-agent' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
    Copy-Item $exe.FullName "$dir\snapshot-agent.exe" -Force

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($null -eq $userPath) { $userPath = '' }
    if (($userPath -split ';') -notcontains $dir) {
      [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ";$dir").TrimStart(';')), 'User')
      $env:Path += ";$dir"
    }

    & "$dir\snapshot-agent.exe" setup --endpoint $endpoint --key $key
    if ($LASTEXITCODE -ne 0) { throw 'setup did not finish --- see the message above' }
  }
  finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:FLOCKATIME_KEY -ErrorAction SilentlyContinue
  }
}
`;

const SH = String.raw`#!/bin/sh
# flockatime CLI installer for macOS and Linux. Copy the full command from your
# dashboard's "Connect the CLI" card:
#   curl -fsSL __ENDPOINT__/install.sh | FLOCKATIME_KEY=flk_... sh
set -eu

ENDPOINT='__ENDPOINT__'
REPO='__REPO__'
KEY="${'$'}{FLOCKATIME_KEY:-}"
if [ -z "$KEY" ]; then
  echo "FLOCKATIME_KEY is not set. Copy the full command from your flockatime dashboard." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

asset="snapshot-agent_${'$'}{os}_${'$'}{arch}.tar.gz"
base="https://github.com/$REPO/releases/latest/download"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $asset from $REPO ..."
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then
  have=$(sha256sum "$tmp/$asset" | awk '{ print $1 }')
else
  have=$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')
fi
if [ -z "$want" ] || [ "$want" != "$have" ]; then
  echo "checksum mismatch for $asset --- not installing it" >&2
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$tmp"
dir="$HOME/.flockatime/bin"
mkdir -p "$dir"
# Swap in by rename: a running agent keeps the old file until setup restarts it.
cp "$tmp/snapshot-agent_${'$'}{os}_${'$'}{arch}/snapshot-agent" "$dir/snapshot-agent.new"
chmod 755 "$dir/snapshot-agent.new"
mv -f "$dir/snapshot-agent.new" "$dir/snapshot-agent"

"$dir/snapshot-agent" setup --endpoint "$ENDPOINT" --key "$KEY"

case ":$PATH:" in
  *":$dir:"*) ;;
  *)
    echo
    echo "To run snapshot-agent yourself, add it to your PATH:"
    echo "  export PATH=\"\$HOME/.flockatime/bin:\$PATH\""
    ;;
esac
`;
