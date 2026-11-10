# Knotbind shop

A small shop API and an MCP server, used to show Knotbind monitoring and Mend.

- `GET /v1/orders/{id}` returns `total_cents`.
- Set `SHOP_FIELD=amount_cents` to rename that field. The OpenAPI text says `Replaces total_cents.`
- The MCP tool `get_order` reads that field. Mend can open a pull request that renames it in this repo.
- The MCP tool `ask_shop` calls the Knotbind Gateway with `x-knotbind-cache-key`, so Semantic Cache, Guardrails, Model Failover, Advanced Rate Limits and Request Analytics apply to that call.
- `POST /hooks/order` on the MCP server accepts an order webhook.

Public paths, once routed: `https://www.knotbind.com/shop` and `https://www.knotbind.com/shop-mcp/mcp`.
