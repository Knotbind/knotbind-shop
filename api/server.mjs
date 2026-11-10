// The shop API the MCP server calls. One field name is the break switch:
// SHOP_FIELD=amount_cents renames total_cents and says so in the OpenAPI text,
// which is what Knotbind reads as a rename.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const field = process.env.SHOP_FIELD === "amount_cents" ? "amount_cents" : "total_cents";
const port = Number(process.env.PORT || 8080);
const spec = JSON.parse(
  readFileSync(new URL("./openapi.json", import.meta.url), "utf8")
);
if (field === "amount_cents") {
  const props = spec.components.schemas.Order.properties;
  delete props.total_cents;
  props.amount_cents = {
    type: "integer",
    description: "Replaces total_cents.",
  };
  spec.info.version = "2.0.0";
}

const orders = [
  { id: "1001", status: "open", sku: "mug", cents: 1299 },
  { id: "1002", status: "shipped", sku: "poster", cents: 2400 },
];

const asOrder = (row) => ({
  id: row.id,
  status: row.status,
  sku: row.sku,
  [field]: row.cents,
});

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
};

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://shop");
  if (req.method === "GET" && url.pathname === "/openapi.json")
    return send(res, 200, spec);
  if (req.method === "GET" && url.pathname === "/health")
    return send(res, 200, { ok: true, field });
  if (req.method === "GET" && url.pathname === "/v1/orders")
    return send(res, 200, orders.map(asOrder));
  const one = /^\/v1\/orders\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && one) {
    const row = orders.find((o) => o.id === one[1]);
    return row ? send(res, 200, asOrder(row)) : send(res, 404, { error: "missing" });
  }
  if (req.method === "POST" && url.pathname === "/v1/orders") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const row = {
        id: String(1000 + orders.length + 1),
        status: "open",
        sku: String(body.sku || "unknown"),
        cents: 500,
      };
      orders.push(row);
      send(res, 201, asOrder(row));
    });
    return;
  }
  send(res, 404, { error: "not found" });
});

if (process.argv[1] === fileURLToPath(import.meta.url))
  server.listen(port, "0.0.0.0");

export { server };
