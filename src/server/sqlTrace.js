// Synchronous scopes only: SQLite functions execute without yielding the event loop.
let active = null
export function captureSql(work) {
  const previous = active
  const queries = []
  active = queries
  try { return { value: work(), queries } }
  finally { active = previous; previous?.push(...queries) }
}
export function prepareReadOnly(database, sql) {
  const statement = database.prepare(sql)
  const invoke = method => (...parameters) => {
    active?.push({ sql, parameters })
    return statement[method](...parameters)
  }
  return { all: invoke('all'), get: invoke('get') }
}
