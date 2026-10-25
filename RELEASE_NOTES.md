# @aigora/mcp 0.1.1 — release candidate notes

Patch release:

- a clean shutdown (the editor closes stdin) no longer prints `[aigora-mcp] http: request failed`. Closing aborts
  the bridge's own server-event stream, and that abort is no longer reported as a failure. Errors while the session
  is open are still reported, with the same fixed messages.

The default MCP URL, tools and configuration are unchanged from 0.1.0. `release/0.1.1.json` qualifies this Node 24
tarball as `release/0.1.0.json` did for 0.1.0.

0.1.1 is the first version published only through `.github/workflows/release.yml`, with npm trusted publishing and
provenance. npm trusted publishing runs only on GitHub-hosted runners. Owner steps:

1. Confirm that GitHub Actions runs for this repository: the organization's billing must allow GitHub-hosted jobs. On
   the release commit, `ci` must pass on ubuntu-24.04, including `npm run verify:release`. That proves the Linux
   tarball equals `release/0.1.1.json`. Do not configure trust before this.
2. Configure the `npm-publish` environment (the owner as required reviewer, `v*` tags only) and the npm trusted
   publisher for `release.yml` with that environment. npm expects a new trusted-publisher configuration to publish
   within two days.
3. Merge the release commit to `main`, then push the tag `v0.1.1` on it.
4. Approve the `npm-publish` deployment. The workflow checks that the packed tarball equals `release/0.1.1.json`
   before it publishes, then reads the registry back against it.

# @aigora/mcp 0.1.0 — release notes

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
