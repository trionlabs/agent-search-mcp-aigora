# Security policy

Please report a vulnerability privately through this repository's **Security → Report a vulnerability** form
(GitHub private vulnerability reporting). Do not open a public issue for it.

Supported version: the latest published `@aigora/mcp`.

`AIGORA_API_KEY` is read from the environment and sent only as a Bearer header to the configured MCP URL, which must
be `https://` unless it is localhost. When a request fails in transport (network, HTTP status, startup), the bridge's own diagnostics and error replies carry
a fixed message and, when known, the HTTP status, never the upstream or transport error text. Error responses that the
MCP server itself returns in JSON-RPC pass through the bridge unchanged. `init` rewrites
your client config file owner-only (`0600` on macOS and Linux; on Windows the new file's inherited ACL entries are
removed with `icacls` before anything is written, and `init` fails if that does not succeed). It never adds a key, but
keeps an `aigora.env` (including a key) that you configured yourself. A URL with a username or password is refused.
