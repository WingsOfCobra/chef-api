# Docker Network Integration

## Overview

Chef API uses a shared Docker network (`chef-network`) to enable communication with other services.

## Network Architecture

```
┌─────────────────────────────────────────┐
│         Host (your-vpn-ip)             │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   chef-network (bridge)           │ │
│  │                                   │ │
│  │  ┌──────────────┐  ┌───────────┐ │ │
│  │  │  chef-api    │  │ other-app │ │ │
│  │  │  :4242       │←─┤ :3000     │ │ │
│  │  └──────────────┘  └───────────┘ │ │
│  │        ↓                          │ │
│  └────────┼──────────────────────────┘ │
│           ↓                            │
│    your-vpn-ip:4242 (external access)  │
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
      - chef-network
    ports:
      - "${BIND_ADDR:-127.0.0.1}:4242:4242"

networks:
  chef-network:
    name: chef-network
    driver: bridge
```

- **Container name:** `chef-api` (for DNS resolution)
- **Network:** `chef-network` (created if doesn't exist)
- **External access:** Via `${BIND_ADDR}:4242` (default: localhost, VPN: your-vpn-ip)

### Other Services

**docker-compose.yml:**
```yaml
services:
  other-app:
    networks:
      - chef-network

networks:
  chef-network:
    name: chef-network
    external: true  # Expects chef-api to create it
```

**.env:**
```env
CHEF_API_URL=http://chef-api:4242  # Uses Docker DNS, not IP
```

## Why This Approach?

### ❌ Previous Setup (Broken)
```env
CHEF_API_URL=http://your-vpn-ip:4242  # Can't reach from isolated container
```

**Problem:** Containers run in isolated bridge network and can't reach host's VPN interface.

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

1. **Chef API first** (creates `chef-network`)
   ```bash
   cd ~/chef-api
   docker-compose up -d
   ```

2. **Other services second** (join existing network)
   ```bash
   cd ~/other-service
   docker-compose up -d
   ```

## Verification

### Check network exists:
```bash
docker network ls | grep chef-network
```

### Check containers are connected:
```bash
docker network inspect chef-network
```

### Test internal DNS:
```bash
docker exec other-app wget -qO- http://chef-api:4242/system/health
```

### Test external access:
```bash
curl http://your-vpn-ip:4242/system/health  # From host or VPN
```

## Troubleshooting

### "network chef-network not found"
**Cause:** Chef API not deployed yet.  
**Fix:** Deploy chef-api first, then other services.

### "connection refused" from other containers
**Cause:** Service still using old IP-based URL.  
**Fix:** Update `.env` to use `http://chef-api:4242` and restart.

### External access not working
**Cause:** `BIND_ADDR` not set correctly.  
**Fix:** Set `BIND_ADDR=your-vpn-ip` in chef-api `.env` for VPN access.

## Migration Notes

When deploying the update:

1. Old containers will be recreated
2. `chef-network` will be created automatically
3. Other services may fail first deploy if chef-api isn't up yet (just redeploy)
4. **Update service `.env` files** to use `http://chef-api:4242`

## Related Services

Any service that needs to communicate with chef-api should:

1. Join the `chef-network` network
2. Use `http://chef-api:4242` for API calls
3. Mark the network as `external: true` in their docker-compose.yml
