// A local stand-in for Aigora's MCP service. The bridge's stdio ⇄ streamable-http path needs a real MCP server, not
// Aigora's data; the live service's tool contract is checked in the Aigora monorepo against the published package.
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/** Start the fixture on 127.0.0.1 (port 0 picks a free one). Resolves with its /mcp URL and a close(). */
export async function startFixtureServer(port = 0) {
  const http = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    // As the live service does, the client's standalone SSE GET stays pending (no headers) until the client hangs up.
    if (req.method === 'GET') return;
    // Stateless streamable HTTP: one server and transport per request, as the SDK's stateless example does.
    const server = new McpServer({ name: 'aigora-mcp-fixture', version: '0.0.0' });
    server.registerTool('find_agent', { description: 'Fixture agent search', inputSchema: { query: z.string() } },
      async ({ query }) => ({ content: [{ type: 'text', text: `fixture:${query}` }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise((resolve) => http.listen(port, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (http.address());
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve) => http.close(() => resolve(undefined))),
  };
}
