const express = require('express');
const path = require('path');
const db = require('./database');
const llm = require('./llm_api');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory chat history for Commander ↔ Agent session
let commanderChatHistory = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
//  DATA ENDPOINTS
// ─────────────────────────────────────────────

// GET /api/data — Full dashboard data
app.get('/api/data', async (req, res) => {
    try {
        const personas = await db.getAllPersonas();
        const groups = await db.getAllGroups();
        const commanderProfile = db.getCommanderProfile();

        const pendingQuestions = [];
        personas.forEach(p => {
            if (p.questions_to_user && p.questions_to_user.trim()) {
                pendingQuestions.push({ id: p.id, type: 'persona', name: p.name, question: p.questions_to_user });
            }
        });
        groups.forEach(g => {
            if (g.questions_to_user && g.questions_to_user.trim()) {
                pendingQuestions.push({ id: g.id, type: 'group', name: g.group_name, question: g.questions_to_user });
            }
        });

        res.json({ personas, groups, commanderProfile, pendingQuestions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/tasks — Current task queue
app.get('/api/tasks', (req, res) => {
    try {
        const taskManager = app.get('taskManager');
        res.json({ tasks: taskManager ? taskManager.getTaskList() : [] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────
//  PERSONA / GROUP CRUD
// ─────────────────────────────────────────────

// POST /api/persona/update
app.post('/api/persona/update', async (req, res) => {
    try {
        await db.upsertPersona(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/group/update
app.post('/api/group/update', async (req, res) => {
    try {
        await db.upsertGroup(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────
//  COMMANDER ANSWERS
// ─────────────────────────────────────────────

// POST /api/commander/answer — Answer a pending question
app.post('/api/commander/answer', async (req, res) => {
    try {
        const { id, type, answer } = req.body;
        if (type === 'persona') {
            const persona = await db.getPersona(id);
            if (persona) {
                const questionText = persona.questions_to_user;
                persona.seen_notes_for_user = (persona.seen_notes_for_user || '') + `\n[Q: ${questionText} | A: ${answer}]`;
                persona.user_rules = (persona.user_rules || '') + `\n[Commander Answer: ${answer}]`;
                persona.questions_to_user = '';
                await db.upsertPersona(persona);
            }
        } else {
            const group = await db.getGroup(id);
            if (group) {
                const questionText = group.questions_to_user;
                group.seen_notes_for_user = (group.seen_notes_for_user || '') + `\n[Q: ${questionText} | A: ${answer}]`;
                group.user_rules = (group.user_rules || '') + `\n[Commander Answer: ${answer}]`;
                group.questions_to_user = '';
                await db.upsertGroup(group);
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/commander/profile — Save Commander Profile text
app.post('/api/commander/profile', (req, res) => {
    try {
        const fs = require('fs');
        const { content } = req.body;
        fs.writeFileSync(path.join(__dirname, 'commander_profile.txt'), content, 'utf-8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────
//  COMMANDER ↔ AGENT REAL-TIME CHAT
// ─────────────────────────────────────────────

// GET /api/chat/history — Load existing chat history
app.get('/api/chat/history', (req, res) => {
    res.json({ history: commanderChatHistory });
});

/**
 * POST /api/chat — Commander sends a message to the Agent.
 * Agent replies intelligently and can inject tasks into the task queue.
 */
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required.' });
        }

        // Store Commander message in history
        commanderChatHistory.push({ role: 'commander', text: message, timestamp: Date.now() });

        // Process via LLM
        const llmResult = await llm.processCommanderChatMessage(message, commanderChatHistory.slice(-20));

        const agentReply = llmResult.agentReply || 'Understood, Commander.';
        const injectedTasks = llmResult.inject_tasks || [];

        // Store Agent reply in history
        commanderChatHistory.push({ role: 'agent', text: agentReply, timestamp: Date.now() });

        // Inject any tasks the Agent identified from the Commander's message
        const taskManager = app.get('taskManager');
        const addedTasks = [];
        if (taskManager && injectedTasks.length > 0) {
            for (const t of injectedTasks) {
                if (t.identifier && t.type) {
                    taskManager.addTask(t.identifier, t.type, t.priority || 2, t.instruction || '');
                    addedTasks.push(t);
                    console.log(`[Dashboard Chat] Commander assigned task: "${t.identifier}" — ${t.instruction}`);
                }
            }
        }

        res.json({
            agentReply,
            inject_tasks: addedTasks
        });
    } catch (e) {
        console.error('[Dashboard Chat] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/chat/clear — Clear chat history
app.post('/api/chat/clear', (req, res) => {
    commanderChatHistory = [];
    res.json({ success: true });
});

// ─────────────────────────────────────────────
//  MANUAL TASK INJECTION
// ─────────────────────────────────────────────

// POST /api/task/add — Manually add a task from the dashboard
app.post('/api/task/add', (req, res) => {
    try {
        const { identifier, type, priority, instruction } = req.body;
        if (!identifier || !type) {
            return res.status(400).json({ error: 'identifier and type are required.' });
        }
        const taskManager = app.get('taskManager');
        if (taskManager) {
            taskManager.addTask(identifier, type, priority || 1, instruction || '');
            res.json({ success: true });
        } else {
            res.status(503).json({ error: 'Task manager not initialized.' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────
//  SERVER START
// ─────────────────────────────────────────────

function startDashboardServer(taskManager) {
    // Store taskManager reference so route handlers can access it
    app.set('taskManager', taskManager);

    app.listen(PORT, () => {
        console.log(`[Dashboard] Commander Dashboard running at http://localhost:${PORT}`);
    });
}

module.exports = { startDashboardServer };
