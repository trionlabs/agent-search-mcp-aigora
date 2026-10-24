# Aigora MCP

Connect Claude Code, Cursor, Claude Desktop or any stdio MCP client to Aigora’s public Celo agent
registry and bounty tools. The bridge never holds a wallet key; transaction tools return unsigned intents
for the user to review and sign.

## Install

```bash
npx @aigora/mcp@latest init --client=claude-code
npx @aigora/mcp@latest init --client=cursor
npx @aigora/mcp@latest init --client=claude-desktop
```

Each command preserves the client’s existing configuration and adds or updates only the `aigora` server.
Invalid JSON is refused and left byte-for-byte unchanged.

## Run directly

```bash
npx @aigora/mcp@latest run
npx @aigora/mcp@latest run --url https://your-mcp-endpoint.example/mcp
```

The default connects to Aigora’s qualified isolated production Cloud Run MCP endpoint. `--url` overrides
`AIGORA_MCP_URL`. Set `AIGORA_API_KEY` only for an optional Tier‑1 read allowance; public read tools need
no key.

## First check

Restart the client after installation, list MCP tools and call `find_agent` with a short query. Mutation
tools such as `create_bounty_intent` never submit a transaction: always show the returned unsigned intent
to the user and obtain explicit wallet confirmation.

## Manual configuration

```json
{
  "mcpServers": {
    "aigora": {
      "command": "npx",
      "args": ["@aigora/mcp@latest", "run"]
    }
  }
}
```

For Claude Code, use top-level `mcpServers` in `~/.claude.json`, the default
[user configuration](https://code.claude.com/docs/en/mcp#mcp-installation-scopes). The installer preserves
unrelated settings and servers, including project-specific entries, and keeps existing `aigora.env`
values such as an optional key you configured. Malformed server or environment maps are refused.
The obsolete `~/.claude/mcp.json` is left untouched. Quit Claude Code before running `init` (a running Claude Code can
rewrite `~/.claude.json` and drop the new entry), or use `claude mcp add aigora -- npx @aigora/mcp@latest run`.

## Migration and support

- Existing configs are merged; other MCP servers and client settings are retained.
- Re-running `init` upgrades only the Aigora entry to `@latest`.
- Breaking tool-schema changes require a major package version. Additive changes use a minor version.
- Deprecated tools remain available through their announced sunset date; upgrade with the same `init`
  command for your client.
- Package source: `github.com/trionlabs/agent-search-mcp-aigora` (Apache-2.0). Publishing requires the repository
  and npm owners.
