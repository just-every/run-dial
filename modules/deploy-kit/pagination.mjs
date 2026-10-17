import { assert } from './validation.mjs';

// Request strategies describe the wire parameters only. Every endpoint uses
// this reader to decide whether a reply actually has another page.
export async function* providerPages(envelope, path, {field, pagination = 'page', zone = false, signal} = {}) {
  assert(['page','cursor','r2-bounded','single'].includes(pagination), 'invalid-list-pagination');
  assert(pagination !== 'r2-bounded' || path === '/r2/buckets' && field === 'buckets', 'invalid-r2-bounded-list');
  const cursorMode = pagination === 'cursor' || pagination === 'r2-bounded';
  const url = new URL(path, 'https://api.cloudflare.com');
  const perPage = Number(url.searchParams.get('per_page') ?? url.searchParams.get('limit') ?? (cursorMode ? 1000 : pagination === 'single' ? 10000 : 100));
  assert(Number.isSafeInteger(perPage) && perPage > 0, 'invalid-list-pagination');
  let cursor, total, count = 0, pageMode = false;
  const seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams(url.searchParams);
    if (cursor) {
      query.delete('page');
      if (pagination !== 'single' && !query.has('limit')) query.set('per_page',String(perPage));
      query.set('cursor',cursor);
    }
    else if ((pageMode || !cursorMode) && (pagination !== 'single' || page > 1)) query.set('page',String(page));
    if (pagination !== 'single' && !query.has('limit')) query.set('per_page',String(perPage));
    const requestPath = url.pathname + (query.size ? `?${query}` : '');
    let data, rows, next;
    try {
      data = await envelope(requestPath, {zone,signal});
      rows = field ? data.result?.[field] : data.result;
      assert(Array.isArray(rows), 'provider-invalid-list');
      assert(rows.length <= perPage, 'provider-partial-list');
      count += rows.length;
      const info = data.result_info;
      if (info == null) {
        assert(rows.length < perPage, 'provider-incomplete-pagination');
        assert(total === undefined || count === total, 'provider-partial-list');
      } else {
        assert(typeof info === 'object' && !Array.isArray(info), 'provider-incomplete-pagination');
        if (info.per_page !== undefined) {
          assert(Number.isSafeInteger(info.per_page) && info.per_page > 0 && info.per_page <= perPage, 'provider-incomplete-pagination');
          assert(rows.length <= info.per_page, 'provider-partial-list');
        }
        if (info.count !== undefined) assert(info.count === rows.length, 'provider-partial-list');
        if (info.page !== undefined) assert(info.page === page, 'provider-incomplete-pagination');
        if (info.total_count !== undefined) {
          assert(Number.isSafeInteger(info.total_count) && info.total_count >= 0, 'provider-incomplete-pagination');
          total ??= info.total_count;
          assert(total === info.total_count, 'provider-pagination-changed');
          assert(count <= total, 'provider-partial-list');
        }
        if (info.total_pages !== undefined) assert(Number.isSafeInteger(info.total_pages) && info.total_pages >= 0 && (info.total_pages > 0 || count === 0), 'provider-incomplete-pagination');
        if (info.is_truncated !== undefined) assert(typeof info.is_truncated === 'boolean', 'provider-incomplete-pagination');
        assert(!info.delimited || Array.isArray(info.delimited) && !info.delimited.length, 'provider-incomplete-pagination');
        assert(info.cursor == null || typeof info.cursor === 'string', 'provider-invalid-cursor');
        const morePages = info.total_pages !== undefined && page < info.total_pages;
        const moreRows = total !== undefined && count < total;
        if (info.cursor) {
          assert(info.is_truncated !== false, 'provider-invalid-cursor');
          assert((info.total_pages === undefined || morePages) && (total === undefined || moreRows), 'provider-partial-list');
          assert(info.cursor.length <= 4096 && /^[a-zA-Z0-9_+\/=-]+$/.test(info.cursor) && !seen.has(info.cursor), 'provider-invalid-cursor');
          seen.add(info.cursor); next = info.cursor;
        } else if (info.is_truncated === true) {
          throw new Error('provider-incomplete-pagination');
        } else if (cursorMode && moreRows && !morePages) {
          throw new Error('provider-partial-list');
        } else if (morePages || moreRows) {
          assert(info.total_pages === undefined || morePages, 'provider-partial-list');
          next = true;
        } else {
          assert(total === undefined || count === total, 'provider-partial-list');
        }
        if (next) assert(rows.length > 0 || morePages || typeof next === 'string', 'provider-partial-list');
      }
    } catch (error) {
      // No response bodies, query values, account IDs or cursors in diagnostics.
      error.providerCall ??= {operation:`GET ${url.pathname}`,reason:error.message};
      throw error;
    }
    yield {rows,data};
    if (!next) return;
    cursor = typeof next === 'string' ? next : undefined;
    pageMode = next === true;
  }
  const error = new Error('provider-pagination-limit');
  error.providerCall = {operation:`GET ${url.pathname}`,reason:'Cloudflare continued advertising pages beyond the request limit'};
  throw error;
}

// Keep result wrappers (versions/items, schedules, deployments) for existing kit
// callers while ensuring their GETs cannot bypass pagination. Query filters stay
// on every request; writes never pass through the reader.
export function providerListShape(path) {
  const base = path.split('?')[0];
  if (base === '/r2/buckets') return {field:'buckets',pagination:'cursor'};
  if (/^\/r2\/buckets\/[^/]+\/objects$/.test(base) || /^\/storage\/kv\/namespaces\/[^/]+\/keys$/.test(base)) return {pagination:'cursor'};
  const field = /\/workers\/scripts\/[^/]+\/(versions|deployments|schedules)$/.exec(base)?.[1];
  if (field) return {field:field === 'versions' ? 'items' : field,...(field === 'schedules' ? {pagination:'single'} : {})};
  if (['/d1/database','/storage/kv/namespaces','/queues','/workers/durable_objects/namespaces','/workers/domains','/zones','/containers/applications'].includes(base)) return {};
  if (['/workers/scripts','/d1/database','/storage/kv/namespaces','/queues','/workers/durable_objects/namespaces','/workers/domains','/zones'].includes(base) || /^\/queues\/[^/]+\/consumers$/.test(base) || /^\/workers\/scripts\/[^/]+\/secrets$/.test(base) || /^\/zones\/[^/]+\/workers\/routes$/.test(base)) return {pagination:'single'};
  return undefined;
}
