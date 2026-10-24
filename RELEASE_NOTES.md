# @aigora/mcp 0.1.0 — release candidate notes

Initial public bridge release:

- stdio ↔ streamable-http transport;
- safe config merge for Claude Code, Cursor and Claude Desktop;
- public Tier‑0 operation plus optional `AIGORA_API_KEY`;
- packaged Aigora skill file;
- zero runtime npm dependencies through a Node 24 single-file bundle;
- deterministic tarball allowlist, secret scan, clean install and installed-binary roundtrip gate;
- default connection to Aigora's production MCP service.

`release/0.1.0.json` qualifies this Node 24 tarball: its SHA-256, npm integrity, file allowlist and the
default MCP URL the bundle connects to. `npm run verify:release` fails if any of them changes.

Owner release steps for 0.1.0:

1. Confirm npm `@aigora` organization ownership and `0.1.0` availability.
2. Run `npm run verify:release` from the exact release commit; its SHA-256/integrity must equal `release/0.1.0.json`.
3. Keep `github.com/trionlabs/agent-search-mcp-aigora` private until its security review passes, then make it public.
4. Publish 0.1.0 from the owner's machine with npm 2FA, from the verified tarball: under **Node 24.21.0** (other Node
   versions gzip differently), `npm pack`, check that the tarball's SHA-256 and npm integrity equal
   `release/0.1.0.json`, then `npm publish ./aigora-mcp-0.1.0.tgz --access public`. 0.1.0 is published without npm
   provenance; later versions publish only through `.github/workflows/release.yml` with npm trusted publishing and
   provenance from this public repository.
5. Confirm that `npm view @aigora/mcp@0.1.0 dist.integrity` equals `release/0.1.0.json`, then tag `v0.1.0`.

The bundle connects only to the exact production MCP URL recorded in `release/0.1.0.json`; a later default-URL change
needs a minor+ release.
