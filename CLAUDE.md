# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chef API — a TypeScript/Fastify REST API for local server orchestration across five domains: GitHub, Docker, SSH, System monitoring, and TODO management. Uses SQLite for caching/state, API key auth, and auto-deploys via GitHub Actions to SOLCloud.

## Commands

```bash
npm run dev          # Hot-reload dev server (ts-node-dev, port 4242)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled output (production)
npm run typecheck    # Type-check without emitting files
```

No test framework is configured yet. When adding tests, use Vitest (aligns with the TypeScript-first stack). Future test commands should follow:
```bash
npm test             # Run all tests
npm test -- --grep "pattern"  # Run specific test
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

**Boot order** (`src/index.ts`): Fastify instance → Swagger → cachePlugin → authPlugin → route registration → listen.

**Plugins** (`src/plugins/`):
- `auth.ts` — `onRequest` hook checking `X-Chef-API-Key` header. Exempts `/docs/*` and `/system/health`.
- `cache.ts` — SQLite-backed `fastify.cache` with TTL (get/set/del/delPattern). GitHub routes cache 60s, Docker routes 10s.

**Config** (`src/config.ts`): Zod-validated env vars loaded from `.env`. Exits on validation failure. SSH_HOSTS uses CSV format: `name:user@host:keypath,...`

**Database** (`src/db.ts`): SQLite via better-sqlite3 with WAL mode. Tables: `cache`, `todos`, `job_history`. Location: `DB_PATH` env var, defaults to `~/.chef-api/chef.db` (bare metal) or `/app/data/chef.db` (Docker).

## Key Conventions

- **Validation**: Zod schemas for all request input (defined in route files)
- **Error responses**: Fastify default error handling; services throw, routes catch and reply
- **Cache invalidation**: Mutation routes (POST) call `fastify.cache.delPattern()` to bust related caches
- **SSH job logging**: All SSH executions are recorded in `job_history` table
- **Docker logs**: Service strips Docker multiplexed stream headers (8-byte frames) before returning

## CI/CD

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
