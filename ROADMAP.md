# Chef API — Roadmap

This document tracks what's built, what's planned, and what's dreamed about for Chef API.

---

## Current Status: Phase 3 Live Updates & Alerting ✅

Phase 1, 2, and 3 are complete. The API covers 11 domains with cron scheduling, log aggregation, webhook hooks, email monitoring, WebSocket live feeds, and an alert rules engine. Test infrastructure (Vitest, 180+ tests) and CI/CD pipeline are fully operational.

---

## Phase 1: MVP ✅

### GitHub (`/github`)
- [x] `GET /github/repos` — list repos with stars, last push, open issues
- [x] `GET /github/repos/:owner/:repo` — detailed repo info (language, topics, license, etc.)
- [x] `GET /github/repos/:owner/:repo/branches` — list branches with protection status
- [x] `GET /github/repos/:owner/:repo/commits` — recent commits
- [x] `GET /github/repos/:owner/:repo/releases` — releases list
- [x] `GET /github/repos/:owner/:repo/prs` — open PRs with CI check status
- [x] `GET /github/repos/:owner/:repo/issues` — open issues
- [x] `POST /github/repos/:owner/:repo/issues` — create issue
- [x] `GET /github/repos/:owner/:repo/workflows` — recent workflow runs
- [x] `GET /github/prs` — aggregated open PRs across top 5 repos
- [x] `GET /github/issues` — aggregated open issues across top 5 repos
- [x] `GET /github/workflows` — aggregated recent workflows across top 5 repos
- [x] `GET /github/notifications` — unread notifications (500ms timeout + stale cache)

### Docker (`/docker`)
- [x] `GET /docker/containers` — all containers with state, health, ports
- [x] `POST /docker/containers/:id/restart` — restart container
- [x] `POST /docker/containers/:id/stop` — stop container
- [x] `GET /docker/containers/:id/logs` — last N lines of logs
- [x] `GET /docker/containers/:id/inspect` — full container inspect
- [x] `GET /docker/containers/:id/stats` — per-container CPU/mem/network stats
- [x] `GET /docker/stats` — aggregate image/volume/container disk usage
- [x] `GET /docker/images` — list images
- [x] `GET /docker/networks` — list networks

### SSH (`/ssh`)
- [x] `GET /ssh/hosts` — list configured hosts
- [x] `POST /ssh/run` — run command on named host; logged to job_history

### System (`/system`)
- [x] `GET /system/health` — uptime, CPU, memory, load (no auth required)
- [x] `GET /system/disk` — disk usage per mount
- [x] `GET /system/memory` — memory details
- [x] `GET /system/network` — network byte counters
- [x] `GET /system/processes` — top processes by CPU

### TODO (`/todo`)
- [x] `GET /todo` — DB items + parsed from `TODO.md`
- [x] `POST /todo` — add item to DB
- [x] `PATCH /todo/:id` — update/complete item
- [x] `DELETE /todo/:id` — delete DB item

---

## Phase 2: Automation & Integration ✅

### Cron Job Management (`/cron`)
- [x] `GET /cron/jobs` — list all scheduled jobs with next run time, last run result
- [x] `POST /cron/jobs` — create a cron job (preset or custom schedule + SSH/HTTP)
- [x] `DELETE /cron/jobs/:id` — remove a job
- [x] `POST /cron/jobs/:id/run` — trigger job immediately
- [x] `GET /cron/jobs/:id/history` — last N run results with stdout/stderr/exit code
- [x] `GET /cron/presets` — available presets (disk-check, git-pull, container-health-ping)
- [x] `GET /cron/health` — scheduler status and next run times
- [x] Persistent cron state in SQLite; survives restarts
- [x] Local job execution via SSH to host (full tooling: jq, bash, himalaya, etc.)
- [x] SSH key mounted via docker-compose.override.yml

### Email Monitoring (`/email`)
- [x] `GET /email/unread` — unread count + subject/from summary (8s timeout + stale cache)
- [x] `GET /email/search` — search by sender, subject, date range
- [x] `GET /email/thread/:uid` — fetch full message by UID

### Log Aggregation (`/logs`)
- [x] `GET /logs/files` — list configured log sources
- [x] `GET /logs/tail/:source` — tail N lines from a source
- [x] `GET /logs/search` — full-text search across indexed log lines
- [x] `GET /logs/stats` — index statistics per source

### OpenClaw Integration Hooks (`/hooks`)
- [x] `POST /hooks/agent-event` — receive structured events from OpenClaw agents (HMAC-SHA256)
- [x] `GET /hooks/events` — list recent events (paginated, filterable)
- [x] `POST /hooks/notify` — send notification to Telegram/Discord

### Services Monitoring (`/services`)
- [x] `GET /services/status` — systemd service status via SSH (30s cache, 6s timeout, stale fallback)
- [x] Configurable via `MONITORED_SERVICES` env (docker, nginx, sshd, fail2ban, postgresql, redis, cron, ufw)
- [x] Uptime parsing fixed for systemctl locale timestamp format

