const db = require('./database');
const adb = require('./adb_manager');
const ui = require('./ui_parser');
const llm = require('./llm_api');
const taskManager = require('./task_manager');
const dashboardServer = require('./dashboard_server');

const RESTRICTED_CONTACTS = new Set(
    (process.env.RESTRICTED_CONTACTS || '')
        .split(',')
        .map(name => name.trim().toLowerCase())
        .filter(Boolean)
);

function isRestrictedContact(name) {
    return !!name && RESTRICTED_CONTACTS.has(String(name).trim().toLowerCase());
}

// ─────────────────────────────────────────────
//  COMMANDER TARGETED SEARCH FLOW
// ─────────────────────────────────────────────

/**
 * Handles a targeted task assigned by Commander (e.g. "Send message to John").
 * Taps (210, 200) -> (641, 97) -> enters search term -> waits 5s -> UI dumps.
 * Re-tries once after another 5s if needed.
 */
async function processCommanderTargetedTask(task) {
    console.log(`\n==================================================`);
    console.log(`[TARGETED TASK] Searching for: "${task.identifier}"`);
    console.log(`==================================================`);

    // 1. Verify screen state via UI dump
    let dumpPath = await adb.dumpUI();
    if (!dumpPath) {
        await adb.openWhatsAppWithExactSpec();
        dumpPath = await adb.dumpUI();
    }

    const lockState = await adb.findNodeCoords(dumpPath, ['message_text', 'entry']);
    if (lockState) {
        // Inside a chat thread -> gesture back to home
        console.log('[Targeted Task] Currently inside a chat thread. Doing gesture back...');
        await adb.gestureBack();
        await adb.sleep(500);
    }

    // 2. Open search bar: Tap x=210, y=200
    console.log('[Targeted Task] Tapping search bar icon at (210, 200)...');
    await adb.tap(210, 200);
    await adb.sleep(500);

    // 3. Focus search input: Tap x=641, y=97
    console.log('[Targeted Task] Tapping search input focus at (641, 97)...');
    await adb.tap(641, 97);
    await adb.sleep(500);

    // 4. Type search name
    console.log(`[Targeted Task] Typing search query: "${task.identifier}"...`);
    await adb.sendMessageWithFallbacks(task.identifier);

    // 5. Attempt 1: Wait 5 seconds and check UI dump
    console.log('[Targeted Task] Waiting 5 seconds for search results (Attempt 1)...');
    await adb.sleep(5000);
    dumpPath = await adb.dumpUI();

    let resultCoords = null;
    if (dumpPath) {
        resultCoords = await adb.findNodeCoords(dumpPath, [task.identifier.toLowerCase()]);
    }

    // 6. Attempt 2: If not found, wait another 5 seconds and check again
    if (!resultCoords) {
        console.log('[Targeted Task] Result not found yet. Waiting another 5 seconds (Attempt 2)...');
        await adb.sleep(5000);
        dumpPath = await adb.dumpUI();
        if (dumpPath) {
            resultCoords = await adb.findNodeCoords(dumpPath, [task.identifier.toLowerCase()]);
        }
    }

    // If result found -> tap it
    if (resultCoords) {
        console.log(`[Targeted Task] Search result found! Tapping at (${resultCoords.x}, ${resultCoords.y})...`);
        await adb.tap(resultCoords.x, resultCoords.y);
        await adb.sleep(2000);
        await executeChatProcessing(task, task.identifier);
    } else {
        console.warn(`[Targeted Task] Contact "${task.identifier}" not found after 2 attempts. Exiting search...`);
        await adb.gestureBack();
        await adb.sleep(500);
        await adb.gestureBack();
        await adb.sleep(500);
    }
}

// ─────────────────────────────────────────────
//  NORMAL CHAT PROCESSING & LLM REPLY
// ─────────────────────────────────────────────

