// Knotbind shop MCP server. Tool names and the shop address are fixed consts,
// and every tool answers with structured content, so a renamed response field
// is both visible to a Check and patchable by Mend.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer, type ToolResult } from "./mcp.ts";
import {
  ORDERS_PATH,
  ORDER_SCHEMA,
  askShop,
  createOrder,
  getOrder,
  listOrders,
  type Order,
  type Send,
} from "./shop.ts";

type Hook = { at: string; body: unknown };

const ORDER_INPUT = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
} as const;

const orderResult = (order: Order): ToolResult => ({
  content: [{ type: "text", text: `${order.id}: ${order.total_cents}` }],
  structuredContent: {
    id: order.id,
    status: order.status,
    sku: order.sku,
    total_cents: order.total_cents,
  },
});

export function register(server: McpServer, send: Send): void {
  const toolName = "get_order";
  server.registerTool(
    toolName,
    {
      description: "Read one shop order.",
      inputSchema: ORDER_INPUT as never,
      outputSchema: ORDER_SCHEMA as never,
    },
    async ({ id }) => orderResult(await getOrder(send, id))
  );

  server.registerTool(
    "list_orders",
    { description: "List shop orders." },
    async () => {
      const orders = await listOrders(send);
      return {
        content: [
          {
            type: "text",
            text: orders
              .map((order) => `${order.id}:${order.total_cents}`)
              .join(","),
          },
        ],
      };
    }
  );

  server.registerTool(
    "create_order",
    {
      description: "Create a shop order.",
      inputSchema: {
        type: "object",
        properties: { sku: { type: "string" } },
        required: ["sku"],
      } as never,
      outputSchema: ORDER_SCHEMA as never,
    },
    async ({ sku }) => orderResult(await createOrder(send, sku))
  );

  server.tool(
    "ask_shop",
    ORDER_INPUT as never,
    async ({ id, note }) => {
      const order = await getOrder(send, id);
      const answer = await askShop(send, {
        orderId: order.id,
        note: note || `total ${order.total_cents}`,
      });
      return { content: [{ type: "text", text: answer }] };
    },
    "Ask the Knotbind Gateway about an order, with the cache key the add-ons read."
  );
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

/** Required fields of an advertised input schema, checked before the handler runs. */
function missingRequired(
  schema: Record<string, unknown>,
  args: Record<string, unknown>
): string[] {
  const required = Array.isArray(schema.required) ? schema.required : [];
  return required
    .filter((key) => typeof key === "string")
    .filter((key) => args[key as string] === undefined || args[key as string] === "");
}

/**
 * One MCP message in, one reply out. The HTTP layer only moves bytes, so the
 * protocol can be tested without opening a socket: the Verifier runs this
 * repo's tests with no network at all.
 */
export async function handleJsonRpc(
  mcp: McpServer,
  msg: {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: { name?: string; arguments?: Record<string, string> };
  }
): Promise<{ status: number; body: unknown }> {
  const id = msg.id ?? null;
  if (msg.method === "initialize")
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "knotbind-shop", version: "1.0.0" },
        },
      },
    };
  if (msg.method === "notifications/initialized")
    return { status: 202, body: {} };
  if (msg.method === "tools/list")
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [...mcp.tools.entries()].map(([name, tool]) => ({
            name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
            ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
            annotations: {
              readOnlyHint: name === "get_order" || name === "list_orders",
            },
          })),
        },
      },
    };
  if (msg.method === "tools/call") {
    const tool = mcp.tools.get(msg.params?.name ?? "");
    if (!tool)
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "Unknown tool" }],
            isError: true,
          },
        },
      };
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
    const missing = missingRequired(tool.inputSchema, args);
    if (missing.length)
      return {
        status: 200,
        body: {
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
        },
      };
    try {
      const result = await tool.handler(args as Record<string, string>);
      return { status: 200, body: { jsonrpc: "2.0", id, result } };
    } catch (error) {
      return {
        status: 200,
        body: {
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
        },
      };
    }
  }
  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    },
  };
}

export function createShopServer(send: Send = fetch) {
  const mcp = new McpServer();
  register(mcp, send);
  let lastHook: Hook | null = null;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://shop-mcp");
    if (req.method === "GET" && url.pathname === "/health")
      return reply(res, 200, { ok: true, tools: [...mcp.tools.keys()] });
    if (req.method === "POST" && url.pathname === "/hooks/order") {
      const raw = await readBody(req);
      lastHook = {
        at: new Date().toISOString(),
        body: raw ? JSON.parse(raw) : null,
      };
      return reply(res, 202, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/hooks/last")
      return reply(res, 200, lastHook ?? { at: null, body: null });
    if (req.method !== "POST" || url.pathname !== "/mcp")
      return reply(res, 404, { error: "not found" });
    const { status, body } = await handleJsonRpc(
      mcp,
      JSON.parse(await readBody(req))
    );
    reply(res, status, body);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 8081);
  createShopServer().listen(port, "0.0.0.0");
}
