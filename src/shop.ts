// Shop calls. The address is two plain consts, because that is the shape Mend
// reads: a name kept in a function or read from the environment at call time
// cannot be tied to one operation, so no automatic fix can be written for it.
export type Send = typeof fetch;

export const SHOP_API = "https://www.knotbind.com/shop";
export const ORDERS_PATH = "/v1/orders";

export const GATEWAY_CHAT = "https://www.knotbind.com/v1/chat/completions";
export const GATEWAY_CACHE_KEY = "shop-orders";

export type Order = {
  id: string;
  status: string;
  sku: string;
  total_cents: number;
};

/** The tool's structured answer, so Knotbind sees `total_cents` as a field. */
export const ORDER_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string" },
    sku: { type: "string" },
    total_cents: { type: "number" },
  },
  required: ["id", "status", "sku", "total_cents"],
} as const;

/**
 * Each call reads its answer inside the function that makes it, and names the
 * type it expects. A shared `readJson<T>(response)` helper hides that, and
 * then nothing can be tied to the operation: Mend finds the call, but no use
 * of a field, so it cannot rename one.
 */
export async function getOrder(send: Send, id: string): Promise<Order> {
  const response = await send(`${SHOP_API}${ORDERS_PATH}/${id}`);
  if (!response.ok) throw new Error(`Shop ${response.status}`);
  return (await response.json()) as Order;
}

export async function listOrders(send: Send): Promise<Order[]> {
  const response = await send(`${SHOP_API}${ORDERS_PATH}`);
  if (!response.ok) throw new Error(`Shop ${response.status}`);
  return (await response.json()) as Order[];
}

export async function createOrder(send: Send, sku: string): Promise<Order> {
  const response = await send(`${SHOP_API}${ORDERS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku }),
  });
  if (!response.ok) throw new Error(`Shop ${response.status}`);
  return (await response.json()) as Order;
}

/**
 * A Gateway chat call the add-ons act on: Semantic Cache reads
 * x-knotbind-cache-key, Guardrails redact the reply, Request Analytics counts
 * it, and Failover and Advanced Rate Limits apply to the access key it uses.
 * The key comes from the environment, so no secret sits in the repo.
 */
export async function askShop(
  send: Send,
  input: { orderId: string; note: string }
): Promise<string> {
  const key = process.env.SHOP_GATEWAY_KEY;
  if (!key) throw new Error("SHOP_GATEWAY_KEY is not set");
  const response = await send(GATEWAY_CHAT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-knotbind-cache-key": GATEWAY_CACHE_KEY,
    },
    body: JSON.stringify({
      model: process.env.SHOP_GATEWAY_MODEL || "openai/gpt-4o-mini",
      messages: [
        { role: "user", content: `Order ${input.orderId}. ${input.note}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Gateway ${response.status}`);
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? "";
}
