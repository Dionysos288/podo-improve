## Podo Improve – Local Print Agent

This agent runs on the **user's PC** and handles PrusaSlicer slicing locally.
The web server cannot run a slicer on a user machine, so the agent does it.

It ships as a single Windows executable (`podo-print-agent.exe`) — no Node.js
install required — and runs hidden in the background with a status tray icon.

### What it does

1. **Connects** to the web app and reports status (version, PrusaSlicer found?).
2. **Polls** for slicing jobs (STL → G-code).
3. **Runs PrusaSlicer** locally and post-processes the G-code (hardness zones,
   IR3 belt transform).
4. **Uploads** the G-code back to the server.
5. **Self-updates** when a newer agent is released.

It is built to be fail-proof: an independent heartbeat keeps the connection
alive during long slices, the job loop never dies on a failed/cancelled job,
and Windows Task Scheduler restarts it on crash and at every logon.

### Setup (end users)

1. In the web app go to **Settings → Basis → Lokale Print Agent**.
2. Click **Auto-start installeren** → downloads `Podo-Print-Agent-Setup.cmd`.
3. Double-click it once. It downloads the agent, registers auto-start, and
   starts it. The status turns to **Verbonden** within a few seconds.

PrusaSlicer is auto-detected in its common install locations. If it is not
found, install PrusaSlicer (or set the path under *Geavanceerd*).

> Unsigned executable: Windows SmartScreen may warn on first run
> ("More info → Run anyway"). Code signing is not yet configured.

### CLI

```text
podo-print-agent                     run the agent (default; used by the task)
podo-print-agent install --url <url> --token <token> [--prusa <path>]
podo-print-agent uninstall           remove auto-start + config
podo-print-agent update              check for and apply updates now
```

Data lives in `%LOCALAPPDATA%\PodoPrintAgent\` (`config.json`, `agent.log`).

### Build (maintainers)

```bash
cd agent/print-agent
npm install
npm run build           # → dist/podo-print-agent.exe (node22-win-x64, via @yao-pkg/pkg)
npm run build:checksum  # prints sha256 for the version endpoint
```

Bump `src/version.mjs` (`AGENT_VERSION`) for every release and keep it in sync
with `AGENT_VERSION` in the web app.

### Hosting + web app env

The built exe is ~60MB (too large for Supabase Storage’s 50MB limit on many
plans). **GitHub Releases** is the default host:

```bash
npm run agent:build
npm run agent:publish
```

That creates `agent-v<version>` on GitHub and writes
`release.manifest.json` with the download URL and sha256.

Configure the web app (Vercel → Settings → Environment Variables):

```
AGENT_VERSION    = 2.0.0
AGENT_EXE_URL    = https://github.com/<org>/<repo>/releases/download/agent-v2.0.0/podo-print-agent.exe
AGENT_EXE_SHA256 = <from release.manifest.json>
```

- `GET /api/agent/version` advertises `{ version, url, sha256 }`.
- `GET /api/agent/download/exe` redirects to `AGENT_EXE_URL`.
- `GET /api/agent/download` returns the user-specific setup `.cmd`.

### Module layout

- `index.mjs` – packaged entry → `src/cli.mjs`
- `agent.mjs` – legacy `node agent.mjs --url --token` shim
- `src/runner.mjs` – resilient loop, heartbeat, single-instance lock
- `src/job.mjs` – per-job slice/upload (never throws to the loop)
- `src/install.mjs` – Task Scheduler register/uninstall
- `src/updater.mjs` – self-update
- `src/tray.mjs` – status tray icon (best-effort)
- `src/config.mjs` – config + PrusaSlicer auto-detect
- `src/api.mjs` – server client
- `src/slicer/*` – slicing logic (Raise3D E2, IR3 V2, hardness, STL orient)
- `ir3/transform.mjs` – IR3 belt G-code transform

### Manual run (developers)

```bash
node agent/print-agent/index.mjs install --url http://localhost:3000 --token YOUR_TOKEN
node agent/print-agent/index.mjs            # run using saved config
# or, without installing:
node agent/print-agent/agent.mjs --url http://localhost:3000 --token YOUR_TOKEN
```
