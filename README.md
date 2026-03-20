# Chef API

Chef's local orchestration API. A single Fastify (TypeScript) service that gives programmatic access to everything on your server: GitHub, Docker containers, SSH hosts, disk/process info, and task management.

Built to be called by AI agents and automation scripts without fiddling with multiple CLIs.

---

## What it does

| Domain   | What you get |
|----------|-------------|
| GitHub   | Repos, PRs with CI status, issues, workflow runs, notifications |
| Docker   | Container list/health, restart/stop, logs, disk stats |
| SSH      | Run arbitrary commands on named hosts |
| System   | Health, disk usage, top processes |
| TODO     | Read/write task list (DB + parses `TODO.md`) |

All routes are protected by an API key. Responses are cached in SQLite (60s for GitHub, 10s for Docker).

OpenAPI docs auto-generated at `/docs`.

**Access:** When deployed behind WireGuard, connect to your VPN and open `http://<your-wireguard-ip>:4242`. Swagger docs at `http://<your-wireguard-ip>:4242/docs`. The port binds only on the configured interface — not exposed to the public internet.

---

## Setup

### Requirements

- Node.js 20+
- A GitHub personal access token (for GitHub routes)
- SSH keys for your remote hosts

### 1. Clone and install

```bash
git clone https://github.com/WingsOfCobra/chef-api.git
cd chef-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required: a strong random secret
CHEF_API_KEY=your-random-secret-here

# GitHub personal access token (repo + notifications scope)
GITHUB_TOKEN=ghp_...

# Server binding (use 0.0.0.0 inside Docker; Docker handles interface binding via ports config)
PORT=4242
HOST=0.0.0.0

# Docker socket path
DOCKER_SOCKET=/var/run/docker.sock

# SSH hosts: name:user@host:keypath, comma-separated
SSH_HOSTS=server1:user@192.168.1.10:~/.ssh/keyname,server2:user@192.168.1.11:~/.ssh/keyname

# Path to TODO.md for parsing
TODO_PATH=/path/to/your/TODO.md

# Docker Compose: which interface to bind (e.g. your WireGuard IP or 127.0.0.1)
BIND_ADDR=127.0.0.1

# Docker Compose: host path to mount as /workspace inside the container (read-only)
WORKSPACE_PATH=/path/to/your/workspace
```

### 3. Build and run

```bash
npm run build
npm start
```

Or for development with hot reload:

```bash
npm run dev
```

API is now at `http://localhost:4242`. Docs at `http://localhost:4242/docs`.

---

## Authentication

All routes except `GET /system/health` and `/docs` require:

```
X-Chef-API-Key: <your CHEF_API_KEY>
```

---

## Routes

### GitHub

#### `GET /github/repos`

List your repos (or an org's repos).

Query params:
- `org` — optional org name

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/github/repos
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/github/repos?org=my-org
```

Response:
```json
[
  {
    "name": "chef-api",
    "fullName": "my-org/chef-api",
    "description": "Chef's local orchestration API",
    "stars": 0,
    "lastPush": "2026-03-20T21:00:00Z",
    "openIssues": 2,
    "url": "https://github.com/my-org/chef-api",
    "private": false
  }
]
```

#### `GET /github/repos/:owner/:repo/prs`

Open PRs with CI status.

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/github/repos/my-org/chef-api/prs
```

Response:
```json
[
  {
    "number": 1,
    "title": "Add Docker routes",
    "author": "username",
    "createdAt": "2026-03-20T20:00:00Z",
    "updatedAt": "2026-03-20T21:00:00Z",
    "url": "https://github.com/...",
    "draft": false,
    "ciStatus": "success"
  }
]
```

#### `GET /github/repos/:owner/:repo/issues`

Open issues (excludes PRs).

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/github/repos/my-org/chef-api/issues
```

#### `POST /github/repos/:owner/:repo/issues`

Create an issue.

```bash
curl -X POST \
  -H "X-Chef-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Bug: something broken", "body": "Details here", "labels": ["bug"]}' \
  http://localhost:4242/github/repos/my-org/chef-api/issues
```

#### `GET /github/repos/:owner/:repo/workflows`

Recent workflow runs.

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/github/repos/my-org/chef-api/workflows
```

#### `GET /github/notifications`

Unread GitHub notifications.

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/github/notifications
```

---

### Docker

#### `GET /docker/containers`

All containers with status, health, uptime, ports.

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/docker/containers
```

Response:
```json
[
  {
    "id": "a1b2c3d4e5f6",
    "name": "nginx",
    "image": "nginx:alpine",
    "status": "Up 2 days (healthy)",
    "state": "running",
    "health": "healthy",
    "uptime": "Up 2 days (healthy)",
    "ports": ["80:80/tcp", "443:443/tcp"]
  }
]
```

#### `POST /docker/containers/:id/restart`

Restart a container by ID or name. Returns 204.

```bash
curl -X POST -H "X-Chef-API-Key: $KEY" http://localhost:4242/docker/containers/nginx/restart
```

#### `POST /docker/containers/:id/stop`

Stop a container. Returns 204.

```bash
curl -X POST -H "X-Chef-API-Key: $KEY" http://localhost:4242/docker/containers/nginx/stop
```

#### `GET /docker/containers/:id/logs`

Last N lines of container logs.

Query params:
- `lines` — number of lines (default: 100)

```bash
curl -H "X-Chef-API-Key: $KEY" "http://localhost:4242/docker/containers/nginx/logs?lines=50"
```

#### `GET /docker/stats`

