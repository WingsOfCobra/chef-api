# Chef API — Roadmap

This document tracks what's built, what's planned, and what's dreamed about for Chef API.

---

## Current Status: Phase 1 MVP ✅

A working Fastify/TypeScript API covering the four core domains needed for daily orchestration. All routes are auth-protected, responses are SQLite-cached, and OpenAPI docs live at `/docs`.

**What's in Phase 1:**

- Fastify + TypeScript + Zod validation
- SQLite-backed response cache (TTLs per domain)
- API key auth via `X-Chef-API-Key` header
- Auto-generated OpenAPI docs at `/docs`
- GitHub Actions auto-deploy to SOLCloud (PM2)
- Docker + docker-compose alternative deployment

---

## Phase 1: MVP (built)

### GitHub (`/github`)
- `GET /github/repos` — list repos with stars, last push, open issues
- `GET /github/repos/:owner/:repo/prs` — open PRs with CI check status
- `GET /github/repos/:owner/:repo/issues` — open issues
- `POST /github/repos/:owner/:repo/issues` — create issue
- `GET /github/repos/:owner/:repo/workflows` — recent workflow runs
- `GET /github/notifications` — unread notifications

### Docker (`/docker`)
- `GET /docker/containers` — all containers with state, health, ports
- `POST /docker/containers/:id/restart` — restart container
- `POST /docker/containers/:id/stop` — stop container
- `GET /docker/containers/:id/logs` — last N lines of logs
- `GET /docker/stats` — image/volume/container disk usage

### SSH (`/ssh`)
- `GET /ssh/hosts` — list configured hosts
- `POST /ssh/run` — run command on named host; logged to job_history

### System (`/system`)
- `GET /system/health` — uptime, memory, load (no auth)
- `GET /system/disk` — disk usage per mount
- `GET /system/processes` — top processes by CPU

### TODO (`/todo`)
- `GET /todo` — DB items + parsed from `TODO.md`
- `POST /todo` — add item to DB
- `PATCH /todo/:id` — update/complete item

---

## Phase 2: Automation & Integration

The goal of Phase 2 is to make Chef API a real automation hub: scheduled jobs, email awareness, log aggregation, and hooks that let OpenClaw agents trigger and observe work.

### Cron Job Management (`/cron`)
- `GET /cron/jobs` — list all scheduled jobs with next run time, last run result
- `POST /cron/jobs` — create a cron job (schedule + SSH command or HTTP request)
- `DELETE /cron/jobs/:id` — remove a job
- `POST /cron/jobs/:id/run` — trigger job immediately
- `GET /cron/jobs/:id/history` — last N run results with stdout/stderr/exit code
- Persistent cron state in SQLite; survives restarts
- Support for named presets: `disk-check`, `git-pull`, `container-health-ping`

### Email Monitoring (`/email`)
- `GET /email/unread` — unread email count + subject/from summary (IMAP)
- `GET /email/search` — search by sender, subject, date range
- `GET /email/thread/:id` — fetch full thread
- Integrates with Himalaya CLI config or direct IMAP via `imapflow`
- Rate-limited: cache 5 min, configurable per account

### Log Aggregation (`/logs`)
- `GET /logs/files` — list available log files (journald, nginx, app logs)
- `GET /logs/tail/:source` — tail N lines from a source
- `GET /logs/search` — full-text search across indexed log lines
- Sources: journald, `/var/log/`, Docker container logs
- Configurable log sources in `.env` or config file
- SQLite FTS5 index for fast search

### OpenClaw Integration Hooks (`/hooks`)
- `POST /hooks/agent-event` — receive structured events from OpenClaw agents
- `GET /hooks/events` — list recent events (paginated)
- `POST /hooks/notify` — send a notification to a configured Telegram/Discord channel
- Webhook secret verification (HMAC-SHA256)
- Events stored in SQLite with full payload; TTL cleanup

---

## Phase 3: Live Updates & Alerting

Phase 3 makes Chef API reactive: containers emit events in real time, thresholds trigger webhooks, and a lightweight metrics endpoint feeds dashboards.

### WebSocket Live Updates
- `WS /ws/containers` — real-time container state changes (Docker events stream)
- `WS /ws/logs/:id` — live log streaming for a container
- `WS /ws/system` — live CPU/memory/disk updates at configurable interval
- Connection auth via `?key=<CHEF_API_KEY>` query param
- Multiplexed channels with topic subscription

