# @aigora/mcp

Aigora MCP client bridge. Connects any stdio MCP client (Claude Code, Cursor, Claude Desktop, custom) to the public **Aigora MCP server** — the Celo agent registry + bounty toolset (`find_agent`, `get_agent_profile`, `create_bounty_intent`, …) over streamable-http.

## Quickstart

```bash
# Safely merge the Aigora server into each supported client config:
npx @aigora/mcp@latest init --client=claude-code
npx @aigora/mcp@latest init --client=cursor
npx @aigora/mcp@latest init --client=claude-desktop

# Custom client / debugging — run the bridge directly:
npx @aigora/mcp@latest run [--url https://…/mcp]
```

Environment:

| Variable | Meaning |
|---|---|
| `AIGORA_MCP_URL` | Server URL override (defaults to the qualified isolated production endpoint; `--url` wins over both) |
| `AIGORA_API_KEY` | Optional Tier-1 key — raises the read rate ceiling. Tx-intent tools need only a connected wallet, never a key. |

`init` preserves existing servers and atomically adds or updates only the `aigora` entry, keeping any `env` you added to it. Invalid JSON is
never overwritten. Tier 0 needs no key; add `env.AIGORA_API_KEY` to the entry only when using a real Tier-1 key.

For Claude Code, `init` uses top-level `mcpServers` in `~/.claude.json`, the default
[user configuration](https://code.claude.com/docs/en/mcp#mcp-installation-scopes). It retains unrelated
settings, servers and any existing `aigora.env` entries, including an optional key you configured.
Malformed server or environment maps are refused. The obsolete `~/.claude/mcp.json` is left untouched.
Quit Claude Code before running `init`: a running Claude Code can rewrite `~/.claude.json` and drop the new entry.
`claude mcp add` (below) avoids that.

For a project-specific Claude Code entry, use the manual command:

```bash
claude mcp add aigora -- npx @aigora/mcp@latest run
```

## How it works

`run` opens a raw bidirectional pipe between a stdio server transport (your client's side) and a
streamable-http client transport (Aigora's side). The bridge interprets nothing: every JSON-RPC message —
current and future tools alike — passes through unchanged. The npm artifact is a Node 24 single-file
bundle with zero runtime npm dependencies; bundled third-party license texts ship beside it.

The deploy-ready documentation source is [`docs/index.md`](docs/index.md). Release verification refuses
README/docs/client-snippet drift, unexpected tarball files, likely secrets, oversized artifacts, unsafe
config writes or a broken installed-binary roundtrip.

## Versioning & deprecation policy

- **Semver**: a **major** bump = a breaking tool-schema change; **minor** = additive tools/fields only
  (additive-only); **patch** = fixes. The default server URL baked into the bridge only
  changes in a minor+.
- **Deprecation**: a tool slated for removal first serves `Deprecation: true` + `Sunset: <date>` response
  headers and keeps working until the sunset date; the migration note lives in this README's changelog
  section when it happens.
- **Old clients**: the server answers schema-version mismatches with its current schema and the hint to
  upgrade via `npx @aigora/mcp@latest`.

## Release verification

```bash
npm run verify:release
```

This creates the actual tarball in an isolated temporary directory, enforces the package allowlist and
3 MB target, installs it into a clean project, runs `npx aigora-mcp help`, installs all three client
configs, proves invalid JSON is untouched, and drives `initialize` + `tools/list` through the installed
bridge against a local fixture MCP server (`test/fixtures/mcpServer.mjs`). The final JSON contains the publish
candidate’s SHA-256 and npm integrity values and checks that `release/<version>.json` records them and the bundled
default MCP URL. This repository (`github.com/trionlabs/agent-search-mcp-aigora`) is the package's only source; the
live Aigora service's tool contract and the aigora.org web snippets are checked against each published version
separately. Releases are owner steps; see [`RELEASE_NOTES.md`](RELEASE_NOTES.md).
