const fs = require('fs');
const path = require('path');
const { dumpUI, openWhatsAppWithExactSpec, sleep } = require('./adb_manager');
const ui = require('./ui_parser');
const db = require('./database');

const TASK_LIST_FILE = path.join(__dirname, 'task_list.json');

// In-memory task queue
let taskList = [];

// ─────────────────────────────────────────────
//  TASK LIST PERSISTENCE
// ─────────────────────────────────────────────

function loadTaskListFromFile() {
    if (fs.existsSync(TASK_LIST_FILE)) {
        try {
            taskList = JSON.parse(fs.readFileSync(TASK_LIST_FILE, 'utf-8'));
        } catch {
            taskList = [];
        }
    }
}

function saveTaskListToFile() {
    try {
        fs.writeFileSync(TASK_LIST_FILE, JSON.stringify(taskList, null, 2));
    } catch (e) {
        console.error('[Task Manager] Error saving task_list.json:', e.message);
    }
}

/**
 * Priority sort: higher priority first, then oldest timestamp first.
 */
function reindexTaskList() {
    taskList.sort((a, b) => {
        if (b.priority !== a.priority) return (b.priority || 0) - (a.priority || 0);
        return (a.timestamp || 0) - (b.timestamp || 0);
    });
    saveTaskListToFile();
}

// ─────────────────────────────────────────────
//  HOME SCREEN UI DUMP SCANNING (PRIMARY TASK GENERATOR)
// ─────────────────────────────────────────────

/**
 * Scans home screen UI dump and creates tasks for all visible chats.
 * Uses Sender-Prefix clue to distinguish Groups ("Sender: msg") vs Personas.
 * Counts unread badge bubble numbers.
 * NO ADB NOTIFICATIONS USED AT ALL.
 */
async function scanHomeUIDumpAndPopulateTasks() {
    try {
        const dumpPath = await dumpUI();
        if (!dumpPath) return;

        const chats = await ui.extractChatsFromHomeUIDump(dumpPath);
        let addedCount = 0;

        for (const chat of chats) {
            if (!chat.name) continue;

            if (!taskList.find(t => t.identifier === chat.name)) {
                taskList.push({
                    identifier: chat.name,
                    type: chat.type, // 'group' or 'persona' based on sender prefix clue
                    priority: chat.unreadCount > 0 ? (chat.unreadCount + 1) : 0,
                    unreadCount: chat.unreadCount,
                    timestamp: Date.now(),
                    source: 'home_ui_dump'
                });
                addedCount++;
                console.log(`[Task Manager] UI Scan task created → "${chat.name}" (${chat.type}) unread=${chat.unreadCount}`);

                // DB Pre-registration
                await preRegisterInDB(chat.name, chat.type === 'group');
            }
        }

        if (addedCount > 0) reindexTaskList();
    } catch (e) {
        console.error('[Task Manager] scanHomeUIDumpAndPopulateTasks error:', e.message);
    }
}

/**
 * Pre-registers contact/group in database immediately when detected.
 */
async function preRegisterInDB(identifier, isGroup) {
    try {
        if (isGroup) {
            const existing = await db.getGroup(identifier);
            if (!existing) {
                await db.upsertGroup({
                    group_name: identifier,
                    priority_number: 1,
                    members: [],
                    ai_thoughts: 'Auto-registered by Task Manager UI Scan.',
                    unread_notes_for_user: '',
                    seen_notes_for_user: '',
                    questions_to_user: '',
                    direction_of_communication: 'Detected via UI scan.',
                    user_rules: ''
                });
            }
        } else {
            const existing = await db.getPersona(identifier);
            if (!existing) {
                await db.upsertPersona({
                    name: identifier,
                    phone: '',
                    personal_details: 'Auto-registered contact.',
                    ai_thoughts: 'New contact detected via UI scan.',
                    unread_notes_for_user: '',
                    seen_notes_for_user: '',
                    questions_to_user: '',
                    direction_of_communication: 'Detected via UI scan.',
                    user_rules: ''
                });
            }
        }
    } catch (dbErr) {
        console.error('[Task Manager] DB pre-register error:', dbErr.message);
    }
}

// ─────────────────────────────────────────────
//  QUEUE MANAGEMENT & MANUAL INJECTION
// ─────────────────────────────────────────────

function startTaskEngine() {
    loadTaskListFromFile();
    console.log('[Task Manager] Pure UI Scan Task Engine active (Notification Listener DISABLED).');
}

function getFirstTask() {
    loadTaskListFromFile();
    if (taskList.length === 0) return null;
    const task = taskList.shift();
    saveTaskListToFile();
    return task;
}

function addTask(identifier, type = 'persona', priority = 0, instruction = '') {
    if (!taskList.find(t => t.identifier === identifier)) {
        taskList.push({
            identifier,
            type,
            priority,
            timestamp: Date.now(),
            source: 'manual',
            instruction: instruction || ''
        });
        reindexTaskList();
        console.log(`[Task Manager] Manual task added: "${identifier}" (${type}) priority=${priority}`);
    }
}

function getTaskList() {
    loadTaskListFromFile();
    return taskList;
}

module.exports = {
    startTaskEngine,
    scanHomeUIDumpAndPopulateTasks,
    getFirstTask,
    addTask,
    reindexTaskList,
    getTaskList,
    get taskList() { return taskList; }
};
