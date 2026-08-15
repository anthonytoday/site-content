# gumroad-mcp-worker

The Gumroad shop exposed to Claude as an MCP server, so the whole catalogue can be
managed from a conversation instead of the dashboard.

## Why a Worker

Claude's sandbox cannot reach `api.gumroad.com` (HTTP 000), while `github.com` returns 200.
The Worker runs on Cloudflare's network, holds the token, and gives Claude tools.

Simpler than `etsy-mcp`: a Gumroad access token is long-lived, so there is **no OAuth flow,
no KV namespace and no cron**. Two secrets and a deploy.

## Deploy without a terminal (recommended)

`worker.bundle.js` is the whole Worker in one file, 723 lines, generated from `src/`.

1. Cloudflare dashboard, **Compute (Workers), Create, Start with Hello World, Deploy**.
2. **Edit code**, select all, paste `worker.bundle.js`, **Deploy**.
3. **Settings, Variables and Secrets, Add**, twice:
   - `GUMROAD_ACCESS_TOKEN`, the token from `00_Resources/credentials.md`
   - `MCP_AUTH_TOKEN`, the value recorded in `00_Resources/credentials.md` section 10
4. Open the Worker URL. Both secrets should read "set".

Edit `src/` when changing anything, then regenerate the bundle. Never hand-edit the bundle.

## Deploy with the terminal (alternative)

```bash
cd "Gumroad HQ/gumroad-mcp-worker"
npm install
npm test                                   # 23 offline tests, no network
npx wrangler secret put GUMROAD_ACCESS_TOKEN   # the token from 00_Resources/credentials.md
npx wrangler secret put MCP_AUTH_TOKEN         # invent a long random string, keep it
npm run deploy
```

Then open `https://gumroad-mcp.<subdomain>.workers.dev/` and confirm both secrets read "set".

## Connect Claude

Add a custom connector pointing at `https://gumroad-mcp.<subdomain>.workers.dev/mcp`,
with the `MCP_AUTH_TOKEN` value as the bearer token.

## Tools

**Read**: get_user, list_products, get_product, list_sales, get_sale, list_offer_codes,
list_subscribers, list_payouts, list_webhooks.

**Write**: create_product, update_product, publish_product, unpublish_product,
delete_product, create_offer_code, refund_sale.

**Bulk**: bulk_update_products, bulk_set_published. Target explicit ids or a filter over the
whole catalogue (`published`, `name_contains`, `tag`, `max_sales`, `free`).

**Escape hatch**: gumroad_request, for any v2 endpoint not wrapped above.

## Safety rules built in

- **Bulk operations dry-run by default.** Pass `dry_run: false` to actually write.
- **delete_product, refund_sale and any write through gumroad_request require `confirm: true`.**
- **Unknown product fields are rejected before any request is sent**, so a typo fails loudly
  rather than silently doing nothing.
- One failure in a bulk run does not stop the rest. Every id gets a row, so a partial run is auditable.
- The `/mcp` endpoint fails closed: no `MCP_AUTH_TOKEN` means no access, never open access.

## Known unknown: product creation

Gumroad's docs say `POST /v2/products` "is currently not implemented and will return a 404".
Gumroad's own CLI implements `products create` against that exact endpoint with 15 flags.
One of the two is stale and only a live call settles it.

`gumroad_create_product` is wired either way. If Gumroad returns 404, the error explains that
creation must happen in the dashboard, and everything else in the tool set still works.

## Endpoint provenance

Paths and write fields were taken from `antiwork/gumroad-cli`:
`internal/api/client.go` for the base URL and Bearer auth, `internal/cmd/products/create.go`
and `update.go` for the accepted fields.
