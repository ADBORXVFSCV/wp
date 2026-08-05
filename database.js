const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'memory.sqlite');
const db = new sqlite3.Database(dbPath);
const COMMANDER_PROFILE_PATH = path.join(__dirname, 'commander_profile.txt');

function initDB() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Create Persona Table
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

            // Create Groups Table
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
            )`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function getPersona(identifier) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM personas WHERE name = ? OR phone = ? OR id = ?`, [identifier, identifier, identifier], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getGroup(identifier) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM groups WHERE group_name = ? OR id = ?`, [identifier, identifier], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getAllPersonas() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM personas ORDER BY id DESC`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getAllGroups() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM groups ORDER BY priority_number DESC, id DESC`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function upsertPersona(persona) {
    return new Promise((resolve, reject) => {
        const {
            name,
            phone = '',
            personal_details = '',
            ai_thoughts = '',
            unread_notes_for_user = '',
            seen_notes_for_user = '',
            questions_to_user = '',
            direction_of_communication = '',
            user_rules = ''
        } = persona;

        db.run(`INSERT INTO personas (
                    name, phone, personal_details, ai_thoughts, 
                    unread_notes_for_user, seen_notes_for_user, questions_to_user, 
                    direction_of_communication, user_rules
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET 
                    phone=excluded.phone, 
                    personal_details=excluded.personal_details, 
                    ai_thoughts=excluded.ai_thoughts, 
                    unread_notes_for_user=excluded.unread_notes_for_user, 
                    seen_notes_for_user=excluded.seen_notes_for_user, 
                    questions_to_user=excluded.questions_to_user, 
                    direction_of_communication=excluded.direction_of_communication, 
                    user_rules=excluded.user_rules`,
            [name, phone, personal_details, ai_thoughts, unread_notes_for_user, seen_notes_for_user, questions_to_user, direction_of_communication, user_rules],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
    });
}

function upsertGroup(group) {
    return new Promise((resolve, reject) => {
        const {
            group_name,
            priority_number = 0,
            members = [],
            ai_thoughts = '',
            unread_notes_for_user = '',
            seen_notes_for_user = '',
            questions_to_user = '',
            direction_of_communication = '',
            user_rules = ''
        } = group;

        const membersJson = typeof members === 'string' ? members : JSON.stringify(members);

        db.run(`INSERT INTO groups (
                    group_name, priority_number, members, ai_thoughts, 
                    unread_notes_for_user, seen_notes_for_user, questions_to_user, 
                    direction_of_communication, user_rules
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(group_name) DO UPDATE SET 
                    priority_number=excluded.priority_number, 
                    members=excluded.members, 
                    ai_thoughts=excluded.ai_thoughts, 
                    unread_notes_for_user=excluded.unread_notes_for_user, 
                    seen_notes_for_user=excluded.seen_notes_for_user, 
                    questions_to_user=excluded.questions_to_user, 
                    direction_of_communication=excluded.direction_of_communication, 
                    user_rules=excluded.user_rules`,
            [group_name, priority_number, membersJson, ai_thoughts, unread_notes_for_user, seen_notes_for_user, questions_to_user, direction_of_communication, user_rules],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
    });
}

/**
 * Reads the Commander Profile text file containing personal knowledge & memories.
 */
function getCommanderProfile() {
    if (fs.existsSync(COMMANDER_PROFILE_PATH)) {
        return fs.readFileSync(COMMANDER_PROFILE_PATH, 'utf-8');
    }
    return '';
}

/**
 * Appends or modifies memories in commander_profile.txt
 */
function updateCommanderProfileMemory(newMemoryText) {
    try {
        let content = getCommanderProfile();
        if (content.includes('[DATABASE_MEMORIES]')) {
            content = content.replace('[DATABASE_MEMORIES]', `[DATABASE_MEMORIES]\n- ${newMemoryText}`);
        } else {
            content += `\n\n[DATABASE_MEMORIES]\n- ${newMemoryText}`;
        }
        fs.writeFileSync(COMMANDER_PROFILE_PATH, content, 'utf-8');
        console.log('[DB] Commander Profile Memory updated.');
    } catch (e) {
        console.error('[DB] Error updating Commander Profile:', e.message);
    }
}

module.exports = {
    initDB,
    getPersona,
    getGroup,
    getAllPersonas,
    getAllGroups,
    upsertPersona,
    upsertGroup,
    getCommanderProfile,
    updateCommanderProfileMemory
};
