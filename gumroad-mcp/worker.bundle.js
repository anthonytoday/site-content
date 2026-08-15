/**
 * gumroad-mcp single file build. Generated from src/. Edit the modules, not this file.
 */

/* ==== src/gumroad.js ==== */
/**
 * Gumroad REST API v2 client.
 *
 * Base URL and auth are taken from Gumroad's own CLI (antiwork/gumroad-cli,
 * internal/api/client.go): https://api.gumroad.com/v2 with a Bearer token.
 * The CLI sends writes as application/x-www-form-urlencoded, so this does too.
 *
 * The token is a long-lived account-wide access token held as a Worker secret.
 * It does not expire, which is why there is no OAuth flow and no KV here.
 */

const BASE = 'https://api.gumroad.com/v2';

class GumroadError extends Error {
  constructor(message, status, body, hint) {
    super(message);
    this.name = 'GumroadError';
    this.status = status;
    this.body = body;
    if (hint) this.hint = hint;
  }
}

function encodeForm(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      // Gumroad takes repeated keys with [] for arrays, matching the CLI's --tag flag.
      for (const item of v) usp.append(`${k}[]`, String(item));
    } else if (typeof v === 'boolean') {
      usp.append(k, v ? 'true' : 'false');
    } else {
      usp.append(k, String(v));
    }
  }
  return usp;
}

/**
 * One request against the Gumroad API.
 * Gumroad can return HTTP 200 with {"success": false}, so the body is checked
 * as well as the status. That behaviour is called out in Gumroad's own docs.
 */
async function call(env, method, path, params = {}) {
  const token = env.GUMROAD_ACCESS_TOKEN;
  if (!token) {
    throw new GumroadError(
      'GUMROAD_ACCESS_TOKEN is not set on this Worker.',
      500,
      null,
      'Run: npx wrangler secret put GUMROAD_ACCESS_TOKEN'
    );
  }

  const upper = method.toUpperCase();
  let url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const init = {
    method: upper,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  };

  if (upper === 'GET' || upper === 'DELETE') {
    const qs = encodeForm(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = encodeForm(params).toString();
  }

  const res = await fetch(url, init);
  const text = await res.text();

  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new GumroadError(
      `Gumroad returned non-JSON (HTTP ${res.status}).`,
      res.status,
      text.slice(0, 400)
    );
  }

  if (!res.ok || body.success === false) {
    const msg = body.message || body.error || `Gumroad request failed (HTTP ${res.status}).`;
    let hint;
    if (res.status === 401) hint = 'The access token was rejected. Regenerate it at Gumroad, Settings, Advanced, Applications.';
    if (res.status === 404 && upper === 'POST' && path === '/products') {
      hint = 'Gumroad has not enabled product creation over the API for this account. Create the product in the dashboard, then use gumroad_update_product to configure it.';
    }
    if (res.status === 429) hint = 'Rate limited. Retry with backoff.';
    throw new GumroadError(msg, res.status, body, hint);
  }

  return body;
}

const get = (env, path, params) => call(env, 'GET', path, params);
const post = (env, path, params) => call(env, 'POST', path, params);
const put = (env, path, params) => call(env, 'PUT', path, params);
const del = (env, path, params) => call(env, 'DELETE', path, params);

/** Walks every page of /sales. Gumroad paginates with page_key. */
async function allSales(env, filters = {}, maxPages = 40) {
  const out = [];
  let pageKey = null;
  for (let i = 0; i < maxPages; i++) {
    const params = { ...filters };
    if (pageKey) params.page_key = pageKey;
    const body = await get(env, '/sales', params);
    out.push(...(body.sales || []));
    pageKey = body.next_page_key;
    if (!pageKey) break;
  }
  return out;
}

/* ==== src/tools.js ==== */
/**
 * MCP tool surface for the Gumroad shop.
 *
 * Endpoint paths and write parameters mirror Gumroad's own CLI
 * (antiwork/gumroad-cli, internal/cmd/*). Anything not wrapped here is still
 * reachable through gumroad_request, so the Worker never becomes the ceiling.
 */


/* Parameters Gumroad accepts on product writes, taken from the CLI's create.go
   and update.go. Unknown keys are dropped rather than sent, so a typo fails
   loudly here instead of silently doing nothing at Gumroad. */
const PRODUCT_WRITE_FIELDS = new Set([
  'name', 'price', 'price_currency_type', 'description', 'custom_permalink',
  'custom_summary', 'custom_receipt', 'customizable_price', 'suggested_price_cents',
  'max_purchase_count', 'category', 'taxonomy_id', 'native_type',
  'subscription_duration', 'custom_html',
]);

