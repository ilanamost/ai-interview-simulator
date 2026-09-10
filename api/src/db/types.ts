/**
 * The minimal surface repositories need from `pg`. Both `Pool` and `PoolClient`
 * satisfy this structurally, and tests can pass a plain mock instead of a real
 * database (.rule/testing-rules.md: mock only unstable external dependencies).
 */
export interface Queryable {
  query<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>
}
