# Knotbind shop

A small shop API and an MCP server. It exists so Knotbind and Mend can be
shown end to end on a real repo: watch it, break it, get a pull request.

## What is in it

- `src/api.ts`: three order endpoints and `/openapi.json`.
- `src/shop.ts`: the calls the tools make. The address is two plain consts.
- `src/server.ts`: the MCP server. Tools register with `registerTool`, and the
  order tools declare an `outputSchema` and answer with `structuredContent`, so
  a renamed response field is something Knotbind can see.
- `src/shop.test.ts`: runs with no network. `npm test`.

## The break

`SHOP_FIELD=amount_cents` renames `total_cents` in the answer and writes
`Replaces total_cents.` in the OpenAPI. That is the stated rename Mend reads.
Without the env var the field is `total_cents` again.

## Gateway add-ons

The `ask_shop` tool posts to `POST /v1/chat/completions` on the Gateway with
`Authorization: Bearer <SHOP_GATEWAY_KEY>` and `x-knotbind-cache-key`:

| Add-on | What it does with that call |
| --- | --- |
| Semantic Cache | reads `x-knotbind-cache-key` |
| Content Guardrails | redacts the reply before it comes back |
| Request Analytics | counts the request |
| Model Failover | uses the key's fallback chain |
| Advanced Rate Limits | applies the key's limits |
| MCP Data Plane | fronts Knotbind's own calls into this server, once enabled |

`SHOP_GATEWAY_KEY` is an access key from the dashboard. It is never committed.