async function executeChatProcessing(task, contactName) {
    const isGroup = task.type === 'group';
    let restrictedSkipped = false;

    // 1. Retrieve or initialize DB record
    let dbRecord;
    if (isGroup) {
        dbRecord = await db.getGroup(contactName);
        if (!dbRecord) {
            await db.upsertGroup({
                group_name: contactName,
                priority_number: task.priority || 0,
                members: [],
                ai_thoughts: 'Newly initialized group memory.',
                unread_notes_for_user: '',
                seen_notes_for_user: '',
                questions_to_user: '',
                direction_of_communication: 'Group chat opened.',
                user_rules: task.instruction ? `Commander instruction: ${task.instruction}` : ''
            });
            dbRecord = await db.getGroup(contactName);
        }
    } else {
        dbRecord = await db.getPersona(contactName);
        if (!dbRecord) {
            await db.upsertPersona({
                name: contactName,
                phone: '',
                personal_details: 'Auto-registered contact.',
                ai_thoughts: 'New contact memory.',
                unread_notes_for_user: '',
                seen_notes_for_user: '',
                questions_to_user: '',
                direction_of_communication: 'Chat opened.',
                user_rules: task.instruction ? `Commander instruction: ${task.instruction}` : ''
            });
            dbRecord = await db.getPersona(contactName);
        } else if (task.instruction) {
            dbRecord.user_rules = (dbRecord.user_rules || '') + `\n[Commander: ${task.instruction}]`;
        }
    }

    if (!dbRecord) {
        dbRecord = { name: contactName, group_name: contactName, ai_thoughts: '', direction_of_communication: '', user_rules: '' };
    }

    // 2. UI Dump inside chat
    let dumpPath = await adb.dumpUI();
    let unreadMessages = [];

    if (dumpPath) {
        const currentContactName = await ui.extractTopHeaderFromChatUIDump(dumpPath);
        if (isRestrictedContact(currentContactName) || isRestrictedContact(contactName)) {
            console.log(`[Restricted] Contact "${currentContactName || contactName}" is restricted. Skipping chat and backing out.`);
            await adb.gestureBack();
            await adb.sleep(500);
            restrictedSkipped = true;
            return;
        }

        unreadMessages = await ui.extractMessagesFromUIDump(dumpPath);
        if (unreadMessages.length > 20) {
            console.log(`[Extraction] Long conversation (${unreadMessages.length} msgs). Exporting chat file...`);
            const exportTxtPath = await adb.exportChatToFile();
            if (exportTxtPath) {
                unreadMessages = ui.parseExportedChatFile(exportTxtPath);
            }
        }
    }

    console.log(`[Extraction] Extracted ${unreadMessages.length} messages from "${contactName}".`);

    // 3. Process with LLM
    console.log('[LLM] Invoking Gemini API...');
    const llmResult = await llm.processMessagesWithLLM(dbRecord, unreadMessages, isGroup, task.instruction);
    console.log('[LLM Output]:', JSON.stringify(llmResult, null, 2));

    // 4. Update DB & Commander Knowledge
    if (llmResult.update_ai_thoughts) dbRecord.ai_thoughts = llmResult.new_ai_thoughts || dbRecord.ai_thoughts;
    if (llmResult.update_direction_of_communication) dbRecord.direction_of_communication = llmResult.new_direction_of_communication || dbRecord.direction_of_communication;
    if (llmResult.update_questions_to_user && llmResult.new_questions_to_user) {
        dbRecord.questions_to_user = (dbRecord.questions_to_user || '') + '\n' + llmResult.new_questions_to_user;
    }
    if (llmResult.update_unread_notes && llmResult.new_unread_notes) {
        dbRecord.unread_notes_for_user = (dbRecord.unread_notes_for_user || '') + '\n' + llmResult.new_unread_notes;
    }
    if (llmResult.update_user_rules && llmResult.new_user_rules) dbRecord.user_rules = llmResult.new_user_rules;

    if (llmResult.update_commander_knowledge && llmResult.new_commander_knowledge_memory) {
        db.updateCommanderProfileMemory(llmResult.new_commander_knowledge_memory);
    }

    if (isGroup) {
        await db.upsertGroup(dbRecord);
    } else {
        await db.upsertPersona(dbRecord);
    }

    // 5. Send reply if required
    if (llmResult.shouldReply && llmResult.replyMessage) {
        console.log(`[Reply] Sending reply to "${contactName}"...`);
        await adb.tap(400, 2100); // Focus text bar
        await adb.sleep(500);
        await adb.sendMessageWithFallbacks(llmResult.replyMessage);
        console.log('[Reply] Reply sent.');
    }

    return restrictedSkipped;
}

