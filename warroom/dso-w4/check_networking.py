#!/usr/bin/env python3
"""DSO-W4 regression core: read `docker compose config --format json` on stdin and
verify the backend can reach its database by Docker service-name DNS.

Exit 0 = backend and its DB_HOST service share a network (db reachable by DNS).
Exit 1 = they share no network, or DB_HOST is not a Compose service name.
"""
import json
import sys


def nets(service):
    n = service.get("networks")
    if isinstance(n, dict):
        return set(n.keys())
    if isinstance(n, list):
        return set(n)
    return set()


def env(service):
    e = service.get("environment", {})
    if isinstance(e, list):  # ["K=V", ...]
        out = {}
        for item in e:
            k, _, v = item.partition("=")
            out[k] = v
        return out
    return e or {}


def main():
    cfg = json.load(sys.stdin)
    svcs = cfg.get("services", {})
    be = svcs.get("backend", {})
    host = env(be).get("DB_HOST")
    be_nets = nets(be)
    print(f"    backend.DB_HOST = {host!r}")
    print(f"    backend networks = {sorted(be_nets) or ['(default)']}")

    if host not in svcs:
        print(f"    [FAIL] DB_HOST={host!r} is not a Compose service name -- "
              f"backend cannot resolve it by service DNS")
        return 1

    db_nets = nets(svcs[host])
    print(f"    {host} networks = {sorted(db_nets) or ['(default)']}")

    # Both without explicit networks => Compose's implicit shared default network.
    if not be_nets and not db_nets:
        print("    [PASS] both services are on the implicit default network (shared) -- "
              f"{host} is reachable from backend by service DNS")
        return 0

    shared = be_nets & db_nets
    if shared:
        print(f"    [PASS] backend and {host} share network(s) {sorted(shared)} -- "
              f"{host} is reachable from backend by service DNS")
        return 0

    print(f"    [FAIL] backend {sorted(be_nets)} and {host} {sorted(db_nets)} share NO "
          f"network -- Docker DNS cannot resolve {host!r} from backend (DSO-W4)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
