/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters -- This bounded in-memory database exercises registered Convex handlers without an external deployment. */
import type { MutationCtx } from "../../convex/_generated/server.js";

export type FixtureRow = Record<string, unknown> & { _id: string };

export function convexMutationFixture(ownerId = "owner_1") {
  const tables = new Map<string, FixtureRow[]>();
  let nextId = 0;
  const scheduled: Array<{ delayMs: number; args: Record<string, unknown> }> = [];
  const rows = (table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: FixtureRow[] = [];
    tables.set(table, created);
    return created;
  };
  const get = (id: string) => [...tables.values()].flat().find((row) => row._id === id) ?? null;
  const db = {
    query(table: string) {
      const filters: Array<(row: FixtureRow) => boolean> = [];
      let descending = false;
      const index = {
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return index; },
        gte(key: string, value: string) { filters.push((row) => String(row[key]) >= value); return index; },
        lte(key: string, value: string) { filters.push((row) => String(row[key]) <= value); return index; },
      };
      const found = () => {
        const result = rows(table).filter((row) => filters.every((predicate) => predicate(row)));
        return descending ? result.toReversed() : result;
      };
      const query = {
        withIndex(_name: string, configure: (value: typeof index) => typeof index) { configure(index); return query; },
        order(value: string) { descending = value === "desc"; return query; },
        async collect() { return found(); },
        async take(count: number) { return found().slice(0, count); },
        async paginate(options: { cursor: string | null; numItems: number }) {
          const start = options.cursor === null ? 0 : Number(options.cursor);
          const matches = found();
          const page = matches.slice(start, start + options.numItems);
          return { page, isDone: start + page.length >= matches.length, continueCursor: String(start + page.length) };
        },
        async first() { return found()[0] ?? null; },
        async unique() {
          const matches = found();
          if (matches.length > 1) throw new Error("fixture_duplicate_index");
          return matches[0] ?? null;
        },
      };
      return query;
    },
    async get(id: string) { return get(id); },
    async insert(table: string, value: Record<string, unknown>) {
      const _id = `${table}:${++nextId}`;
      rows(table).push({ ...value, _id, _creationTime: Date.now() });
      return _id;
    },
    async patch(id: string, fields: Record<string, unknown>) {
      const row = get(id);
      if (!row) throw new Error("fixture_missing_row");
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete row[key]; else row[key] = value;
      }
    },
    async replace(id: string, fields: Record<string, unknown>) {
      const row = get(id);
      if (!row) throw new Error("fixture_missing_row");
      for (const key of Object.keys(row)) if (key !== "_id" && key !== "_creationTime") delete row[key];
      Object.assign(row, fields);
    },
  };
  const scheduler = {
    async runAfter(delayMs: number, _function: unknown, args: Record<string, unknown>) {
      scheduled.push({ delayMs, args });
      return `scheduled:${scheduled.length}`;
    },
  };
  // SAFETY: These tests call only the database, auth, and scheduler methods defined above.
  // Unsupported Convex runtime operations fail immediately instead of returning fabricated data.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The fixture intentionally omits unrelated Convex APIs.
  const ctx = { db, scheduler, auth: { getUserIdentity: async () => ({ subject: ownerId }) } } as unknown as MutationCtx;
  return { ctx, rows, scheduled };
}

interface RegisteredMutationFixture { isConvexFunction: true; isMutation: true }

export async function invokeMutation(
  mutation: RegisteredMutationFixture,
  ctx: MutationCtx,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // SAFETY: Convex 1.43.0 registration_impl.js stores the original callback on _handler.
  const registered = mutation as RegisteredMutationFixture & {
    _handler: (context: MutationCtx, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  return registered._handler(ctx, args);
}
