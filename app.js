/* ─────────────────────────────────────────────
   WhatsApp AI Commander Dashboard — App Logic
───────────────────────────────────────────── */

// ── State ──────────────────────────────────────
let state = {
    personas: [],
    groups: [],
    pendingQuestions: [],
    chatHistory: [],
    taskList: []
};

// ── Init ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadDashboardData();
    loadChatHistory();
    initChatInput();
    initTaskInject();
    initProfile();
    initModal();
    initRefreshTasks();

    // Auto-refresh dashboard data every 10s
    setInterval(loadDashboardData, 10000);
    setInterval(refreshTaskQueue, 8000);
});

// ─────────────────────────────────────────────
//  TAB NAVIGATION
// ─────────────────────────────────────────────

function initTabs() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(target).classList.add('active');

            if (target === 'tasks-tab') refreshTaskQueue();
        });
    });
}

// ─────────────────────────────────────────────
//  DASHBOARD DATA LOAD
// ─────────────────────────────────────────────

async function loadDashboardData() {
    try {
        const res = await fetch('/api/data');
        const data = await res.json();

        state.personas = data.personas || [];
        state.groups = data.groups || [];
        state.pendingQuestions = data.pendingQuestions || [];

        renderPersonas();
        renderGroups();
        renderPendingQuestions();
        renderProfile(data.commanderProfile);

        // Update badge counts
        document.getElementById('personas-count').textContent = state.personas.length;
        document.getElementById('groups-count').textContent = state.groups.length;
        document.getElementById('questions-count').textContent = state.pendingQuestions.length;
    } catch (e) {
        console.error('Dashboard data load error:', e);
    }
}

// ─────────────────────────────────────────────
//  RENDER CONTACTS (PERSONAS)
// ─────────────────────────────────────────────

function renderPersonas() {
    const container = document.getElementById('personas-list');
    if (state.personas.length === 0) {
        container.innerHTML = '<p class="empty-state">No contacts yet — they appear automatically when WhatsApp messages arrive.</p>';
        return;
    }
    container.innerHTML = state.personas.map(p => personaCard(p)).join('');
    container.querySelectorAll('.edit-record-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal('persona', btn.dataset.id));
    });
}

function personaCard(p) {
    const hasUnread = p.unread_notes_for_user && p.unread_notes_for_user.trim();
    const hasQuestion = p.questions_to_user && p.questions_to_user.trim();
    const initial = (p.name || '?').charAt(0).toUpperCase();
    return `
    <div class="record-card">
        <div class="record-card-top">
            <div class="record-avatar">${initial}</div>
            <div>
                <div class="record-name">${escHtml(p.name)}</div>
                <div class="record-phone">${escHtml(p.phone || 'No phone')}</div>
            </div>
        </div>
        ${p.direction_of_communication ? `<div class="record-direction">${escHtml(p.direction_of_communication)}</div>` : ''}
        <div class="record-badges">
            ${hasUnread ? '<span class="badge-pill unread">📩 Unread Notes</span>' : ''}
            ${hasQuestion ? '<span class="badge-pill question">❓ Question</span>' : ''}
        </div>
        <div class="record-actions">
            <button class="btn-primary small edit-record-btn" data-id="${p.id}">✏️ Edit</button>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  RENDER GROUPS
// ─────────────────────────────────────────────

function renderGroups() {
    const container = document.getElementById('groups-list');
    if (state.groups.length === 0) {
        container.innerHTML = '<p class="empty-state">No groups yet — they appear automatically when WhatsApp group messages arrive.</p>';
        return;
    }
    container.innerHTML = state.groups.map(g => groupCard(g)).join('');
    container.querySelectorAll('.edit-record-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal('group', btn.dataset.id));
    });
}

function groupCard(g) {
    const hasUnread = g.unread_notes_for_user && g.unread_notes_for_user.trim();
    const hasQuestion = g.questions_to_user && g.questions_to_user.trim();
    return `
    <div class="record-card">
        <div class="record-card-top">
            <div class="record-avatar">👥</div>
            <div>
                <div class="record-name">${escHtml(g.group_name)}</div>
                <div class="record-phone">Priority: ${g.priority_number || 0}</div>
            </div>
        </div>
        ${g.direction_of_communication ? `<div class="record-direction">${escHtml(g.direction_of_communication)}</div>` : ''}
        <div class="record-badges">
            <span class="badge-pill group">👥 Group</span>
            ${hasUnread ? '<span class="badge-pill unread">📩 Unread Notes</span>' : ''}
            ${hasQuestion ? '<span class="badge-pill question">❓ Question</span>' : ''}
        </div>
        <div class="record-actions">
            <button class="btn-primary small edit-record-btn" data-id="${g.id}">✏️ Edit</button>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  PENDING QUESTIONS IN SIDEBAR
// ─────────────────────────────────────────────

function renderPendingQuestions() {
    const container = document.getElementById('questions-list');
    if (state.pendingQuestions.length === 0) {
        container.innerHTML = '<p class="empty-state">No pending questions</p>';
        return;
    }
    container.innerHTML = state.pendingQuestions.map(q => `
        <div class="question-card" id="qcard-${q.id}-${q.type}">
            <div class="q-from">❓ ${escHtml(q.name)} (${q.type})</div>
            <div class="q-text">${escHtml(q.question)}</div>
            <input type="text" id="q-answer-${q.id}-${q.type}" placeholder="Your answer..." />
            <button onclick="submitAnswer('${q.id}', '${q.type}')">Answer ✓</button>
        </div>
    `).join('');
}

async function submitAnswer(id, type) {
    const input = document.getElementById(`q-answer-${id}-${type}`);
    const answer = input ? input.value.trim() : '';
    if (!answer) { showToast('Please type an answer first.'); return; }

    try {
        await fetch('/api/commander/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: parseInt(id), type, answer })
        });
        showToast('✅ Answer submitted!');
        loadDashboardData();
    } catch (e) {
        showToast('Error submitting answer.');
    }
}

