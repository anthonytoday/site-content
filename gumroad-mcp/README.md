# gumroad-mcp

The Gumroad shop exposed to Claude and Notion as an MCP server, running on Cloudflare Workers.

19 tools covering products, sales, offer codes, subscribers, payouts and webhooks, with bulk
operations across the whole catalogue. 23 offline tests, no network required to run them.

- `src/` is the source of truth. Edit here.
- `worker.bundle.js` is a generated single-file build for pasting into the Cloudflare dashboard.
- `RUNBOOK.md` covers deployment, the tool list and the safety rules.

## Secrets

Set in the Cloudflare dashboard under Settings, Variables and Secrets. Never in this repo.

- `GUMROAD_ACCESS_TOKEN`
- `MCP_AUTH_TOKEN`

## Deploy

Pushes to `main` build and deploy automatically through Workers Builds.
The Worker name in Cloudflare must match `name = "gumroad-mcp"` in `wrangler.toml`.
