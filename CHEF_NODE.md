# Chef-Node Architecture

## Overview

Chef API supports two deployment modes:

1. **Master mode** (default): Full-featured API server with GitHub, cron jobs, todos, alerts, webhooks, email, secrets, Ansible, fleet management, and all administrative features.
2. **Node mode** (lightweight): Minimal metrics-only agent that exposes system stats, Docker containers, and service status — designed to run on remote servers.

## Concept

**chef-api (master)** runs on the main orchestration server (e.g., SOLCloud). It handles:
- GitHub operations (repos, PRs, issues, workflows)
- Cron job scheduling and management
- Todo list management
- Alert rules and webhook notifications
- Email monitoring
- Bitwarden secrets vault integration
- Ansible playbook execution
- Fleet management across multiple servers
- Log aggregation and search
- SSH command execution
- Full database (SQLite) with persistent state

**chef-node (lightweight agent)** runs on remote servers (e.g., zartmann, schrombus). It handles ONLY:
- System metrics: CPU, memory, disk, uptime, load
- Docker container list, stats, logs
- Systemd service status (for monitored services)
- Prometheus/JSON metrics export

All other routes return `503 Service Unavailable` with `{ error: "Not available in node mode" }`.

## Deployment Model

### Master Mode (Default)

```bash
# .env
CHEF_NODE_MODE=false
# ... all other config vars (GITHUB_TOKEN, SSH_HOSTS, etc.)
```

**Docker Compose:**
```yaml
services:
  chef-api:
    image: ghcr.io/wingsofcobra/chef-api:latest
    ports:
      - "4242:4242"
    environment:
      - CHEF_NODE_MODE=false
      - CHEF_API_KEY=${CHEF_API_KEY}
      # ... full config
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
```

### Node Mode (Lightweight Agent)

```bash
# .env (minimal)
CHEF_NODE_MODE=true
CHEF_API_KEY=your-secret-key
PORT=4242
HOST=0.0.0.0
DOCKER_SOCKET=/var/run/docker.sock
MONITORED_SERVICES=nginx,postgresql,docker
```

**Docker Compose:**
```yaml
services:
  chef-node:
    image: ghcr.io/wingsofcobra/chef-api:latest
    ports:
      - "4242:4242"
    environment:
      - CHEF_NODE_MODE=true
      - CHEF_API_KEY=${CHEF_API_KEY}
      - PORT=4242
      - HOST=0.0.0.0
      - DOCKER_SOCKET=/var/run/docker.sock
      - MONITORED_SERVICES=nginx,postgresql,docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
```

**Key differences:**
- No database volume needed (node mode uses in-memory SQLite for cache only)
- Minimal environment variables (no GitHub token, SSH hosts, webhooks, email, etc.)
- Smaller attack surface (only metrics endpoints exposed)
- Lower resource usage

## How neo-dock Connects

The **neo-dock** dashboard (or any monitoring client) can connect to both master and node instances via the `CHEF_SERVERS` environment variable:

```bash
# neo-dock .env
CHEF_SERVERS=https://chef-api.solcloud.io,http://zartmann:4242,http://schrombus:4242
```

**Client behavior:**
- **Personal data** (todos, GitHub PRs, alerts, cron jobs): fetched from the **master** (first server in list or server where `/node/info` reports `mode: "master"`)
- **Remote server metrics** (CPU, disk, containers, services): fetched from **node** instances (servers where `/node/info` reports `mode: "node"`)

## Available Routes in Node Mode

### Always Available
- `GET /node/info` — returns `{ mode: "node"|"master", version, hostname, uptime }`
- `GET /system/health` — health check endpoint (auth exempted)
- `GET /docs/*` — Swagger UI (auth exempted)

### Node-Mode Allowed (Metrics Only)
- `GET /system/info` — system info (OS, uptime, hostname)
- `GET /system/cpu` — CPU usage
- `GET /system/memory` — memory usage
- `GET /system/disk` — disk usage
- `GET /system/load` — system load averages
- `GET /docker/containers` — list Docker containers
- `GET /docker/containers/:id/stats` — container stats
- `GET /docker/containers/:id/logs` — container logs
- `GET /services/status` — systemd service status
- `GET /metrics` — Prometheus/JSON metrics

### Disabled in Node Mode (503 Error)
All other routes:
- `/github/*`
- `/todo/*`
- `/cron/*`
- `/hooks/*`
- `/alerts/*`
- `/secrets/*`
- `/ansible/*`
- `/fleet/*`
- `/logs/*` (full log aggregation/search)
- `/email/*`
- `/ssh/*`
- POST/PUT/DELETE operations on `/system/*` or `/docker/*`

## Startup Behavior

### Master Mode
```
🍳 Chef API running at http://0.0.0.0:4242
📚 Swagger docs at http://0.0.0.0:4242/docs
[chef-api] Running in MASTER mode — full API active
✓ Cron scheduler initialized (5 jobs scheduled)
✓ Alert checker started
✓ Log indexing enabled (3 sources, interval: 300s)
```

### Node Mode
```
🍳 Chef API running at http://0.0.0.0:4242
📚 Swagger docs at http://0.0.0.0:4242/docs
[chef-node] Running in NODE mode — only metrics endpoints active
[chef-node] Skipping cron scheduler initialization
[chef-node] Skipping alert checker
[chef-node] Skipping log indexing
```

## Security Considerations

- **Authentication**: Both modes require `X-Chef-API-Key` header (except for health/docs routes)
- **Firewall**: In production, node endpoints should be accessible only from the master server or trusted monitoring dashboards (use Tailscale, VPN, or firewall rules)
- **Minimal permissions**: Node mode doesn't need GitHub tokens, SSH keys, email credentials, or Bitwarden sessions
- **Read-only metrics**: Node mode disables all write operations outside of metrics endpoints

## Testing Node Mode

```bash
# Start in node mode
CHEF_NODE_MODE=true npm run dev

# Verify mode
curl -H "X-Chef-API-Key: your-key" http://localhost:4242/node/info
# → { "mode": "node", "version": "0.1.0", "hostname": "...", "uptime": 123 }

# Allowed: system metrics
curl -H "X-Chef-API-Key: your-key" http://localhost:4242/system/cpu
# → { "usage": 23.5, ... }

# Disallowed: GitHub
curl -H "X-Chef-API-Key: your-key" http://localhost:4242/github/repos
# → 503 { "error": "Not available in node mode" }
```

## Migration Path

1. Deploy **master** on SOLCloud (existing setup)
2. Build and push Docker image (same image for both modes)
3. Deploy **chef-node** on remote servers (zartmann, schrombus) with `CHEF_NODE_MODE=true`
4. Update **neo-dock** `CHEF_SERVERS` to include all instances
5. neo-dock auto-discovers mode via `/node/info` and routes requests accordingly

## Future Enhancements

- **Push-based metrics**: chef-node pushes metrics to master instead of pull-only
- **Agent registration**: chef-node auto-registers with master on startup
- **Certificate auth**: TLS client certs for node ↔ master communication
- **Metric buffering**: chef-node buffers metrics during network outages
- **Distributed cron**: master delegates cron jobs to specific nodes