function pickProductFields(patch, where) {
  const out = {};
  const unknown = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (PRODUCT_WRITE_FIELDS.has(k)) out[k] = v;
    else unknown.push(k);
  }
  if (unknown.length) {
    throw new GumroadError(
      `Unsupported field(s) in ${where}: ${unknown.join(', ')}`,
      400, null,
      `Gumroad accepts: ${[...PRODUCT_WRITE_FIELDS].join(', ')}`
    );
  }
  return out;
}

/** Runs an async op over many ids without hammering the API, and never throws
    on a single failure: every id gets a row so a bulk run is auditable. */
async function overIds(ids, fn, concurrency = 4) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      const id = ids[i];
      try {
        const value = await fn(id);
        results[i] = { id, ok: true, ...(value || {}) };
      } catch (err) {
        results[i] = { id, ok: false, error: err.message, status: err.status };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return {
    total: ids.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** Resolves a target set: explicit ids, or every product matching a filter. */
async function resolveTargets(env, args) {
  if (Array.isArray(args.product_ids) && args.product_ids.length) return args.product_ids;
  const body = await get(env, '/products');
  let products = body.products || [];
  const f = args.filter || {};
  if (f.published !== undefined) products = products.filter((p) => Boolean(p.published) === Boolean(f.published));
  if (f.name_contains) {
    const needle = String(f.name_contains).toLowerCase();
    products = products.filter((p) => (p.name || '').toLowerCase().includes(needle));
  }
  if (f.tag) products = products.filter((p) => (p.tags || []).includes(f.tag));
  if (f.max_sales !== undefined) products = products.filter((p) => (p.sales_count || 0) <= f.max_sales);
  if (f.free === true) products = products.filter((p) => !p.price);
  if (f.free === false) products = products.filter((p) => p.price > 0);
  return products.map((p) => p.id);
}

const TOOLS = [
  /* ---------- account ---------- */
  {
    name: 'gumroad_get_user',
    description: 'The authenticated Gumroad account. Use this first to confirm the Worker is wired to the right shop.',
    inputSchema: { type: 'object', properties: {} },
    handler: (env) => get(env, '/user'),
  },

  /* ---------- products, read ---------- */
  {
    name: 'gumroad_list_products',
    description: 'Every product in the shop, with price, published state, sales_count, sales_usd_cents, tags and URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'boolean', description: 'Return a compact row per product instead of the full record. Default true.' },
      },
    },
    handler: async (env, args) => {
      const body = await get(env, '/products');
      const products = body.products || [];
      if (args.summary === false) return body;
      return {
        count: products.length,
        products: products.map((p) => ({
          id: p.id, name: p.name, price: p.price, currency: p.currency,
          published: p.published, sales_count: p.sales_count,
          sales_usd_cents: p.sales_usd_cents, tags: p.tags,
          url: p.short_url, permalink: p.custom_permalink,
        })),
      };
    },
  },
  {
    name: 'gumroad_get_product',
    description: 'One product in full, by id or permalink.',
    inputSchema: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
    },
    handler: (env, a) => get(env, `/products/${encodeURIComponent(a.product_id)}`),
  },

  /* ---------- products, write ---------- */
  {
    name: 'gumroad_create_product',
    description:
      'Create a product. Gumroad may reject this with 404 if creation over the API is not enabled for the account, in which case the error says so and you create it in the dashboard instead.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'integer', description: 'In cents. 0 for free or pay-what-you-want.' },
        price_currency_type: { type: 'string', description: 'ISO code, for example usd or chf.' },
        description: { type: 'string' },
        native_type: { type: 'string', description: 'ebook, course, membership, digital, and so on.' },
        custom_permalink: { type: 'string' },
        custom_summary: { type: 'string' },
        customizable_price: { type: 'boolean', description: 'Pay what you want.' },
        suggested_price_cents: { type: 'integer' },
        taxonomy_id: { type: 'integer' },
        category: { type: 'string' },
        max_purchase_count: { type: 'integer' },
        subscription_duration: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (env, a) => post(env, '/products', pickProductFields(a, 'gumroad_create_product')),
  },
  {
    name: 'gumroad_update_product',
    description: 'Update one product. Only the fields you pass are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        patch: { type: 'object', description: 'Any of the create fields, plus custom_html.' },
      },
      required: ['product_id', 'patch'],
    },
    handler: async (env, a) =>
      put(env, `/products/${encodeURIComponent(a.product_id)}`, pickProductFields(a.patch, 'patch')),
  },
  {
    name: 'gumroad_publish_product',
    description: 'Publish (enable) a product so it is for sale.',
    inputSchema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
    handler: (env, a) => put(env, `/products/${encodeURIComponent(a.product_id)}/enable`),
  },
  {
    name: 'gumroad_unpublish_product',
    description: 'Unpublish (disable) a product. It stays in the account.',
    inputSchema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
    handler: (env, a) => put(env, `/products/${encodeURIComponent(a.product_id)}/disable`),
  },
  {
    name: 'gumroad_delete_product',
    description: 'Permanently delete a product. Requires confirm true, because this cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: { product_id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['product_id', 'confirm'],
    },
    handler: async (env, a) => {
      if (a.confirm !== true) throw new GumroadError('Deletion needs confirm: true.', 400);
      return del(env, `/products/${encodeURIComponent(a.product_id)}`);
    },
  },

  /* ---------- bulk ---------- */
  {
    name: 'gumroad_bulk_update_products',
    description:
      'Apply the same patch to many products at once. Target either explicit product_ids or a filter over the whole catalogue. Returns one row per product so partial failures are visible.',
    inputSchema: {
      type: 'object',
      properties: {
        product_ids: { type: 'array', items: { type: 'string' } },
        filter: {
          type: 'object',
          description: 'published, name_contains, tag, max_sales, free',
          properties: {
            published: { type: 'boolean' }, name_contains: { type: 'string' },
            tag: { type: 'string' }, max_sales: { type: 'integer' }, free: { type: 'boolean' },
          },
        },
        patch: { type: 'object' },
        dry_run: { type: 'boolean', description: 'List what would change without calling Gumroad. Default true.' },
      },
      required: ['patch'],
    },
    handler: async (env, a) => {
      const fields = pickProductFields(a.patch, 'patch');
      const ids = await resolveTargets(env, a);
      if (a.dry_run !== false) {
        return { dry_run: true, would_update: ids.length, product_ids: ids, patch: fields };
      }
      return overIds(ids, (id) => put(env, `/products/${encodeURIComponent(id)}`, fields));
    },
  },
  {
    name: 'gumroad_bulk_set_published',
    description: 'Publish or unpublish many products at once, by ids or by filter.',
    inputSchema: {
      type: 'object',
      properties: {
        product_ids: { type: 'array', items: { type: 'string' } },
        filter: { type: 'object' },
        published: { type: 'boolean' },
        dry_run: { type: 'boolean' },
      },
      required: ['published'],
    },
    handler: async (env, a) => {
      const ids = await resolveTargets(env, a);
      const action = a.published ? 'enable' : 'disable';
      if (a.dry_run !== false) return { dry_run: true, would_change: ids.length, product_ids: ids, action };
      return overIds(ids, (id) => put(env, `/products/${encodeURIComponent(id)}/${action}`));
    },
  },

  /* ---------- sales ---------- */
  {
    name: 'gumroad_list_sales',
    description: 'Sales, following pagination automatically. Filter by after, before, email, product_id, order_id.',
    inputSchema: {
      type: 'object',
      properties: {
        after: { type: 'string', description: 'YYYY-MM-DD' },
        before: { type: 'string', description: 'YYYY-MM-DD' },
        email: { type: 'string' }, product_id: { type: 'string' }, order_id: { type: 'string' },
        summary_only: { type: 'boolean', description: 'Return totals and per-product revenue instead of every row.' },
      },
    },
    handler: async (env, a) => {
      const { summary_only, ...filters } = a;
      const sales = await allSales(env, filters);
      if (!summary_only) return { count: sales.length, sales };
      const paid = sales.filter((s) => s.paid && !s.chargedback);
      const byProduct = {};
      for (const s of paid) {
        const k = s.product_name || 'unknown';
        byProduct[k] = (byProduct[k] || 0) + (s.price || 0);
      }
      return {
        records: sales.length,
        paid: paid.length,
        gross_cents: paid.reduce((t, s) => t + (s.price || 0), 0),
        fees_cents: paid.reduce((t, s) => t + (s.gumroad_fee || 0), 0),
        refunded: sales.filter((s) => s.partially_refunded).length,
        disputed: sales.filter((s) => s.disputed).length,
        revenue_by_product_cents: Object.fromEntries(
          Object.entries(byProduct).sort((x, y) => y[1] - x[1])
        ),
      };
    },
  },
  {
    name: 'gumroad_get_sale',
    description: 'One sale in full by id, including buyer email, fees, country, referrer and refund state.',
    inputSchema: { type: 'object', properties: { sale_id: { type: 'string' } }, required: ['sale_id'] },
    handler: (env, a) => get(env, `/sales/${encodeURIComponent(a.sale_id)}`),
  },
  {
    name: 'gumroad_refund_sale',
    description: 'Refund a sale in full or in part. Requires confirm true, because this moves money.',
    inputSchema: {
      type: 'object',
      properties: {
        sale_id: { type: 'string' },
        amount_cents: { type: 'integer', description: 'Omit for a full refund.' },
        confirm: { type: 'boolean' },
      },
      required: ['sale_id', 'confirm'],
    },
    handler: async (env, a) => {
      if (a.confirm !== true) throw new GumroadError('Refunds need confirm: true.', 400);
      const params = {};
      if (a.amount_cents !== undefined) params.amount_cents = a.amount_cents;
      return put(env, `/sales/${encodeURIComponent(a.sale_id)}/refund`, params);
    },
  },

  /* ---------- offer codes, subscribers, payouts, webhooks ---------- */
  {
    name: 'gumroad_list_offer_codes',
    description: 'Discount codes on a product.',
    inputSchema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
    handler: (env, a) => get(env, `/products/${encodeURIComponent(a.product_id)}/offer_codes`),
  },
  {
    name: 'gumroad_create_offer_code',
    description: 'Create a discount code on a product. amount_off is cents, or a percentage when offer_type is percent.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' }, name: { type: 'string' },
        amount_off: { type: 'integer' }, offer_type: { type: 'string', enum: ['cents', 'percent'] },
        max_purchase_count: { type: 'integer' }, universal: { type: 'boolean' },
      },
      required: ['product_id', 'name', 'amount_off'],
    },
    handler: (env, a) => {
      const { product_id, ...rest } = a;
      return post(env, `/products/${encodeURIComponent(product_id)}/offer_codes`, rest);
    },
  },
  {
    name: 'gumroad_list_subscribers',
    description: 'Subscribers for a membership product.',
    inputSchema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
    handler: (env, a) => get(env, `/products/${encodeURIComponent(a.product_id)}/subscribers`),
  },
  {
    name: 'gumroad_list_payouts',
    description: 'Payout history, or the upcoming payout when upcoming is true.',
    inputSchema: { type: 'object', properties: { upcoming: { type: 'boolean' } } },
    handler: (env, a) => get(env, a.upcoming ? '/payouts/upcoming' : '/payouts'),
  },
  {
    name: 'gumroad_list_webhooks',
    description: 'Resource subscriptions, which is what Gumroad calls webhooks.',
    inputSchema: { type: 'object', properties: { resource_name: { type: 'string' } } },
    handler: (env, a) => get(env, '/resource_subscriptions', a.resource_name ? { resource_name: a.resource_name } : {}),
  },

  /* ---------- escape hatch ---------- */
  {
    name: 'gumroad_request',
    description:
      'Any Gumroad v2 endpoint not wrapped above. Give method, path and params. Writes require confirm true.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path: { type: 'string', description: 'For example /products or /sales/123' },
        params: { type: 'object' },
        confirm: { type: 'boolean' },
      },
      required: ['method', 'path'],
    },
    handler: async (env, a) => {
      const m = a.method.toUpperCase();
      if (m !== 'GET' && a.confirm !== true) {
        throw new GumroadError(`${m} through gumroad_request needs confirm: true.`, 400);
      }
      return call(env, m, a.path, a.params || {});
    },
  },
];

