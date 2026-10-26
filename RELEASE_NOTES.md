# @aigora/mcp 0.1.2 — release candidate notes

Documentation release on top of 0.1.1 (it includes everything in 0.1.1, which is not published to npm):

- the README and `docs/index.md` give the client lines for Codex, OpenCode, Hermes and OpenClaw, beside Claude Code,
  Cursor and Claude Desktop;
- the packaged skill (`skills/aigora-mcp.md`, exported as `./skill`) now points to the maintained Aigora MCP skill in
  `github.com/trionlabs/aigora-skills`, so there is one source.

The bridge, default MCP URL, tools and configuration are unchanged from 0.1.1. `release/0.1.2.json` qualifies this
Node 24 tarball.

0.1.2 is published from the owner's machine with npm 2FA and without npm provenance, as 0.1.0 was. The release
workflow's publish job needs a GitHub-hosted runner (npm trusted publishing supports no other), and that runner is not
available to this repository yet. Later versions publish only through `.github/workflows/release.yml` with npm trusted
publishing and provenance. Owner steps for 0.1.2:

1. Under **Node 24.21.0** (other Node versions gzip differently), from the release commit on `main`: `npm ci`,
   `npm test`, `npm run typecheck` and `npm run verify:release`.
2. `npm pack`, then check that the tarball's SHA-256 and npm integrity equal `release/0.1.2.json`.
3. `npm publish ./aigora-mcp-0.1.2.tgz --access public` with npm 2FA.
4. Confirm that `npm view @aigora/mcp@0.1.2 dist.integrity` equals `release/0.1.2.json`, then push the tag `v0.1.2`
   on the release commit. For an already published version, `release.yml` only reads the registry back.

# @aigora/mcp 0.1.1 — release candidate notes

Not published to npm: 0.1.2 includes these changes and is published instead.

Patch release:

- a clean shutdown (the editor closes stdin) no longer prints `[aigora-mcp] http: request failed`. Closing aborts
  the bridge's own server-event stream, and that abort is no longer reported as a failure. Errors while the session
  is open are still reported, with the same fixed messages.

The default MCP URL, tools and configuration are unchanged from 0.1.0. `release/0.1.1.json` qualifies this Node 24
tarball as `release/0.1.0.json` did for 0.1.0.

0.1.1 was to be the first version published only through `.github/workflows/release.yml`, with npm trusted
publishing and provenance. CI and the release checks run on Blacksmith runners; the publish job alone runs on a GitHub-hosted
runner, because npm trusted publishing does not support self-hosted runners. Owner steps:

1. On the release commit, `ci` must pass, including `npm run verify:release`; that proves the Linux tarball equals
   `release/0.1.1.json`. The organization's billing must also allow GitHub-hosted jobs, which the publish job needs.
   Do not configure trust before both hold.
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
   provenance, and so is 0.1.2 (see its notes); other later versions publish only through
   `.github/workflows/release.yml` with npm trusted publishing and provenance from this public repository.
5. Confirm that `npm view @aigora/mcp@0.1.0 dist.integrity` equals `release/0.1.0.json`, then tag `v0.1.0`.

The bundle connects only to the exact production MCP URL recorded in `release/0.1.0.json`; a later default-URL change
needs a minor+ release.