Disk usage, container counts, image/volume counts.

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/docker/stats
```

Response:
```json
{
  "containers": { "total": 8, "running": 6, "stopped": 2, "paused": 0 },
  "images": 12,
  "volumes": 4,
  "diskUsage": {
    "images": "3.42 GB",
    "containers": "124.50 MB",
    "volumes": "890.00 MB",
    "buildCache": "0 B"
  }
}
```

---

### SSH

#### `GET /ssh/hosts`

List configured SSH host names (no IPs or keys exposed via API).

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/ssh/hosts
```

Response:
```json
[
  { "name": "server1", "user": "deploy", "host": "192.168.1.10" },
  { "name": "server2", "user": "deploy", "host": "192.168.1.11" }
]
```

#### `POST /ssh/run`

Run a command on a named host. Host names come from `SSH_HOSTS` in your `.env`.

```bash
curl -X POST \
  -H "X-Chef-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"host": "server1", "command": "df -h"}' \
  http://localhost:4242/ssh/run
```

Response:
```json
{
  "stdout": "Filesystem  Size  Used Avail Use% Mounted on\n...",
  "stderr": "",
  "code": 0
}
```

---

### System

#### `GET /system/health`

Health check — **no auth required**.

```bash
curl http://localhost:4242/system/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 3612,
  "uptimeHuman": "1h 0m",
  "hostname": "myserver",
  "platform": "linux x64",
  "nodeVersion": "v20.11.0",
  "memory": {
    "total": "16.00 GB",
    "free": "4.20 GB",
    "usedPercent": "73.8%"
  },
  "loadAvg": [0.45, 0.52, 0.48],
  "timestamp": "2026-03-20T22:00:00.000Z"
}
```

#### `GET /system/disk`

Disk usage per mount point.

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/system/disk
```

Response:
```json
[
  {
    "filesystem": "/dev/sda1",
    "size": "100G",
    "used": "42G",
    "available": "58G",
    "usePercent": "43%",
    "mountpoint": "/"
  }
]
```

#### `GET /system/processes`

Top processes by CPU usage.

Query params:
- `limit` — number of processes (default: 20)

```bash
curl -H "X-Chef-API-Key: $KEY" "http://localhost:4242/system/processes?limit=10"
```

---

### TODO

#### `GET /todo`

List all TODO items: database entries + parsed from `TODO.md` (set `TODO_PATH` in `.env`).

```bash
curl -H "X-Chef-API-Key: $KEY" http://localhost:4242/todo
```

Response:
```json
{
  "db": [
    {
      "id": 1,
      "title": "Implement Phase 2 cron API",
      "description": null,
      "completed": 0,
      "created_at": "2026-03-20 22:00:00",
      "updated_at": "2026-03-20 22:00:00"
    }
  ],
  "file": [
    { "id": 10000, "title": "Review PR", "completed": false, "source": "file" }
  ],
  "total": 2
}
```

#### `POST /todo`

Add a TODO item (stored in SQLite).

```bash
curl -X POST \
  -H "X-Chef-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Write tests for Docker routes", "description": "Unit + integration"}' \
  http://localhost:4242/todo
```

#### `PATCH /todo/:id`

Update or complete a TODO item.

```bash
curl -X PATCH \
  -H "X-Chef-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}' \
  http://localhost:4242/todo/1
```

---

## Deployment

### Option A: Docker Compose (recommended)

Bind `BIND_ADDR` to your WireGuard interface IP so the port is only reachable over the VPN.

**First-time server setup:**

```bash
git clone https://github.com/WingsOfCobra/chef-api.git ~/chef-api
cd ~/chef-api

cp .env.example .env
# Edit .env — set CHEF_API_KEY, GITHUB_TOKEN, SSH_HOSTS, BIND_ADDR, etc.

docker compose up -d --build
```

After that, every push to `main` auto-deploys via GitHub Actions (`docker compose up -d --build`).

### Option B: PM2 (bare metal)

```bash
git clone https://github.com/WingsOfCobra/chef-api.git ~/chef-api
cd ~/chef-api
cp .env.example .env
# Edit .env
npm install
npm run build
pm2 start dist/index.js --name chef-api
pm2 save
pm2 startup  # enable auto-start on reboot
```

---

## GitHub Actions Auto-Deploy

The workflow at `.github/workflows/deploy.yml` deploys on every push to `main` via SSH.

### Setting up the deploy key

1. Generate a key pair on your server (or locally):
   ```bash
   ssh-keygen -t ed25519 -C "chef-api-deploy" -f ~/.ssh/chef_api_deploy
   ```

2. Add the **public key** to the server's `~/.ssh/authorized_keys`:
   ```bash
   cat ~/.ssh/chef_api_deploy.pub >> ~/.ssh/authorized_keys
   ```

3. Add these **GitHub repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |--------|-------|
   | `DEPLOY_SSH_KEY` | Contents of `~/.ssh/chef_api_deploy` (private key) |
   | `DEPLOY_HOST` | Server IP or hostname |
   | `DEPLOY_USER` | Deploy user (e.g. `ubuntu`, `deploy`) |
   | `DEPLOY_DIR` | (optional) Full path to deploy directory; defaults to `$HOME/chef-api` |

4. Push to `main` — the action SSHes in, pulls latest, and runs `docker compose up -d --build`.

---

## Caching

| Route type | TTL |
|-----------|-----|
| GitHub responses | 60 seconds |
| Docker responses | 10 seconds |
| Write operations | Invalidates relevant cache keys immediately |

Cache stored in SQLite at `~/.chef-api/chef.db` (bare metal) or `/app/data/chef.db` (Docker, mapped to `./data/`).
