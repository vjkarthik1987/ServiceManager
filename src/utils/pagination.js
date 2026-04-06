function getPagination(query = {}, defaultPageSize = 10) {
  const page = Math.max(1, Number(query.page || 1) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(query.pageSize || defaultPageSize) || defaultPageSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function buildPager({ totalItems, page, pageSize }) {
  const totalPages = Math.max(1, Math.ceil((Number(totalItems) || 0) / pageSize));
  return { page, pageSize, totalItems, totalPages, hasPrev: page > 1, hasNext: page < totalPages };
}

function buildQueryString(base = {}, overrides = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...base, ...overrides }).forEach(([key, value]) => {
    if (value === null || typeof value === 'undefined' || value === '') return;
    params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

module.exports = { getPagination, buildPager, buildQueryString };