// ─────────────────────────────────────────────
//  MAIN WORK LOOP
// ─────────────────────────────────────────────

async function mainLoop() {
    while (true) {
        const task = taskManager.getFirstTask();

        if (task) {
            try {
                if (task.source === 'manual') {
                    // Manual Commander task -> targeted search flow
                    await processCommanderTargetedTask(task);
                } else {
                    // Normal UI scan task -> tap x=276, y=451 (first chat in list)
                    console.log(`\n==================================================`);
                    console.log(`[QUEUE] Processing Chat: "${task.identifier}"`);
                    console.log(`==================================================`);

                    // Wait 2 seconds
                    await adb.sleep(2000);

                    // Press x=276, y=451 to open first chat in list
                    console.log('[Queue] Pressing chat item at (276, 451)...');
                    await adb.tap(276, 451);

                    // Wait 1 second
                    await adb.sleep(1000);

                    // UI Dump & find contact header
                    const dumpPath = await adb.dumpUI();
                    let contactHeader = task.identifier;
                    if (dumpPath) {
                        contactHeader = await ui.extractTopHeaderFromChatUIDump(dumpPath) || task.identifier;
                    }

                    // Execute chat processing & LLM reply
                    const skippedRestricted = await executeChatProcessing(task, contactHeader);

                    if (!skippedRestricted) {
                        // Return to Home Screen & Refresh exact spec:
                        // gestureBack() -> wait 500ms -> tap(58, 343) -> wait 500ms -> tap(177, 340) -> wait 500ms
                        await adb.returnToHomeAndRefresh();

                        // Do UI dump to detect remaining chats
                        await taskManager.scanHomeUIDumpAndPopulateTasks();
                    } else {
                        console.log('[Queue] Restricted contact skipped; not refreshing home screen now.');
                    }
                }
            } catch (e) {
                console.error('[AGENT] Processing Error:', e.stack || e.message);
            }
        } else {
            // Idle: scan home screen for unread chats
            console.log('[AGENT] Queue empty — scanning home screen UI dump...');
            await adb.returnToHomeAndRefresh();
            await taskManager.scanHomeUIDumpAndPopulateTasks();
            await adb.sleep(5000);
        }
    }
}

// ─────────────────────────────────────────────
//  STARTUP
// ─────────────────────────────────────────────

async function start() {
    console.log('==================================================');
    console.log('       WhatsApp AI Automation Agent Active        ');
    console.log('==================================================');

    // 1. Initialize DB
    await db.initDB();
    console.log('[Setup] SQLite Database active.');

    // 2. Connect ADB
    const connected = await adb.connect();
    if (connected) {
        await adb.wakeAndUnlock();
    }

    // 3. Start Dashboard Server
    dashboardServer.startDashboardServer(taskManager);

    // 4. Start Task Engine (Notifications DISABLED)
    taskManager.startTaskEngine();

    // 5. Execute Exact Spec WhatsApp Launch & PIN Unlock
    await adb.openWhatsAppWithExactSpec();

    // 6. Scan Home UI dump to populate initial task list
    await taskManager.scanHomeUIDumpAndPopulateTasks();

    // 7. Start Main Processing Loop
    mainLoop();
}

start();
