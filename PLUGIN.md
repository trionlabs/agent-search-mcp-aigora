# Aigora plugin: source and update policy

The new installation source is [trionlabs/agent-search-mcp-aigora](https://github.com/trionlabs/agent-search-mcp-aigora), with plugin identity aigora@aigora and its payload under plugins/aigora.

Use the [bundled installation guide](plugins/aigora/skills/aigora-mcp/references/install.md) for client commands. The guide is authored in trionlabs/aigora-skills and copied from the [recorded source commit and file hashes](plugins/aigora/skills-source.json); the distributed Skills are not edited here.

The [Codex manifest](plugins/aigora/plugin.json) and [Claude Code manifest](plugins/aigora/.claude-plugin/plugin.json) state this home's plugin version. Each home has its own version line; the legacy plugin and npm bridge may have different versions. The npm bridge remains 0.1.2 in this change.

## Existing users keep their source

If your plugin came from trionlabs/aigora-skills, keep it and update it there. Those installations continue to receive Skill updates. Both marketplaces are named aigora, so do not add the new marketplace alongside an existing one.

A refresh follows your selected source; it does not replace that source. No automatic replacement or sunset is included in this release. A future explicit source-replacement path needs its own verified instructions; there is no one-line migration procedure here.

Your optional Tier-1 settings and client permissions remain yours. The plugin embeds no shared key, runs no npm bridge or install hook, and does not change the MCP endpoint. It is not a sandbox or an enforced read-only channel: some tools can publish to IPFS before a wallet signature. Read the guide before approving a tool.

## Client and release evidence

Claude Code and Codex use the plugin. Claude apps, Desktop and Cowork keep the separate HTTPS custom connector route with No sign in. A loaded Skill, a configured connection, visible tools and a completed read are different observations.

**New home: source candidate, not yet qualified.** Compatibility rows copied from upstream are historical client evidence, not proof of this new home's installation. Announcement requires these three cases in both Claude Code and Codex:

1. Fresh installation from this home.
2. A changed-content update from this same home.
3. Updating an existing legacy-home installation without changing its source.

An unchanged refresh is not a changed-content update. A successful read is not proof that the returned agent suits the request; keep the server's scope and truncation limits visible.

The publisher releases the new-home candidate first, the coordinated legacy guide/version change second, and announces after those six client/case results pass. Pushes, CI, tags and publication use the existing owner's reviewed release flow. Plugin tags use `plugin-v<version>`; npm's `v*` tag workflow is not used.

## Maintainer checks

The snapshot helper reads only Git blobs at the exact qualified upstream commit and verifies the eight independently supplied file hashes. Check mode does not write. A changed upstream SHA must be reviewed and regenerated; no automatic source or client synchronization is promised.

The verifier checks catalogs, the complete plugin payload, same-home version history, guide links and frozen bridge source inputs. The first new-home release creates its own receipt; later releases compare against that home's accepted receipt. Receipts from another home are rejected.

The existing npm release verifier additionally compares the actual packed artifact with the immutable 0.1.2 receipt. The root [bridge README](README.md), npm scripts and release evidence stay unchanged. Source checks and candidate publication do not constitute client qualification.
