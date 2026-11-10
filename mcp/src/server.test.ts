import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createShopServer } from "./server.ts";
import { GATEWAY, SHOP, askShop, getOrder } from "./shop.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("shop tools", () => {
  it("reads total_cents from the shop order URL", async () => {
    let seen = "";
    const send = (async (url: string) => {
      seen = url;
      return json({ id: "1001", status: "open", sku: "mug", total_cents: 1299 });
    }) as typeof fetch;
    const order = await getOrder(send, "1001");
    assert.equal(seen, `${SHOP.base}${SHOP.order}/1001`);
    assert.equal(order.total_cents, 1299);
  });

  it("sends the cache key and a chat call the Gateway add-ons apply to", async () => {
    process.env.SHOP_GATEWAY_KEY = "kb_live_test";
    let headers: HeadersInit | undefined;
    let body = "";
    const send = (async (_url: string, init?: RequestInit) => {
      headers = init?.headers;
      body = String(init?.body ?? "");
      return json({
        choices: [
          {
            message: {
              content: "Write ada@shop.test or 4111-1111-1111-1111",
            },
          },
        ],
      });
    }) as typeof fetch;
    const answer = await askShop(send, {
      orderId: "1001",
      note: "card 4111-1111-1111-1111",
    });
    const sent = headers as Record<string, string>;
    assert.equal(sent["x-knotbind-cache-key"], GATEWAY.cacheKey);
    assert.equal(sent.authorization, "Bearer kb_live_test");
    assert.match(body, /chat|Order 1001/);
    assert.match(body, /"model":"openai\/gpt-4o-mini"/);
    assert.match(answer, /4111-1111-1111-1111/);
  });

  it("answers initialize, tools/list and get_order over MCP", async () => {
    const send = (async () =>
      json({ id: "1001", status: "open", sku: "mug", total_cents: 1299 })) as typeof fetch;
    const server = createShopServer(send);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const init = await (await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    })).json();
    assert.equal(init.result.serverInfo.name, "knotbind-shop");
    const tools = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    assert.deepEqual(
      tools.result.tools.map((t: { name: string }) => t.name),
      ["get_order", "list_orders", "create_order", "ask_shop"]
    );
    const call = await (await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_order", arguments: { id: "1001" } },
    })).json();
    assert.equal(call.result.content[0].text, "1001: 1299");
    const hook = await fetch(`http://127.0.0.1:${port}/hooks/order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "1001" }),
    });
    assert.equal(hook.status, 202);
    server.close();
  });
});
