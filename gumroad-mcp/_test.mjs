/**
 * Offline tests. No network: global fetch is stubbed and every request the
 * Worker would make is asserted against Gumroad's documented shape.
 */
import assert from 'node:assert/strict';
import { handleMcpRequest } from './src/mcp.js';
import { TOOL_SPECS, findTool } from './src/tools.js';

let pass = 0, fail = 0;
const calls = [];
async function t(name, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

/** Stub fetch, recording every outbound request. */
function stub(responder) {
  globalThis.fetch = async (url, init = {}) => {
    const entry = {
      url: String(url),
      method: (init.method || 'GET').toUpperCase(),
      body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null,
      auth: (init.headers || {}).Authorization,
    };
    calls.push(entry);
    const r = responder(entry) || { success: true };
    return { ok: r.__status ? r.__status < 400 : true, status: r.__status || 200, text: async () => JSON.stringify(r) };
  };
}
const ENV = { GUMROAD_ACCESS_TOKEN: 'tok_test', MCP_AUTH_TOKEN: 'mcp_test' };
const rpc = (method, params, id = 1) =>
  handleMcpRequest(new Request('https://x/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }), ENV).then((r) => r.json());

/* ---- protocol ---- */
await t('initialize negotiates a protocol version', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.equal(r.result.serverInfo.name, 'gumroad-shop');
});
await t('tools/list returns every tool with a schema', async () => {
  const r = await rpc('tools/list');
  assert.equal(r.result.tools.length, TOOL_SPECS.length);
  for (const spec of r.result.tools) {
    assert.ok(spec.name.startsWith('gumroad_'), spec.name);
    assert.ok(spec.description && spec.description.length > 20, spec.name);
    assert.equal(spec.inputSchema.type, 'object', spec.name);
  }
});
await t('unknown tool is a JSON-RPC error', async () => {
  const r = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(r.error.code, -32601);
});
await t('every tool name is unique', () => {
  const names = TOOL_SPECS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});

/* ---- auth and transport ---- */
await t('non-POST is rejected', async () => {
  const r = await handleMcpRequest(new Request('https://x/mcp', { method: 'GET' }), ENV);
  assert.equal(r.status, 405);
});
await t('bad JSON is a parse error', async () => {
  const r = await handleMcpRequest(new Request('https://x/mcp', { method: 'POST', body: '{oops' }), ENV);
  assert.equal((await r.json()).error.code, -32700);
});
await t('bearer token is sent to Gumroad', async () => {
  calls.length = 0; stub(() => ({ success: true, user: {} }));
  await findTool('gumroad_get_user').handler(ENV, {});
  assert.equal(calls[0].auth, 'Bearer tok_test');
});
await t('a missing Gumroad token fails loudly', async () => {
  await assert.rejects(() => findTool('gumroad_get_user').handler({}, {}), /GUMROAD_ACCESS_TOKEN is not set/);
});

/* ---- endpoint shapes, checked against the Gumroad CLI ---- */
await t('list products calls GET /v2/products', async () => {
  calls.length = 0; stub(() => ({ success: true, products: [{ id: 'p1', name: 'A', published: true, sales_count: 3 }] }));
  const out = await findTool('gumroad_list_products').handler(ENV, {});
  assert.equal(calls[0].url, 'https://api.gumroad.com/v2/products');
  assert.equal(calls[0].method, 'GET');
  assert.equal(out.count, 1);
  assert.equal(out.products[0].id, 'p1');
});
await t('create posts form-encoded fields to /v2/products', async () => {
  calls.length = 0; stub(() => ({ success: true, product: { id: 'new' } }));
  await findTool('gumroad_create_product').handler(ENV, { name: 'Art Pack', price: 1000, price_currency_type: 'usd' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.gumroad.com/v2/products');
  assert.deepEqual(calls[0].body, { name: 'Art Pack', price: '1000', price_currency_type: 'usd' });
});
await t('update PUTs only the fields given', async () => {
  calls.length = 0; stub(() => ({ success: true }));
  await findTool('gumroad_update_product').handler(ENV, { product_id: 'p1', patch: { name: 'B' } });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, 'https://api.gumroad.com/v2/products/p1');
  assert.deepEqual(calls[0].body, { name: 'B' });
});
await t('publish and unpublish hit enable and disable', async () => {
  calls.length = 0; stub(() => ({ success: true }));
  await findTool('gumroad_publish_product').handler(ENV, { product_id: 'p1' });
  await findTool('gumroad_unpublish_product').handler(ENV, { product_id: 'p1' });
  assert.ok(calls[0].url.endsWith('/products/p1/enable'));
  assert.ok(calls[1].url.endsWith('/products/p1/disable'));
});
await t('an unknown patch field is refused before any request', async () => {
  calls.length = 0; stub(() => ({ success: true }));
  await assert.rejects(
    () => findTool('gumroad_update_product').handler(ENV, { product_id: 'p1', patch: { colour: 'red' } }),
    /Unsupported field\(s\)/);
  assert.equal(calls.length, 0);
});

/* ---- destructive actions are gated ---- */
await t('delete without confirm makes no request', async () => {
  calls.length = 0; stub(() => ({ success: true }));
  await assert.rejects(() => findTool('gumroad_delete_product').handler(ENV, { product_id: 'p1', confirm: false }), /confirm/);
  assert.equal(calls.length, 0);
});
await t('refund without confirm makes no request', async () => {
  calls.length = 0; stub(() => ({ success: true }));
  await assert.rejects(() => findTool('gumroad_refund_sale').handler(ENV, { sale_id: 's1', confirm: false }), /confirm/);
  assert.equal(calls.length, 0);
});
await t('gumroad_request blocks writes without confirm', async () => {
  calls.length = 0; stub(() => ({ success: true }));
  await assert.rejects(() => findTool('gumroad_request').handler(ENV, { method: 'DELETE', path: '/products/p1' }), /confirm/);
  assert.equal(calls.length, 0);
});

/* ---- bulk ---- */
await t('bulk update defaults to a dry run and touches nothing', async () => {
  calls.length = 0;
  stub(() => ({ success: true, products: [
    { id: 'a', name: 'Free thing', price: 0, published: true, sales_count: 0 },
    { id: 'b', name: 'Paid thing', price: 900, published: true, sales_count: 12 }] }));
  const out = await findTool('gumroad_bulk_update_products').handler(ENV, { filter: { free: true }, patch: { name: 'x' } });
  assert.equal(out.dry_run, true);
  assert.deepEqual(out.product_ids, ['a']);
  assert.equal(calls.length, 1); // the catalogue read only
});
await t('bulk update with dry_run false writes to each target', async () => {
  calls.length = 0;
  stub((c) => c.method === 'GET'
    ? { success: true, products: [{ id: 'a', published: false }, { id: 'b', published: false }] }
    : { success: true });
  const out = await findTool('gumroad_bulk_set_published').handler(ENV, { filter: { published: false }, published: true, dry_run: false });
  assert.equal(out.total, 2);
  assert.equal(out.succeeded, 2);
  assert.ok(calls.some((c) => c.url.endsWith('/products/a/enable')));
  assert.ok(calls.some((c) => c.url.endsWith('/products/b/enable')));
});
await t('one failure in a bulk run does not sink the others', async () => {
  calls.length = 0;
  stub((c) => {
    if (c.method === 'GET') return { success: true, products: [{ id: 'a' }, { id: 'b' }] };
    if (c.url.includes('/products/a')) return { __status: 422, success: false, message: 'nope' };
    return { success: true };
  });
  const out = await findTool('gumroad_bulk_update_products').handler(ENV, { patch: { name: 'x' }, dry_run: false });
  assert.equal(out.succeeded, 1);
  assert.equal(out.failed, 1);
  assert.equal(out.results.find((r) => r.id === 'a').error, 'nope');
});

/* ---- error handling ---- */
await t('HTTP 200 with success false is still an error', async () => {
  stub(() => ({ success: false, message: 'The product was not found.' }));
  await assert.rejects(() => findTool('gumroad_get_product').handler(ENV, { product_id: 'x' }), /not found/);
});
await t('a 404 on create explains the dashboard fallback', async () => {
  stub(() => ({ __status: 404, success: false, message: 'Not Found' }));
  await assert.rejects(
    () => findTool('gumroad_create_product').handler(ENV, { name: 'x' }),
    (e) => /dashboard/.test(e.hint || ''));
});
await t('a 401 explains how to regenerate the token', async () => {
  stub(() => ({ __status: 401, success: false, message: 'Unauthorized' }));
  await assert.rejects(() => findTool('gumroad_get_user').handler(ENV, {}),
    (e) => /Regenerate it at Gumroad/.test(e.hint || ''));
});

/* ---- sales ---- */
await t('sales paginate with page_key until exhausted', async () => {
  calls.length = 0; let n = 0;
  stub(() => (++n === 1
    ? { success: true, sales: [{ price: 1000, gumroad_fee: 100, paid: true, product_name: 'A' }], next_page_key: 'k2' }
    : { success: true, sales: [{ price: 500, gumroad_fee: 50, paid: true, product_name: 'B' }] }));
  const out = await findTool('gumroad_list_sales').handler(ENV, { summary_only: true });
  assert.equal(out.records, 2);
  assert.equal(out.gross_cents, 1500);
  assert.equal(out.fees_cents, 150);
  assert.ok(calls[1].url.includes('page_key=k2'));
});

/* ---- auth on the /mcp route, both accepted forms ---- */
import worker from './src/index.js';
await t('/mcp rejects a request with no credential', async () => {
  const r = await worker.fetch(new Request('https://x/mcp', { method: 'POST', body: '{}' }), ENV);
  assert.equal(r.status, 401);
});
await t('/mcp accepts the bearer header', async () => {
  const r = await worker.fetch(new Request('https://x/mcp', {
    method: 'POST', headers: { Authorization: 'Bearer mcp_test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), ENV);
  assert.equal((await r.json()).result.tools.length, TOOL_SPECS.length);
});
await t('/mcp accepts the same token as ?key=', async () => {
  const r = await worker.fetch(new Request('https://x/mcp?key=mcp_test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), ENV);
  assert.equal((await r.json()).result.tools.length, TOOL_SPECS.length);
});
await t('/mcp rejects a wrong ?key=', async () => {
  const r = await worker.fetch(new Request('https://x/mcp?key=nope', { method: 'POST', body: '{}' }), ENV);
  assert.equal(r.status, 401);
});
await t('an unset MCP_AUTH_TOKEN fails closed', async () => {
  const r = await worker.fetch(new Request('https://x/mcp?key=', { method: 'POST', body: '{}' }), {});
  assert.equal(r.status, 401);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