---

## Phase 3: Live Updates & Alerting ✅

### WebSocket Live Updates (`/ws`)
- [x] `WS /ws/system` — live CPU/memory/load push every 2s
- [x] `WS /ws/containers` — real-time Docker container state events (start/stop/die/restart)
- [x] `WS /ws/logs/:id` — live log streaming for a container (max 3 concurrent per container)
- [x] Auth via `?key=<CHEF_API_KEY>` query param
- [x] Clean teardown of intervals/streams/processes on WS close

### Alerting Webhooks (`/alerts`)
- [x] `GET /alerts/rules` — list all alert rules
- [x] `POST /alerts/rules` — create rule (type, target, threshold, webhook URL)
- [x] `DELETE /alerts/rules/:id` — delete rule
- [x] `PATCH /alerts/rules/:id` — update / enable / disable rule
- [x] `GET /alerts/events` — recent alert events (last 50, paginated)
- [x] `POST /alerts/rules/:id/test` — fire a test webhook immediately
- [x] Alert types: `container_stopped`, `disk_usage`, `memory_usage`, `cron_failure`, `github_ci_failure`
- [x] Background checker runs every 60s evaluating disk/memory/cron thresholds
- [x] Webhook delivery with exponential backoff retry (0s / 5s / 30s)
- [x] Events stored in SQLite with delivery status tracking

### Metrics Endpoint (`/metrics`)
- [ ] `GET /metrics` — Prometheus-compatible text format (for Grafana/scraping)
- [ ] `GET /metrics/snapshot` — JSON snapshot of current system + container metrics
- [ ] Metrics: container count by state, CPU load, memory %, disk %, SSH job success rate
- [ ] Optional: push to Prometheus Pushgateway via `/metrics/push`

---

## Phase 4: Fleet Management & Secrets

### Ansible / Playbook Runner (`/ansible`)
- [ ] `GET /ansible/playbooks` — list playbooks from configured directory
- [ ] `POST /ansible/playbooks/:name/run` — run a playbook async, returns job ID
- [ ] `GET /ansible/jobs/:id` — job status and output
- [ ] `GET /ansible/jobs/:id/stream` — SSE stream of live output
- [ ] `GET /ansible/inventory` — show current inventory
- [ ] Run history stored in `job_history` table

### Multi-Server Fleet Management (`/fleet`)
- [ ] `GET /fleet/servers` — all servers with last-seen, OS, load, disk
- [ ] `POST /fleet/servers` — add server to fleet
- [ ] `DELETE /fleet/servers/:name` — remove server
- [ ] `POST /fleet/run` — run command across all or selected servers (parallel)
- [ ] `GET /fleet/status` — health summary across fleet

### Secrets Vault — Bitwarden Integration (`/secrets`)
- [ ] `GET /secrets` — list secret names (never values)
- [ ] `GET /secrets/:name` — retrieve a secret by name
- [ ] `POST /secrets/inject` — inject secrets into a service's env at runtime
- [ ] Backed by `bw` CLI; session token management
- [ ] Secrets never logged; response redaction middleware
- [ ] Optional: local encrypted SQLite fallback for offline mode

---

## Phase 5: Music Production Tooling

### DAW Project Indexer (`/music/projects`)
- [ ] `GET /music/projects` — list DAW project files (Bitwig, Ableton, REAPER)
- [ ] `GET /music/projects/:id` — project metadata: BPM, key, track count, last modified
- [ ] `POST /music/projects/scan` — trigger rescan of configured directories
- [ ] `GET /music/projects/recent` — recently opened/modified projects

### Sample Library Search (`/music/samples`)
- [ ] `GET /music/samples/search` — search by filename, tag, BPM range, key
- [ ] `GET /music/samples/:id` — sample metadata: path, duration, sample rate, BPM
- [ ] `POST /music/samples/scan` — index a directory of samples
- [ ] `GET /music/samples/tags` — all unique tags in the index
- [ ] SQLite FTS5 for fast text search

### BPM & Key Detection (`/music/analyze`)
- [ ] `POST /music/analyze/bpm` — detect BPM of an audio file
- [ ] `POST /music/analyze/key` — detect musical key
- [ ] `POST /music/analyze/batch` — analyze a directory; store results in sample index
- [ ] Backed by `aubio` CLI or `essentia`

---

## Notes

- Phases are not strictly sequential — items may be pulled forward based on priority.
- All routes follow the same pattern: Fastify plugin, Zod validation, SQLite cache, OpenAPI schema, error handling.
- Nothing goes to prod without a test.
- CI: Typecheck → Test → Build on every PR. Deploy on merge to `main`.
- Git rule: **never push to `main` directly**. Always branch + PR.
