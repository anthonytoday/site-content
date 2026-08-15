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

export class GumroadError extends Error {
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
export async function call(env, method, path, params = {}) {
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

export const get = (env, path, params) => call(env, 'GET', path, params);
export const post = (env, path, params) => call(env, 'POST', path, params);
export const put = (env, path, params) => call(env, 'PUT', path, params);
export const del = (env, path, params) => call(env, 'DELETE', path, params);

/** Walks every page of /sales. Gumroad paginates with page_key. */
export async function allSales(env, filters = {}, maxPages = 40) {
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

/**
 * Walks every page of /products.
 *
 * Gumroad's docs claim this endpoint returns all products and document no
 * pagination. In practice it caps at 10, newest first, which silently hides
 * the rest of a catalogue. This follows ?page= until a page repeats or comes
 * back short, and de-duplicates by id so a server that ignores the parameter
 * degrades to a single page rather than looping.
 */
export async function allProducts(env, maxPages = 30) {
  const byId = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const body = await get(env, '/products', page > 1 ? { page } : {});
    const batch = body.products || [];
    if (batch.length === 0) break;
    const before = byId.size;
    for (const p of batch) byId.set(p.id, p);
    // No new ids means the parameter is being ignored. Stop rather than spin.
    if (byId.size === before) break;
    if (batch.length < 10) break;
  }
  return [...byId.values()];
}
