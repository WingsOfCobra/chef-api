# Docker Network Integration

## Overview

Chef API uses a shared Docker network (`solcloud`) to enable communication with other SOLCloud services like neo-dock.

## Network Architecture

```
┌─────────────────────────────────────────┐
│         Host (10.13.13.1)              │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   solcloud network (bridge)       │ │
│  │                                   │ │
│  │  ┌──────────────┐  ┌───────────┐ │ │
│  │  │  chef-api    │  │ neo-dock  │ │ │
│  │  │  :4242       │←─┤ :3000     │ │ │
│  │  └──────────────┘  └───────────┘ │ │
│  │        ↓                          │ │
│  └────────┼──────────────────────────┘ │
│           ↓                            │
│    10.13.13.1:4242 (external access)   │
└─────────────────────────────────────────┘
```

## Configuration

### Chef API

**docker-compose.yml:**
```yaml
services:
  chef-api:
    container_name: chef-api
    networks:
      - solcloud
    ports:
      - "${BIND_ADDR:-127.0.0.1}:4242:4242"

networks:
  solcloud:
    name: solcloud
    driver: bridge
```

- **Container name:** `chef-api` (for DNS resolution)
- **Network:** `solcloud` (created if doesn't exist)
- **External access:** Via `${BIND_ADDR}:4242` (default: localhost, tailscale: 10.13.13.1)

### Neo-Dock

**docker-compose.yml:**
```yaml
services:
  neo-dock:
    networks:
      - solcloud

networks:
  solcloud:
    name: solcloud
    external: true  # Expects chef-api to create it
```

**.env:**
```env
CHEF_API_URL=http://chef-api:4242  # Uses Docker DNS, not IP
```

## Why This Approach?

### ❌ Previous Setup (Broken)
```env
CHEF_API_URL=http://10.13.13.1:4242  # Can't reach from isolated container
```

**Problem:** Neo-dock container runs in isolated bridge network and can't reach host's tailscale interface (`10.13.13.1`).

### ✅ Current Setup (Fixed)
```env
CHEF_API_URL=http://chef-api:4242  # Docker DNS resolves to container
```

**Benefits:**
- Docker's internal DNS resolves `chef-api` to container IP
- No network isolation issues
- Fast container-to-container communication
- External access still works via host binding

## Deployment Order

1. **Chef API first** (creates `solcloud` network)
   ```bash
   cd ~/chef-api
   docker-compose up -d
   ```

2. **Neo-Dock second** (joins existing network)
   ```bash
   cd ~/neo-dock
   docker-compose up -d
   ```

## Verification

### Check network exists:
```bash
docker network ls | grep solcloud
```

### Check containers are connected:
```bash
docker network inspect solcloud
```

### Test internal DNS:
```bash
docker exec neo-dock wget -qO- http://chef-api:4242/system/health
```

### Test external access:
```bash
curl http://10.13.13.1:4242/system/health  # From host or tailscale
```

## Troubleshooting

### "network solcloud not found"
**Cause:** Chef API not deployed yet.  
**Fix:** Deploy chef-api first, then neo-dock.

### "connection refused" from neo-dock
**Cause:** Neo-dock still using old IP-based URL.  
**Fix:** Update `.env` to use `http://chef-api:4242` and restart.

### External access not working
**Cause:** `BIND_ADDR` not set correctly.  
**Fix:** Set `BIND_ADDR=10.13.13.1` in chef-api `.env` for tailscale access.

## Migration Notes

When deploying the update:

1. Old containers will be recreated
2. `solcloud` network will be created automatically
3. Neo-dock may fail first deploy if chef-api isn't up yet (just redeploy)
4. **Update neo-dock `.env`** to use `http://chef-api:4242`

## Related Services

Any future SOLCloud service that needs to communicate with chef-api should:

1. Join the `solcloud` network
2. Use `http://chef-api:4242` for API calls
3. Mark the network as `external: true` in their docker-compose.yml