// ─────────────────────────────────────────────
//  TASK QUEUE
// ─────────────────────────────────────────────

async function refreshTaskQueue() {
    try {
        const res = await fetch('/api/tasks');
        const data = await res.json();
        state.taskList = data.tasks || [];
        renderTaskList();
    } catch (e) {
        console.error('Task queue load error:', e);
    }
}

function renderTaskList() {
    const container = document.getElementById('tasks-list');
    if (state.taskList.length === 0) {
        container.innerHTML = '<p class="empty-state">Task queue is empty — the agent is idle.</p>';
        return;
    }
    container.innerHTML = state.taskList.map((t, i) => `
        <div class="task-item">
            <div class="task-priority">${t.priority || 1}</div>
            <div class="task-info">
                <div class="task-identifier">${escHtml(t.identifier)}</div>
                <div class="task-meta">${t.type === 'group' ? '👥 Group' : '👤 Contact'} · ${t.source || 'auto'} · ${timeAgo(t.timestamp)}</div>
                ${t.instruction ? `<div class="task-instruction">📋 ${escHtml(t.instruction)}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function initRefreshTasks() {
    document.getElementById('refresh-tasks-btn').addEventListener('click', refreshTaskQueue);
}

// ─────────────────────────────────────────────
//  COMMANDER ↔ AGENT CHAT
// ─────────────────────────────────────────────

async function loadChatHistory() {
    try {
        const res = await fetch('/api/chat/history');
        const data = await res.json();
        state.chatHistory = data.history || [];
        // Clear default message if there's real history
        if (state.chatHistory.length > 0) {
            document.getElementById('chat-messages').innerHTML = '';
            state.chatHistory.forEach(msg => appendMessage(msg.role, msg.text, msg.timestamp));
        }
    } catch (e) {
        console.error('Chat history load error:', e);
    }
}

function initChatInput() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const clearBtn = document.getElementById('clear-chat-btn');

    sendBtn.addEventListener('click', sendChatMessage);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    clearBtn.addEventListener('click', async () => {
        await fetch('/api/chat/clear', { method: 'POST' });
        document.getElementById('chat-messages').innerHTML = '';
        state.chatHistory = [];
        showToast('Chat cleared.');
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    appendMessage('commander', message, Date.now());

    // Show typing indicator
    const typingEl = showTypingIndicator();

    // Update agent status
    setAgentStatus('Thinking...');

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        const data = await res.json();

        removeTypingIndicator(typingEl);
        setAgentStatus('Ready');

        if (data.agentReply) {
            appendMessage('agent', data.agentReply, Date.now());
        }

        // Show task injection confirmation if any tasks were added
        if (data.inject_tasks && data.inject_tasks.length > 0) {
            const taskNames = data.inject_tasks.map(t => `"${t.identifier}"`).join(', ');
            appendMessage('system', `✅ Tasks added to queue: ${taskNames}`, Date.now());
            refreshTaskQueue();
        }
    } catch (e) {
        removeTypingIndicator(typingEl);
        setAgentStatus('Error');
        appendMessage('agent', '⚠️ Connection error — please try again.', Date.now());
    }
}

function appendMessage(role, text, timestamp) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `msg ${role}`;

    const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    div.innerHTML = `
        <div class="msg-bubble">${escHtml(text).replace(/\n/g, '<br/>')}</div>
        <div class="msg-time">${role === 'commander' ? 'You' : role === 'system' ? 'System' : 'Agent'} · ${time}</div>
    `;

    if (role === 'system') {
        div.querySelector('.msg-bubble').style.cssText = 'background: rgba(37,211,102,0.08); border: 1px solid rgba(37,211,102,0.25); color: #25d366; font-size: 0.8rem;';
        div.style.alignSelf = 'center';
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'msg agent typing-indicator';
    div.innerHTML = `<div class="msg-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function removeTypingIndicator(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function setAgentStatus(text) {
    const el = document.getElementById('agent-status');
    if (el) el.textContent = text;
}

// ─────────────────────────────────────────────
//  TASK INJECTION FROM SIDEBAR
// ─────────────────────────────────────────────

function initTaskInject() {
    document.getElementById('inject-task-btn').addEventListener('click', async () => {
        const identifier = document.getElementById('inject-identifier').value.trim();
        const type = document.getElementById('inject-type').value;
        const priority = parseInt(document.getElementById('inject-priority').value) || 2;
        const instruction = document.getElementById('inject-instruction').value.trim();

        if (!identifier) { showToast('Please enter a contact or group name.'); return; }

        try {
            const res = await fetch('/api/task/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, type, priority, instruction })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`✅ Task added: "${identifier}"`);
                document.getElementById('inject-identifier').value = '';
                document.getElementById('inject-instruction').value = '';
                refreshTaskQueue();
            }
        } catch (e) {
            showToast('Error adding task.');
        }
    });
}

// ─────────────────────────────────────────────
//  PROFILE EDITOR
// ─────────────────────────────────────────────

function renderProfile(content) {
    const ta = document.getElementById('profile-textarea');
    if (ta && !ta.dataset.userEditing) {
        ta.value = content || '';
    }
}

function initProfile() {
    const ta = document.getElementById('profile-textarea');
    ta.addEventListener('focus', () => { ta.dataset.userEditing = '1'; });
    ta.addEventListener('blur', () => { delete ta.dataset.userEditing; });

    document.getElementById('save-profile-btn').addEventListener('click', async () => {
        const content = ta.value;
        try {
            await fetch('/api/commander/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const status = document.getElementById('profile-save-status');
            status.textContent = '✅ Saved!';
            setTimeout(() => { status.textContent = ''; }, 3000);
        } catch (e) {
            showToast('Error saving profile.');
        }
    });
}

// ─────────────────────────────────────────────
//  EDIT MODAL
// ─────────────────────────────────────────────

let currentEditRecord = null;

function initModal() {
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('cancel-edit-btn').addEventListener('click', closeModal);
    document.getElementById('edit-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('edit-modal')) closeModal();
    });
    document.getElementById('edit-form').addEventListener('submit', saveEditRecord);
}

async function openEditModal(type, id) {
    let record;
    if (type === 'persona') {
        record = state.personas.find(p => p.id == id);
    } else {
        record = state.groups.find(g => g.id == id);
    }
    if (!record) return;

    currentEditRecord = { ...record, _type: type };

    document.getElementById('modal-title').textContent = type === 'persona' ? `Edit Contact: ${record.name}` : `Edit Group: ${record.group_name}`;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-type').value = type;
    document.getElementById('edit-name').value = type === 'persona' ? (record.name || '') : (record.group_name || '');
    document.getElementById('edit-phone').value = record.phone || '';
    document.getElementById('edit-personal-details').value = record.personal_details || '';
    document.getElementById('edit-ai-thoughts').value = record.ai_thoughts || '';
    document.getElementById('edit-unread-notes').value = record.unread_notes_for_user || '';
    document.getElementById('edit-seen-notes').value = record.seen_notes_for_user || '';
    document.getElementById('edit-questions').value = record.questions_to_user || '';
    document.getElementById('edit-direction').value = record.direction_of_communication || '';
    document.getElementById('edit-user-rules').value = record.user_rules || '';

    // Show/hide phone field for groups
    document.getElementById('edit-phone').closest('.form-group').style.display = type === 'group' ? 'none' : '';

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    currentEditRecord = null;
}

async function saveEditRecord(e) {
    e.preventDefault();
    const type = document.getElementById('edit-type').value;
    const id = document.getElementById('edit-id').value;

    const payload = {
        id: parseInt(id),
        phone: document.getElementById('edit-phone').value,
        personal_details: document.getElementById('edit-personal-details').value,
        ai_thoughts: document.getElementById('edit-ai-thoughts').value,
        unread_notes_for_user: document.getElementById('edit-unread-notes').value,
        seen_notes_for_user: document.getElementById('edit-seen-notes').value,
        questions_to_user: document.getElementById('edit-questions').value,
        direction_of_communication: document.getElementById('edit-direction').value,
        user_rules: document.getElementById('edit-user-rules').value
    };

    if (type === 'persona') {
        payload.name = currentEditRecord.name;
    } else {
        payload.group_name = currentEditRecord.group_name;
        payload.priority_number = currentEditRecord.priority_number || 0;
        payload.members = currentEditRecord.members || [];
    }

    try {
        const endpoint = type === 'persona' ? '/api/persona/update' : '/api/group/update';
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast('✅ Saved successfully!');
        closeModal();
        loadDashboardData();
    } catch (e) {
        showToast('Error saving record.');
    }
}

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────

function showToast(msg, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function timeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}
