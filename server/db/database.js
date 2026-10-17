const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../pixel_mission.db');
const db = new DatabaseSync(dbPath);


// Enable WAL mode
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

db.dbPath = dbPath;
console.log(`[DB] Database connected and schema initialized at: ${dbPath}`);

module.exports = db;