### Alerting Webhooks (`/alerts`)
- `GET /alerts/rules` — list active alert rules
- `POST /alerts/rules` — create rule: threshold type, target, condition, webhook URL
- `DELETE /alerts/rules/:id` — delete rule
- Alert types:
  - Container stopped unexpectedly
  - Disk usage > N%
  - Memory usage > N%
  - SSH command exit code != 0
  - GitHub CI failure on a watched repo
- Delivery: HTTP POST to webhook URL (Discord, Telegram, custom)
- Retry with exponential backoff; failure stored in SQLite

### Metrics Dashboard Endpoint (`/metrics`)
- `GET /metrics` — Prometheus-compatible text format (for Grafana/scraping)
- `GET /metrics/snapshot` — JSON snapshot of current system + container metrics
- Metrics: container count by state, CPU load, memory %, disk %, SSH job success rate
- Optional: expose via `/metrics/push` to push to a Pushgateway

---

## Phase 4: Fleet Management & Secrets

Phase 4 turns Chef API into a multi-server orchestration layer with secure secrets handling.

### Ansible / Playbook Runner (`/ansible`)
- `GET /ansible/playbooks` — list playbooks from a configured directory
- `POST /ansible/playbooks/:name/run` — run a playbook (async, returns job ID)
- `GET /ansible/jobs/:id` — job status and output
- `GET /ansible/jobs/:id/stream` — SSE stream of live output
- `GET /ansible/inventory` — show current inventory
- Playbook directory configurable via `ANSIBLE_PLAYBOOKS_DIR` env var
- Run history stored in `job_history` table

### Multi-Server Fleet Management (`/fleet`)
- `GET /fleet/servers` — all servers with last-seen, OS, load, disk
- `POST /fleet/servers` — add server to fleet
- `DELETE /fleet/servers/:name` — remove server
- `POST /fleet/run` — run command across all or selected servers (parallel)
- `GET /fleet/status` — health summary across fleet
- Results aggregated; per-server status in response

### Secrets Vault — Bitwarden Integration (`/secrets`)
- `GET /secrets` — list secret names (never values) from Bitwarden vault
- `GET /secrets/:name` — retrieve a secret by name (requires re-auth or session token)
- `POST /secrets/inject` — inject secrets into a named service's env at runtime
- Backed by `bw` CLI (Bitwarden CLI) with session token management
- Secrets never logged; response redaction middleware
- Optional: local encrypted SQLite fallback for offline mode

---

## Phase 5: Music Production Tooling

Because Chef API lives on SOLCloud and SOLCloud is also a music production server. Why not index the sample library and make it searchable?

### DAW Project Indexer (`/music/projects`)
- `GET /music/projects` — list DAW project files (Bitwig `.bwproject`, Ableton `.als`, REAPER `.rpp`)
- `GET /music/projects/:id` — project metadata: name, BPM, key, track count, last modified
- `POST /music/projects/scan` — trigger a rescan of configured project directories
- `GET /music/projects/recent` — recently opened/modified projects
- Metadata extracted via file parsing; stored in SQLite
- Configurable `MUSIC_PROJECTS_DIR` env var

### Sample Library Search (`/music/samples`)
- `GET /music/samples/search` — search by filename, tag, BPM range, key
- `GET /music/samples/:id` — sample metadata: path, duration, sample rate, BPM (if tagged)
- `POST /music/samples/scan` — index a directory of samples
- `GET /music/samples/tags` — all unique tags in the index
- SQLite FTS5 for fast text search on filename + tags
- Supports `.wav`, `.aif`, `.flac`, `.mp3`

### BPM & Key Detection (`/music/analyze`)
- `POST /music/analyze/bpm` — detect BPM of an audio file (path or upload)
- `POST /music/analyze/key` — detect musical key
- `POST /music/analyze/batch` — analyze a directory; store results in sample index
- Backed by `aubio` CLI or `essentia` for analysis
- Results cached in SQLite; re-analysis on file change (mtime check)
- Returns confidence score alongside detected value

---

## Notes

- Phases are not strictly sequential — Phase 3 alerting may come before Phase 2 cron if that's what's needed.
- All new routes follow the same pattern: Fastify plugin, Zod validation, SQLite cache, error handling.
- Nothing goes to prod without a test.
