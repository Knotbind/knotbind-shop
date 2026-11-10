// Shop calls. The address is a fixed const so Mend can follow it.
export type Send = typeof fetch;

export const SHOP = {
  base: "https://www.knotbind.com/shop",
  order: "/v1/orders",
};

export const GATEWAY = {
  url: "https://www.knotbind.com/v1/chat/completions",
  cacheKey: "shop-orders",
  model: "openai/gpt-4o-mini",
};

export type Order = {
  id: string;
  status: "open" | "shipped";
  sku: string;
  total_cents: number;
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Shop ${response.status}`);
  return (await response.json()) as T;
}

export async function getOrder(send: Send, id: string): Promise<Order> {
  const response = await send(`${SHOP.base}${SHOP.order}/${id}`);
  return readJson<Order>(response);
}

export async function listOrders(send: Send): Promise<Order[]> {
  const response = await send(`${SHOP.base}${SHOP.order}`);
  return readJson<Order[]>(response);
}

export async function createOrder(send: Send, sku: string): Promise<Order> {
  const response = await send(`${SHOP.base}${SHOP.order}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku }),
  });
  return readJson<Order>(response);
}

/**
 * One Gateway call the add-ons apply to.
 * Semantic Cache reads x-knotbind-cache-key.
 * Guardrails redact email, phone, card and SSN in the JSON reply.
 * Failover, rate limits and analytics apply because this is a normal
 * /v1/chat/completions call on the workspace access key.
 * The MCP Data Plane applies when Knotbind calls this server, not here.
 */
export async function askShop(
  send: Send,
  input: { orderId: string; note: string }
): Promise<string> {
  const key = process.env.SHOP_GATEWAY_KEY;
  if (!key) throw new Error("SHOP_GATEWAY_KEY is not set");
  const response = await send(GATEWAY.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-knotbind-cache-key": GATEWAY.cacheKey,
    },
    body: JSON.stringify({
      model: process.env.SHOP_GATEWAY_MODEL || GATEWAY.model,
      messages: [
        {
          role: "user",
          content: `Order ${input.orderId}. ${input.note}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Gateway ${response.status}`);
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? "";
}
