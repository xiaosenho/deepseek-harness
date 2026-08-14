# Agent Note: One carrier-level browser-trust boundary for all `/api` routes

Status: implemented

English | [中文](2026-07-28-api-browser-trust-boundary.zh.md)

## Problem

The web GUI host serves `/api` over plain HTTP and defaults to `127.0.0.1:3080`. Programmatic compositions can bind `0.0.0.0`; the general CLI rejects that bind, while the Electron composition makes a separately protected LAN exception. The surface includes remote-code-execution-grade methods — `session.prompt` drives an agent that runs bash. A browser turns the operator into a confused deputy against such a local API in two classic ways: a malicious page fires a "simple" cross-site POST (`text/plain` — sent without a CORS preflight) whose side effects execute even though the response stays unreadable, and a DNS-rebound origin talks to the socket as if same-origin, making CORS inapplicable entirely, with only the `Host` header betraying the attacker's domain. A carrier-wide rule must cover every consequential method without breaking the in-app directory browser for explicitly authorized remote clients.

## Decision

Enforce browser trust once, at the carrier, for the entire `/api` prefix — two halves:

- **Media-type fence (dsh-host-apiproxy)**: every `/api` POST must declare `application/json`, else 415 before parsing. Cross-site "simple" requests thereby stop existing: any cross-site attempt is forced into a CORS preflight this server never answers.
- **Authority fence (dsh-client-connection, `src/api-request-trust.ts`)**: every request must present a `Host` that is loopback or matches a `trustedHosts` entry (exact on `host:port`, any port on port-less entries, WHATWG-normalized; rebinding defense). At Node HTTP, RPC, and WebSocket entries, a loopback `Host` also requires a TCP peer in `127.0.0.0/8`, equal to `::1`, or in an IPv4-mapped form of `127.0.0.0/8` such as `::ffff:127.0.0.1`; a non-loopback peer that supplies a loopback `Host` is refused even when it carries a valid access token, with HTTP and RPC receiving 403 and a WebSocket upgrade rejected. Deliberately no shortcut for unmarked requests: over plain HTTP a browser attaches neither `Origin` nor Fetch-Metadata to reads (EventSource, images, navigations — those headers go only to trustworthy destinations), so an unmarked request may be a rebound browser read whose response the page can read, and Host is the one header rebinding cannot forge; non-browser clients pass via loopback, the derived LAN IP literals, or a declared authority. An attached `Origin` must equal the Host authority; `sec-fetch-site: cross-site` is refused outright. A `trustedHosts` entry that is not a bare, canonical authority fails the plugin load — WHATWG parsing would otherwise quietly authorize the hostname inside a typo or broaden an exact-port grant. `host.pickDirectory` loses its bespoke guard and rides the same fence.

Reachability remains the webserver binding's policy (`host: 127.0.0.1 | 0.0.0.0`), and general authentication for genuinely remote deployments remains out of scope — the fence is a confused-deputy defense, not an auth layer. The general CLI refuses an all-interface bind. The Electron-owned composition is a narrow exception that adds a process-lifetime bearer credential without replacing this fence. When `remoteAccessToken` is configured, a token-authenticated trusted authority may reach the privileged method set and registered `authority: loopback` RPC; `trustedHosts` without a token never elevates authority. [Electron LAN access uses an ephemeral bearer URL](../feature/2026-08-14-electron-lan-access.md) owns token delivery, while [the Electron token grants Host authority](../feature/2026-08-14-electron-token-host-authority.md) owns the privilege decision. The Node carrier retains the TCP peer check specifically for loopback `Host` values because raw remote clients can choose that header. A Fetch `Request` created after the Node entry passes no longer carries socket metadata; its later authority and privileged-method checks rely on the outer entry having established that a loopback `Host` came from a loopback peer.

Electron's browser bootstrap stores the bearer in a cookie scoped to `Path=/api` and leaves the root page only a token-free, per-origin `sessionStorage` marker. HTTP cookie scope has no port component, however, so the browser may send that bearer to an `/api` service on another port of the same IP literal or hostname. The Host/Origin fence protects the Harness listener but cannot prevent delivery to such a service; the deployment credential trust scope must include every same-host service that can receive the cookie.

## Alternatives considered

- **Per-RPC guards (status quo extended).** Rejected: the guard list trails the method list forever, the highest-value methods were already unguarded, and a loopback rule on browse RPCs would break the remote deployments they exist for.
- **CORS headers + credential omission.** Rejected: we never want cross-origin reads at all, so answering preflights only widens the surface; refusing them is strictly stronger and simpler.
- **A general deployment authentication system in this decision.** Rejected because token minting, storage, rotation, and administration are independent product surface. The Electron LAN decision uses a narrower process-lifetime credential for one owned composition.

## Consequences

- Any future `/api` method is covered by construction; there is no per-route trust decision left to forget.
- Non-loopback deployments must have their serving authorities trusted or requests are refused. The general CLI rejects `--host 0.0.0.0`; programmatic compositions declare `trustedHosts` and any authentication policy themselves. The Electron composition derives its advertised LAN authority and adds its ephemeral bearer credential. Non-browser automation rides the same fence and must also satisfy any composition-specific credential: loopback, a derived LAN IP, or a declared authority passes the authority fence; an undeclared DNS alias is refused.
- Clients must label POST bodies `application/json` (ours always did; raw-fetch tests gained the header).
- A programmatic composition that exposes unauthenticated `0.0.0.0` remains suitable only for a trusted network unless it adds authentication. Electron's bearer credential is sent over plain HTTP and grants complete Harness Host authority, so that scoped exception also remains limited to a trusted LAN whose same-host `/api` services are trusted to receive the cookie.
