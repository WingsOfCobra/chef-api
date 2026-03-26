# Chef API — Roadmap

This document tracks what's built, what's planned, and what's dreamed about for Chef API.

---

## Current Status: Phase 4 Ansible ✅

Phases 1–4 are complete and merged. The API covers 12 domains: system monitoring, Docker, GitHub, email, todos, cron scheduling, log aggregation, webhooks/hooks, alerting, metrics and Ansible playbook runner. Test infrastructure (Vitest, 180+ tests) and CI/CD pipeline are fully operational.

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

### Metrics Endpoint (`/metrics`) ✅
- [x] `GET /metrics` — Prometheus-compatible text format (for Grafana/scraping)
- [x] `GET /metrics/snapshot` — JSON snapshot of current system + container metrics
- [x] Metrics: container count by state, CPU load, memory %, disk %, SSH job success rate

### Network Monitoring (Needed for Neo-Dock Network Monitor Widget)
- [ ] `GET /system/network/connections` — active connections via ss/netstat (proto, local, remote, state, pid)
- [ ] `GET /system/network/bandwidth` — real-time bandwidth per interface (rolling 30s window)
- [ ] `GET /system/network/latency?hosts=` — ping latency to specified hosts

---

## Phase 4: Ansible ✅

### Ansible / Playbook Runner (`/ansible`) ✅
- [x] `GET /ansible/playbooks` — list playbooks from configured directory
- [x] `POST /ansible/playbooks/:name/run` — run a playbook async, returns job ID
- [x] `GET /ansible/jobs/:id` — job status and output
- [x] `GET /ansible/jobs` — list all jobs
- [x] `GET /ansible/inventory` — show current inventory
- [x] Run history stored in `job_history` table

---

## Phase 5: Ecosystem Modules (Neo-Dock Driven)

These are new chef-api domains requested by neo-dock's Phase 3 ecosystem expansion.

### Finance Module (`/finance`)
- [ ] `GET /finance/portfolio` — holdings with current prices
- [ ] `GET /finance/portfolio/history` — historical portfolio value over time
- [ ] `POST /finance/portfolio` — add/update holding
- [ ] `DELETE /finance/portfolio/:id` — remove holding
- [ ] `GET /finance/expenses` — categorized spending (filterable by date range)
- [ ] `POST /finance/expenses` — log expense (manual entry or CSV import)
- [ ] `GET /finance/budget` — monthly budget vs actual spending
- [ ] `POST /finance/budget` — set budget category and amount
- [ ] `GET /finance/alerts` — price alert rules
- [ ] `POST /finance/alerts` — create price alert
- [ ] `DELETE /finance/alerts/:id` — remove price alert
- [ ] Integration: CoinGecko API, Alpha Vantage, Yahoo Finance
- [ ] Storage: SQLite tables for holdings, transactions, budgets

### Smart Home Module (`/home`)
- [ ] `GET /home/devices` — device list from Home Assistant
- [ ] `GET /home/devices/:id` — device state and attributes
- [ ] `POST /home/devices/:id/control` — toggle/set device state
- [ ] `GET /home/rooms` — room groupings with device assignments
- [ ] `GET /home/automations` — Home Assistant automations list
- [ ] `POST /home/automations/:id/toggle` — enable/disable automation
- [ ] `WS /ws/home` — real-time device state changes
- [ ] Integration: Home Assistant WebSocket API, MQTT, Zigbee2MQTT

### Content Feeds (`/feeds`)
- [ ] `GET /feeds` — list configured RSS/Atom feeds
- [ ] `POST /feeds` — add feed URL
- [ ] `DELETE /feeds/:id` — remove feed
- [ ] `GET /feeds/entries` — aggregated entries (paginated, filterable)
- [ ] `GET /feeds/entries/:id` — single entry content

### Calendar (`/calendar`)
- [ ] `GET /calendar/events` — upcoming events from CalDAV/Google Calendar
- [ ] `POST /calendar/events` — create event
- [ ] `GET /calendar/calendars` — list connected calendars

### Uptime Monitor (`/uptime`)
- [ ] `GET /uptime/targets` — list monitored HTTP endpoints
- [ ] `POST /uptime/targets` — add endpoint to monitor
- [ ] `DELETE /uptime/targets/:id` — remove endpoint
- [ ] `GET /uptime/status` — current status + response times + uptime %

### Media Server (`/media`)
- [ ] `GET /media/now-playing` — currently playing (Plex/Jellyfin)
- [ ] `GET /media/library` — library stats (movies, shows, music counts)
- [ ] `GET /media/recent` — recently added items

---

## Notes

- Phases are not strictly sequential — items may be pulled forward based on priority.
- All routes follow the same pattern: Fastify plugin, Zod validation, SQLite cache, OpenAPI schema, error handling.
- Nothing goes to prod without a test.
- CI: Typecheck → Test → Build on every PR. Deploy on merge to `main`.
- Git rule: **never push to `main` directly**. Always branch + PR.
- Neo-Dock contract: see `neo-dock/API-PLAN.md` for exact endpoint requirements.

## Cross-Reference

- **Neo-Dock contract:** `neo-dock/API-PLAN.md` — exact endpoint requirements per neo-dock phase
- **Neo-Dock roadmap:** `neo-dock/ROADMAP.md` — what features depend on which chef-api endpoints

Last updated: 2026-03-23
