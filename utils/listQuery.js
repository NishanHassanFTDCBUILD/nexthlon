const {linkBuilder} = require('./queryString');
const {PAGE_SIZES} = require('./paging');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only schema-owned fields and sorts reach MongoDB. Query objects/arrays are never accepted.
function readListQuery(query = {}, schema) {
  const scalar = (value) => (typeof value === 'string' ? value.trim() : '');
  const search = scalar(query.q);
  const q = (schema.cleanSearch ? schema.cleanSearch(search) : search).slice(
    0,
    schema.searchMax || 80,
  );
  const numericScalar = (value) =>
    Number.isSafeInteger(value) ? String(value) : scalar(value);
  const rawPage = numericScalar(query.page);
  const page =
    /^\d+$/.test(rawPage) && Number(rawPage) > 0
      ? Math.min(Number(rawPage), 100000)
      : 1;
  const wanted = Number(numericScalar(query.limit));
  const size = PAGE_SIZES.includes(wanted) ? wanted : schema.pageSize || 20;
  const sort = Object.hasOwn(schema.sorts, scalar(query.sort))
    ? scalar(query.sort)
    : schema.defaultSort;
  const filters = {
    q,
    sort,
    page,
    limit: size === (schema.pageSize || 20) ? '' : size,
  };
  for (const [key, field] of Object.entries(schema.fields || {})) {
    const value = scalar(query[key]);
    filters[key] =
      value &&
      (!field.values || field.values.includes(value)) &&
      (!field.validate || field.validate(value))
        ? field.clean
          ? field.clean(value)
          : value.slice(0, field.maxLength || 120)
        : field.default || '';
  }
  const clauses = [];
  if (schema.baseFilter) clauses.push(schema.baseFilter);
  if (q && schema.searchFields) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    clauses.push({
      $or: schema.searchFields.map((field) => ({[field]: pattern})),
    });
  }
  for (const [key, field] of Object.entries(schema.fields || {})) {
    if (field.match && filters[key] && filters[key] !== 'all')
      clauses.push(field.match(filters[key], filters));
  }
  const mongo =
    clauses.length === 1 ? clauses[0] : clauses.length ? {$and: clauses} : {};
  const order = {...schema.sorts[sort].order};
  // Stable ordering prevents records with the same sort value jumping between pages.
  const stableKey = schema.stableKey || '_id';
  if (!Object.hasOwn(order, stableKey)) order[stableKey] = 1;
  const link = linkBuilder(schema.path || '', {...filters, page: ''});
  const chips = Object.entries(schema.fields || {})
    .filter(
      ([key, field]) =>
        field.label &&
        filters[key] &&
        filters[key] !== 'all' &&
        filters[key] !== field.default,
    )
    .map(([key, field]) => ({
      key,
      label: `${field.label}: ${field.labels?.[filters[key]] || filters[key]}`,
      href: link({[key]: field.default || '', page: ''}),
    }));
  if (q)
    chips.unshift({
      key: 'q',
      label: `Search: ${q}`,
      href: link({q: '', page: ''}),
    });
  return {
    filters,
    mongo,
    order,
    size,
    skip: (page - 1) * size,
    chips,
    sorts: schema.sorts,
    pagination: (total) => ({
      page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    }),
  };
}

async function runList(
  Model,
  query,
  schema,
  {select, populate, map = (row) => row} = {},
) {
  const list = readListQuery(query, schema);
  if (schema.resolveFilter) {
    const extra = await schema.resolveFilter(list.filters);
    if (extra && Object.keys(extra).length)
      list.mongo = Object.keys(list.mongo).length
        ? {$and: [list.mongo, extra]}
        : extra;
  }
  let find = Model.find(list.mongo)
    .sort(list.order)
    .skip(list.skip)
    .limit(list.size);
  if (select) find = find.select(select);
  if (populate) find = find.populate(populate);
  const [rows, total] = await Promise.all([
    find.lean(),
    Model.countDocuments(list.mongo),
  ]);
  return {
    rows: rows.map(map),
    filters: list.filters,
    chips: list.chips,
    sorts: list.sorts,
    pagination: list.pagination(total),
  };
}

module.exports = {readListQuery, runList};
