// Knotbind shop MCP server. Tool names and the shop address are fixed consts.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "./mcp.ts";
import { askShop, createOrder, getOrder, listOrders, type Send } from "./shop.ts";

type Hook = { at: string; body: unknown };

export function register(server: McpServer, send: Send): void {
  const toolName = "get_order";
  server.tool(
    toolName,
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async ({ id }) => {
      const order = await getOrder(send, id);
      return {
        content: [{ type: "text", text: `${order.id}: ${order.total_cents}` }],
      };
    }
  );

  server.registerTool(
    "list_orders",
    { description: "List shop orders" },
    async () => {
      const orders = await listOrders(send);
      return {
        content: [
          { type: "text", text: orders.map((order) => order.id).join(",") },
        ],
      };
    }
  );

  server.tool(
    "create_order",
    {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    },
    async ({ sku }) => {
      const order = await createOrder(send, sku);
      return {
        content: [{ type: "text", text: `${order.id}: ${order.total_cents}` }],
      };
    }
  );

  server.tool(
    "ask_shop",
    {
      type: "object",
      properties: {
        id: { type: "string" },
        note: { type: "string" },
      },
      required: ["id"],
    },
    async ({ id, note }) => {
      const order = await getOrder(send, id);
      const answer = await askShop(send, {
        orderId: order.id,
        note: note || `${order.id} total ${order.total_cents}`,
      });
      return { content: [{ type: "text", text: answer }] };
    }
  );
}

/** The required field names of a JSON Schema object, as the SDK advertises them. */
function requiredNames(schema: unknown): string[] {
  const s = schema as { required?: unknown } | null;
  return Array.isArray(s?.required)
    ? s.required.filter((k): k is string => typeof k === "string")
    : [];
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const reply = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export function createShopServer(send: Send = fetch) {
  const mcp = new McpServer();
  register(mcp, send);
  let lastHook: Hook | null = null;
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://shop-mcp");
    if (req.method === "GET" && url.pathname === "/health")
      return reply(res, 200, { ok: true, lastHook });
    if (req.method === "POST" && url.pathname === "/hooks/order") {
      const raw = await readBody(req);
      lastHook = {
        at: new Date().toISOString(),
        body: raw ? JSON.parse(raw) : null,
      };
      return reply(res, 202, { ok: true });
    }
    if (req.method !== "POST" || url.pathname !== "/mcp")
      return reply(res, 404, { error: "not found" });
    const msg = JSON.parse(await readBody(req)) as {
      id?: number | string | null;
      method?: string;
      params?: { name?: string; arguments?: Record<string, string> };
    };
    const id = msg.id ?? null;
    if (msg.method === "initialize") {
      return reply(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "knotbind-shop", version: "1.0.0" },
        },
      });
    }
    if (msg.method === "notifications/initialized") return reply(res, 202, {});
    if (msg.method === "tools/list") {
      return reply(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [...mcp.tools.entries()].map(([name, tool]) => ({
            name,
            inputSchema: tool.schema,
          })),
        },
      });
    }
    if (msg.method === "tools/call") {
      const tool = mcp.tools.get(msg.params?.name ?? "");
      if (!tool) {
        return reply(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "Unknown tool" }],
            isError: true,
          },
        });
      }
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      // The real SDK rejects arguments that fail the schema before the handler
      // runs. Without this, a missing id would reach the API and show up as a
      // 404 instead of an argument error.
      const missing = requiredNames(tool.schema).filter(
        (key) => args[key] === undefined || args[key] === ""
      );
      if (missing.length) {
        return reply(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Input validation error: ${missing.map((k) => `${k}: required`).join(", ")}`,
              },
            ],
            isError: true,
          },
        });
      }
      try {
        const result = await tool.handler(args as Record<string, string>);
        return reply(res, 200, { jsonrpc: "2.0", id, result });
      } catch (error) {
        return reply(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : "failed",
              },
            ],
            isError: true,
          },
        });
      }
    }
    return reply(res, 200, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8081);
  createShopServer().listen(port, "0.0.0.0");
}
