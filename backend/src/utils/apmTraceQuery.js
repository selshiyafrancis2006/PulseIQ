const { resolveApmRange } = require('./apmRange');

const STATUS_FILTERS = ['2xx', '3xx', '4xx', '5xx', 'error'];
const SORTS = ['timestamp', 'duration', 'status'];
const ORDERS = ['asc', 'desc'];

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 10000;
const MAX_INT = 2147483647;

const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

const isBlank = (value) => value === undefined || value === '';

// Strict integer parsing: "12abc", "1.5" and arrays are rejected.
const parseInteger = (value, { min, max }) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

    const number = Number(value);

    return number >= min && number <= max ? number : null;
};

// Validates the query string of the requests list and the route drill-down.
// Returns { error } or { value }. Never throws, never trusts types: Express
// hands back arrays for repeated keys (?method=GET&method=POST).
function parseTraceQuery(query, { requireRoute = false } = {}) {

    const range = resolveApmRange(query.range);

    if (!range) {
        return { error: 'range must be one of: 15m, 1h, 6h, 24h, 7d' };
    }

    const value = { range, method: null, route: null, status: null, minDurationMs: null };

    if (!isBlank(query.method)) {
        if (typeof query.method !== 'string' || !/^[A-Za-z]{1,10}$/.test(query.method)) {
            return { error: 'method must be an HTTP method name' };
        }
        value.method = query.method.toUpperCase();
    }

    if (!isBlank(query.route)) {
        if (
            typeof query.route !== 'string' ||
            query.route.length > 255 ||
            CONTROL_CHARS.test(query.route)
        ) {
            return { error: 'route must be at most 255 characters' };
        }
        value.route = query.route;
    }

    if (requireRoute && (!value.method || !value.route)) {
        return { error: 'method and route are required' };
    }

    if (!isBlank(query.status)) {
        if (!STATUS_FILTERS.includes(query.status)) {
            return { error: `status must be one of: ${STATUS_FILTERS.join(', ')}` };
        }
        value.status = query.status;
    }

    if (!isBlank(query.min_duration_ms)) {
        const parsed = parseInteger(query.min_duration_ms, { min: 0, max: MAX_INT });

        if (parsed === null) {
            return { error: 'min_duration_ms must be a non-negative integer' };
        }
        value.minDurationMs = parsed;
    }

    value.sort = 'timestamp';
    if (!isBlank(query.sort)) {
        if (!SORTS.includes(query.sort)) {
            return { error: `sort must be one of: ${SORTS.join(', ')}` };
        }
        value.sort = query.sort;
    }

    value.order = 'desc';
    if (!isBlank(query.order)) {
        if (!ORDERS.includes(query.order)) {
            return { error: 'order must be asc or desc' };
        }
        value.order = query.order;
    }

    value.page = 1;
    if (!isBlank(query.page)) {
        const parsed = parseInteger(query.page, { min: 1, max: MAX_PAGE });

        if (parsed === null) {
            return { error: `page must be an integer from 1 to ${MAX_PAGE}` };
        }
        value.page = parsed;
    }

    value.pageSize = DEFAULT_PAGE_SIZE;
    if (!isBlank(query.page_size)) {
        const parsed = parseInteger(query.page_size, { min: 1, max: MAX_PAGE_SIZE });

        if (parsed === null) {
            return { error: `page_size must be an integer from 1 to ${MAX_PAGE_SIZE}` };
        }
        value.pageSize = parsed;
    }

    return { value };
}

module.exports = {
    parseTraceQuery,
    STATUS_FILTERS,
    SORTS,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
};