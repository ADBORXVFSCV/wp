#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'memory.sqlite');
const args = process.argv.slice(2);
const force = args.includes('--yes') || args.includes('-y');
const dryRun = args.includes('--dry-run') || args.includes('-n');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
}

async function confirmCleanup() {
  if (force) return true;
  const answer = await prompt('This will reset the WhatsApp AI SQLite database file (memory.sqlite). Continue? (y/N) ');
  return ['y', 'yes'].includes(answer);
}

function removeDatabaseFile() {
  if (!fs.existsSync(dbPath)) {
    console.log('[Clean DB] No database file found at', dbPath);
    return false;
  }

  fs.unlinkSync(dbPath);
  console.log('[Clean DB] Removed existing database file:', dbPath);
  return true;
}

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS personas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE,
          phone TEXT,
          personal_details TEXT,
          ai_thoughts TEXT,
          unread_notes_for_user TEXT,
          seen_notes_for_user TEXT,
          questions_to_user TEXT,
          direction_of_communication TEXT,
          user_rules TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_name TEXT UNIQUE,
          priority_number INTEGER DEFAULT 0,
          members TEXT,
          ai_thoughts TEXT,
          unread_notes_for_user TEXT,
          seen_notes_for_user TEXT,
          questions_to_user TEXT,
          direction_of_communication TEXT,
          user_rules TEXT
        )`, (createErr) => {
          db.close();
          if (createErr) return reject(createErr);
          resolve();
        });
      });
    });
  });
}

(async function main() {
  try {
    if (dryRun) {
      console.log('[Clean DB] Dry run enabled. No files will be deleted.');
    }

    const confirmed = await confirmCleanup();
    if (!confirmed) {
      console.log('[Clean DB] Cancelled by user. No changes made.');
      process.exit(0);
    }

    if (dryRun) {
      console.log('[Clean DB] Would remove database:', dbPath);
      process.exit(0);
    }

    removeDatabaseFile();
    await initializeDatabase();
    console.log('[Clean DB] Fresh SQLite database initialized at', dbPath);
  } catch (error) {
    console.error('[Clean DB] Error:', error.message);
    process.exit(1);
  }
})();
