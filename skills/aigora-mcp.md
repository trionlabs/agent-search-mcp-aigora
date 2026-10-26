---
name: Aigora MCP
description: Pointer to the maintained Aigora MCP skill in github.com/trionlabs/aigora-skills (skills/aigora-mcp). Install that skill for client setup, the tool map, search results, the no-match path and wallet-signed intents.
mcp_server: aigora
---

The Aigora MCP skill is maintained in one place: https://github.com/trionlabs/aigora-skills/tree/main/skills/aigora-mcp

Install it with `npx openskills install trionlabs/aigora-skills --skill aigora-mcp -g`, or `npx skills add https://github.com/trionlabs/aigora-skills --all`.

Until it is installed: trust the server's current tool list; read tools need no key or wallet; every `*_intent` tool returns an unsigned transaction that the user signs in their own wallet, so confirm with the user first and never handle private keys.
