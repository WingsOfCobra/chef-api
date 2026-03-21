# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chef API — a TypeScript/Fastify REST API for local server orchestration across nine domains: GitHub, Docker, SSH, System monitoring, TODO management, Cron scheduling, Webhook hooks, Log aggregation, and Email monitoring. Uses SQLite for caching/state, API key auth, and auto-deploys via GitHub Actions to SOLCloud.

## Commands

```bash
npm run dev          # Hot-reload dev server (ts-node-dev, port 4242)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled output (production)
npm run typecheck    # Type-check without emitting files
npm test             # Run all tests (Vitest)
npm run test:watch   # Watch mode
npm run test:coverage # With coverage report
```

Docker:
```bash
docker compose -f docker-compose.dev.yml up --build   # Dev with live build
docker compose up -d                                    # Production (pulls from GHCR)
```

## Architecture

**Pattern:** Routes → Services → External APIs/OS. Each domain has a matched pair under `src/routes/` and `src/services/`.

| Domain | Route prefix | Service | External dependency |
|--------|-------------|---------|-------------------|
| GitHub | `/github` | `github.service.ts` | Octokit (REST API) |
| Docker | `/docker` | `docker.service.ts` | axios → Docker socket |
| SSH | `/ssh` | `ssh.service.ts` | node-ssh |
| System | `/system` | `system.service.ts` | Node APIs + execSync |
| TODO | `/todo` | — (inline, uses db) | SQLite + file parsing |
| Cron | `/cron` | `cron.service.ts` + `cron-scheduler.ts` | croner + SSH/HTTP execution |
| Hooks | `/hooks` | `hooks.service.ts` | crypto (HMAC), axios (Telegram/Discord) |
| Logs | `/logs` | `logs.service.ts` | execSync (tail/journalctl), FTS5 |
| Email | `/email` | `email.service.ts` | imapflow (IMAP) |

**Boot order** (`src/index.ts`): Fastify instance → Swagger → cachePlugin → authPlugin → route registration → listen → initScheduler → initLogSources → cleanup intervals.

**Plugins** (`src/plugins/`):
- `auth.ts` — `onRequest` hook checking `X-Chef-API-Key` header. Exempts `/docs/*`, `/system/health`, and `/hooks/agent-event` (uses webhook secret instead).
- `cache.ts` — SQLite-backed `fastify.cache` with TTL (get/set/del/delPattern). GitHub routes cache 60s, Docker routes 10s, email routes configurable.

**Config** (`src/config.ts`): Zod-validated env vars loaded from `.env`. Exits on validation failure. SSH_HOSTS uses CSV format: `name:user@host:keypath,...`. LOG_SOURCES uses CSV format: `name:type:path,...`.

**Database** (`src/db.ts`): SQLite via better-sqlite3 with WAL mode. Tables: `cache`, `todos`, `job_history`, `cron_jobs`, `cron_history`, `hook_events`, `log_sources`. Virtual table: `log_index` (FTS5). Location: `DB_PATH` env var, defaults to `~/.chef-api/chef.db` (bare metal) or `/app/data/chef.db` (Docker).

## Key Conventions

- **Validation**: Zod schemas for all request input (defined in route files)
- **Error responses**: Fastify default error handling; services throw, routes catch and reply
- **Cache invalidation**: Mutation routes (POST) call `fastify.cache.delPattern()` to bust related caches
- **Job logging**: SSH and cron executions are recorded in `job_history` + `cron_history` tables
- **Docker logs**: Service strips Docker multiplexed stream headers (8-byte frames) before returning
- **Cron scheduler**: Module-level `Map<number, Cron>` loaded from DB on startup; jobs re-fetch state before execution
- **Webhook auth**: `/hooks/agent-event` bypasses API key auth, uses HMAC-SHA256 signature via `X-Webhook-Signature` header
- **Log indexing**: FTS5 virtual table for full-text search; periodic indexing via `setInterval`
- **Email**: Lazy IMAP connections; 503 returned when not configured

## Testing

- **Framework**: Vitest with globals, node environment
- **Test helpers**: `src/test/helpers.ts` — `buildApp()` creates Fastify with real plugins, `authHeaders()` for auth
- **Setup**: `src/test/setup.ts` — sets all env vars (including `DB_PATH=:memory:`) before module imports
- **Pattern**: Service tests mock external deps (SSH, axios, IMAP), route tests use `fastify.inject()`
- **Coverage**: 156 tests across 20 files

## CI/CD

- **ci.yml**: Every PR to `main` → typecheck + test + build must all pass (PR gate)
- **publish.yml**: Every push to `main` → builds Docker image → pushes to `ghcr.io/wingsofcobra/chef-api` with `sha-<commit>` and `latest` tags
- **deploy.yml**: After publish succeeds → SSH into SOLCloud → `docker compose pull && up -d`
- Required secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_DIR`

## Workflow

Follow this strict order for all changes:

1. **Plan** — Enter plan mode, outline what changes are needed and why
2. **Branch** — Create a descriptive branch off `main` (`feat/`, `fix/`, `refactor/` prefix)
3. **Code** — Implement changes following existing patterns (route + service pair)
4. **Test** — Write tests covering the changes; run typecheck at minimum
5. **Verify** — `npm run build` must succeed; run tests if available
6. **Push & PR** — Push branch, create PR with summary and test plan
7. **Review** — Review the PR diff without prior conversation context (fresh eyes)
8. **Merge** — Only after review passes
