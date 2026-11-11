// A D1-shaped binding over Node's built-in node:sqlite, so storage/d1.js and schema.sql are tested against
// a real SQLite engine (D1 is SQLite). Implements the parts of the D1 API the store uses.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function createSqliteD1(schemaPath = new URL("../../schema.sql", import.meta.url)) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(schemaPath, "utf8"));

  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      for (const a of args) if (a === undefined) throw new TypeError("D1_TYPE_ERROR: undefined cannot be bound");
      return new Statement(this.sql, args);
    }
    async first() {
      return db.prepare(this.sql).get(...this.args) ?? null;
    }
    async all() {
      return { success: true, results: db.prepare(this.sql).all(...this.args), meta: {} };
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  }

  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    _db: db,
  };
}