const TOOL_SPECS = TOOLS.map(({ name, description, inputSchema }) => ({
  name, description, inputSchema,
}));

function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}

/* ==== src/mcp.js ==== */
/**
 * Minimal stateless MCP server over Streamable HTTP (JSON-RPC 2.0 on POST /mcp).
 *
 * Stateless on purpose: no session id, no SSE stream to hold open. Every POST is
 * self-contained, which is what lets Claude and Notion hit the same Worker
 * concurrently without stepping on each other.
 */


const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INFO = { name: 'gumroad-shop', version: '1.0.0' };

/* JSON-RPC error codes */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

function result(id, payload) {
  return { jsonrpc: '2.0', id, result: payload };
}

function failure(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

/** Tool errors are reported inside a successful result, per the MCP spec. */
function toolFailure(id, message, hint) {
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return result(id, { content: [{ type: 'text', text }], isError: true });
}

async function handleMessage(message, env) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return failure(null, INVALID_REQUEST, 'Request must be a JSON-RPC object.');
  }

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return result(id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications get no response body

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: TOOL_SPECS });

    case 'tools/call': {
      const name = params?.name;
      const tool = findTool(name);
      if (!tool) {
        return failure(id, METHOD_NOT_FOUND, `Unknown tool: ${name}`);
      }
      try {
        const output = await tool.handler(env, params?.arguments || {});
        return result(id, {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        });
      } catch (err) {
        return toolFailure(id, err.message || String(err), err.hint);
      }
    }

    default:
      if (isNotification) return null;
      return failure(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

async function handleMcpRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify(failure(null, INVALID_REQUEST, 'The MCP endpoint accepts POST only.')),
      { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify(failure(null, PARSE_ERROR, 'Body is not valid JSON.')), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // A batch is a JSON array; a single call is an object.
    if (Array.isArray(payload)) {
      const responses = (await Promise.all(payload.map((m) => handleMessage(m, env)))).filter(
        Boolean
      );
      if (responses.length === 0) return new Response(null, { status: 202 });
      return Response.json(responses);
    }

    const response = await handleMessage(payload, env);
    if (response === null) return new Response(null, { status: 202 });
    return Response.json(response);
  } catch (err) {
    return new Response(
      JSON.stringify(failure(payload?.id ?? null, INTERNAL_ERROR, err.message || 'Server error')),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/* ==== src/index.js ==== */
/**
 * gumroad-mcp-worker — the Gumroad shop exposed to Claude as an MCP server.
 *
 * Routes
 *   GET  /         human-readable status page
 *   GET  /health   JSON health, safe to poll
 *   POST /mcp      the MCP endpoint Claude connects to (bearer-protected)
 *
 * No OAuth and no KV: a Gumroad access token is long-lived, so it lives as a
 * Worker secret and that is the whole of the auth story.
 */


/** Length-independent comparison so the bearer check does not leak by timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerOk(request, env) {
  const expected = env.MCP_AUTH_TOKEN;
  // Fail closed. An unset token must never mean "open to the internet".
  if (!expected) return false;
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? safeEqual(match[1].trim(), expected) : false;
}

/**
 * Fallback for MCP clients whose connector dialog has no custom-header field:
 * the same token may be presented as ?key= on the /mcp URL. A header is
 * preferred, because query strings turn up in logs and referrers.
 */
function keyParamOk(url, env) {
  const expected = env.MCP_AUTH_TOKEN;
  if (!expected) return false;
  return safeEqual(url.searchParams.get('key') || '', expected);
}

function statusPage(env) {
  const ready = Boolean(env.GUMROAD_ACCESS_TOKEN) && Boolean(env.MCP_AUTH_TOKEN);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Gumroad MCP Server</title>
     <style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       max-width:640px;margin:8vh auto;padding:0 24px;color:#051C2C}
       code{background:#f2f4f7;padding:2px 6px;border-radius:4px;font-size:14px}
       .ok{color:#0a7d33}.bad{color:#c0392b}h1{font-size:22px}</style>
     <h1>Gumroad MCP Server</h1>
     <p>Status: <strong class="${ready ? 'ok' : 'bad'}">${ready ? 'ready' : 'not configured'}</strong></p>
     <ul>
       <li>Gumroad token: ${env.GUMROAD_ACCESS_TOKEN ? 'set' : 'missing. Cloudflare dashboard, this Worker, Settings, Variables and Secrets, Add, type <b>Secret</b>, key <code>GUMROAD_ACCESS_TOKEN</code>'}</li>
       <li>MCP bearer: ${env.MCP_AUTH_TOKEN ? 'set' : 'missing. Same place, key <code>MCP_AUTH_TOKEN</code>. A build variable is not enough: it must be a Secret, or it never reaches the runtime.'}</li>
     </ul>
     <p>Connect Claude to <code>POST /mcp</code> with the MCP bearer token.</p>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' ) return statusPage(env);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        gumroad_token: Boolean(env.GUMROAD_ACCESS_TOKEN),
        mcp_auth: Boolean(env.MCP_AUTH_TOKEN),
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === '/mcp') {
      if (!bearerOk(request, env) && !keyParamOk(url, env)) {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized.' } }),
          { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' } }
        );
      }
      return handleMcpRequest(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
