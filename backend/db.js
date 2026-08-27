// Async Postgres DB layer for AlphaTech — provides the async get/all/run/
// execute/transaction API used by server.js against Supabase Postgres.
//
// Usage:
//   const db = require('./db');
//   const row = await db.get("SELECT * FROM users WHERE id = $1", [id]);
//   const rows = await db.all("SELECT ... ");
//   const result = await db.run("INSERT INTO ... RETURNING id", [...]);
//   await db.transaction(async (tx) => { ... });  // tx.get/all/run work too
//
// Parameter style: we accept both $1 and ? markers. Query strings written for
// SQLite (? placeholders) are auto-converted to Postgres $n placeholders.

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is not set. Point it at your Supabase Postgres connection string.');
    if (process.env.NODE_ENV === 'production') process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
    console.error('Unexpected Postgres pool error:', err);
});

// Convert SQLite '?' positional markers to Postgres $n.
// Ignores '?' inside string literals to be safe (rare in this codebase).
function convertParams(sql) {
    if (!sql.includes('?')) return sql;
    let out = '';
    let n = 0;
    let inStr = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'") {
            inStr = !inStr;
            out += ch;
        } else if (ch === '?' && !inStr) {
            n++;
            out += '$' + n;
        } else {
            out += ch;
        }
    }
    return out;
}

async function _query(client, sql, params) {
    const converted = convertParams(sql);
    const res = await client.query(converted, params || []);
    return res;
}

// Get a single row (or null)
async function get(sql, params) {
    const res = await _query(pool, sql, params);
    return res.rows[0] || null;
}

// Get all rows
async function all(sql, params) {
    const res = await _query(pool, sql, params);
    return res.rows;
}

// Run a single statement that doesn't need a returned row.
// Mimics sqlite's run() result shape: { changes, lastInsertRowid }
async function run(sql, params) {
    const res = await _query(pool, sql + ' RETURNING id', params);
    return {
        changes: res.rowCount || 0,
        lastInsertRowid: res.rows[0] ? res.rows[0].id : null,
    };
}

// Run a value-returning INSERT/UPDATE without forcing RETURNING id.
async function execute(sql, params) {
    const res = await _query(pool, sql, params);
    return { changes: res.rowCount || 0, lastInsertRowid: null };
}

// Run queries within a transaction.
async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tx = {
            get: async (sql, params) => {
                const res = await _query(client, sql, params);
                return res.rows[0] || null;
            },
            all: async (sql, params) => {
                const res = await _query(client, sql, params);
                return res.rows;
            },
            run: async (sql, params) => {
                const res = await _query(client, sql + ' RETURNING id', params);
                return {
                    changes: res.rowCount || 0,
                    lastInsertRowid: res.rows[0] ? res.rows[0].id : null,
                };
            },
            execute: async (sql, params) => {
                const res = await _query(client, sql, params);
                return { changes: res.rowCount || 0, lastInsertRowid: null };
            },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Test connectivity
async function ping() {
    const res = await pool.query('SELECT 1 as ok');
    return res.rows[0].ok === 1;
}

module.exports = { pool, get, all, run, execute, transaction, ping, convertParams };
