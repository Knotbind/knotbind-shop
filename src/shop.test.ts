// Tests run with no network and no sockets: the Verifier runs this repo's own
// tests in a container with the network switched off. `send` is a stand-in for
// fetch, and the JSON-RPC layer is called directly.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "./mcp.ts";
import { handleJsonRpc, register } from "./server.ts";
import { ORDERS_PATH, SHOP_API, askShop } from "./shop.ts";

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const ORDER = { id: "1001", status: "open", sku: "mug", total_cents: 1299 };

const serverWith = (send: typeof fetch) => {
  const mcp = new McpServer();
  register(mcp, send);
  return mcp;
};

describe("the shop MCP server", () => {
  it("asks the shop by its fixed address and answers with its fields", async () => {
    const asked: string[] = [];
    const mcp = serverWith((async (url: string) => {
      asked.push(String(url));
      return json(ORDER);
    }) as typeof fetch);
    const answer = await handleJsonRpc(mcp, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_order", arguments: { id: "1001" } },
    });
    const result = (answer.body as { result: Record<string, unknown> }).result;
    assert.deepEqual(asked, [`${SHOP_API}${ORDERS_PATH}/1001`]);
    assert.equal(
      (result.structuredContent as Record<string, unknown>).total_cents,
      1299
    );
    assert.deepEqual(result.content, [{ type: "text", text: "1001: 1299" }]);
  });

  it("advertises an output schema, so a Check can watch a field", async () => {
    const mcp = serverWith((async () => json(ORDER)) as typeof fetch);
    const answer = await handleJsonRpc(mcp, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const tools = (
      answer.body as { result: { tools: { name: string; outputSchema?: unknown }[] } }
    ).result.tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["get_order", "list_orders", "create_order", "ask_shop"]
    );
    const getOrder = tools.find((tool) => tool.name === "get_order");
    assert.ok(getOrder?.outputSchema, "get_order must declare an output schema");
    assert.ok(
      tools.find((tool) => tool.name === "list_orders")?.outputSchema === undefined,
      "a tool without a declared schema advertises none"
    );
  });

  it("refuses a call that leaves out a required argument", async () => {
    const mcp = serverWith((async () => json(ORDER)) as typeof fetch);
    const answer = await handleJsonRpc(mcp, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_order", arguments: {} },
    });
    const result = (answer.body as { result: { isError?: boolean; content: { text: string }[] } }).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /id: required/);
  });

  it("says so when the shop has no order with that id", async () => {
    const mcp = serverWith(
      (async () => new Response("{}", { status: 404 })) as typeof fetch
    );
    const answer = await handleJsonRpc(mcp, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_order", arguments: { id: "9999" } },
    });
    const result = (answer.body as { result: { isError?: boolean; content: { text: string }[] } }).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /Shop 404/);
  });

  it("sends the cache key and the model the Gateway add-ons act on", async () => {
    process.env.SHOP_GATEWAY_KEY = "kb_live_test";
    const mcp = new McpServer();
    let headers: Record<string, string> = {};
    let body = "";
    const send = (async (_url: string, init?: RequestInit) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      body = String(init?.body ?? "");
      return json({ choices: [{ message: { content: "1001" } }] });
    }) as typeof fetch;
    const answer = await askShop(send, {
      orderId: "1001",
      note: "ada@example.com card 4242424242424242",
    });
    assert.equal(answer, "1001");
    assert.equal(headers.authorization, "Bearer kb_live_test");
    assert.equal(headers["x-knotbind-cache-key"], "shop-orders");
    assert.match(body, /"model":/);
    assert.match(body, /ada@example\.com/);
    register(mcp, send);
    assert.equal(mcp.tools.size, 4);
  });
});
