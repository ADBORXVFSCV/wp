const axios = require('axios');
const db = require('./database');
require('dotenv').config();

// Extract and sanitize Gemini API Key
let rawKey = process.env.GEMINI_API_KEY || '';
if (rawKey.includes('AIzaSy')) {
    const match = rawKey.match(/AIzaSy[A-Za-z0-9_-]+/);
    if (match) rawKey = match[0];
}
const GEMINI_API_KEY = rawKey;
const GEMINI_MODEL = 'gemini-flash-latest';
const FALLBACK_SERVER_URL = (process.env.FALLBACK_SERVER_URL || 'https://roberts-entertaining-settled-fragrances.trycloudflare.com').replace(/\/+$/, '');
const FALLBACK_TIMEOUT_MS = 180000;

function getStopAIResult() {
    return {
        shouldReply: false,
        replyMessage: '',
        update_ai_thoughts: false,
        new_ai_thoughts: '',
        update_direction_of_communication: false,
        new_direction_of_communication: '',
        update_questions_to_user: false,
        new_questions_to_user: '',
        update_unread_notes: false,
        new_unread_notes: '',
        update_user_rules: false,
        new_user_rules: '',
        update_commander_knowledge: false,
        new_commander_knowledge_memory: '',
        new_group_members: [],
        inject_tasks: []
    };
}

function getStopCommanderResponse() {
    return {
        agentReply: '',
        inject_tasks: []
    };
}

async function queryFallbackAI(message) {
    const url = `${FALLBACK_SERVER_URL}/chat`;
    const response = await axios.post(url, { message }, { timeout: FALLBACK_TIMEOUT_MS });
    const data = response?.data;
    if (data == null) {
        throw new Error('Fallback server returned no data');
    }
    if (typeof data === 'string') {
        return data;
    }
    if (data.response !== undefined) {
        return data.response;
    }
    return data;
}

// ─────────────────────────────────────────────
//  MAIN CHAT PROCESSING
// ─────────────────────────────────────────────

/**
 * Processes unread messages from a chat with full context, database memory,
 * and an optional Commander instruction override.
 */
async function processMessagesWithLLM(personaOrGroup, unreadMessages, isGroup = false, commanderInstruction = '') {
    const commanderProfile = db.getCommanderProfile();

    if (!GEMINI_API_KEY || !GEMINI_API_KEY.startsWith('AIzaSy')) {
        console.warn('[LLM API] No valid GEMINI_API_KEY. Falling back to external AI server.');
        try {
            const fallbackText = await queryFallbackAI(prompt);
            return {
                shouldReply: true,
                replyMessage: String(fallbackText),
                update_ai_thoughts: false,
                new_ai_thoughts: '',
                update_direction_of_communication: false,
                new_direction_of_communication: '',
                update_questions_to_user: false,
                new_questions_to_user: '',
                update_unread_notes: false,
                new_unread_notes: '',
                update_user_rules: false,
                new_user_rules: '',
                update_commander_knowledge: false,
                new_commander_knowledge_memory: '',
                new_group_members: [],
                inject_tasks: []
            };
        } catch (fallbackError) {
            console.error('[LLM API] Fallback AI Error:', fallbackError.message);
            return getStopAIResult();
        }
    }

    const instructionBlock = commanderInstruction
        ? `\n==================================================\nCOMMANDER SPECIAL INSTRUCTION FOR THIS TASK\n==================================================\n${commanderInstruction}\n(You MUST prioritize this instruction above normal behavior)\n`
        : '';

    const prompt = `
You are the primary WhatsApp AI proxy assistant representing the Commander (the account owner).

==================================================
COMMANDER & AGENT SYSTEM PROFILE (KNOWLEDGE BASE)
==================================================
${commanderProfile}
${instructionBlock}
==================================================
CURRENT CHAT DATABASE MEMORY (${isGroup ? 'GROUP' : 'PERSONA'})
==================================================
${JSON.stringify(personaOrGroup, null, 2)}

==================================================
RECENT UNREAD MESSAGES FROM THIS CHAT
==================================================
${JSON.stringify(unreadMessages, null, 2)}

CRITICAL INSTRUCTIONS:
1. Analyze all previous memories, current chat direction, and incoming unread messages.
2. Provide explicit BOOLEAN FLAGS for every column update decision.
3. "direction_of_communication" MUST be a single vivid sentence describing the real-time context.
4. "questions_to_user" — urgent clarifying questions the Commander must answer.
5. "new_commander_knowledge_memory" — any new fundamental fact/preference about Commander.
6. In group chats, use @Name to address specific members.
7. Sound human and realistic — NOT like a generic AI bot.
8. If the Commander gave a special instruction, execute it precisely.

OUTPUT: Respond with ONLY the following strict JSON object. No markdown fences, no extra text.

{
    "shouldReply": boolean,
    "replyMessage": "Text to send. Use @Name for group members.",

    "update_ai_thoughts": boolean,
    "new_ai_thoughts": "Updated long-term context/facts about this chat",

    "update_direction_of_communication": boolean,
    "new_direction_of_communication": "One sentence describing the real-time state of this conversation.",

    "update_questions_to_user": boolean,
    "new_questions_to_user": "Urgent question for the Commander to answer.",

    "update_unread_notes": boolean,
    "new_unread_notes": "Important notes/alerts for the Commander about this contact.",

    "update_user_rules": boolean,
    "new_user_rules": "Updated standing instructions for replying to this contact.",

    "update_commander_knowledge": boolean,
    "new_commander_knowledge_memory": "New fact/memory to save into commander_profile.txt",

    "new_group_members": ["Array of newly detected member names in this chat"],

    "inject_tasks": [
        {
            "identifier": "Contact or group name to handle next",
            "type": "persona or group",
            "priority": 2,
            "instruction": "What the agent should do in that chat"
        }
    ]
}
`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.2
                }
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        const textResponse = response.data.candidates[0].content.parts[0].text;
        const cleaned = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('[LLM API] Gemini Error:', error.response ? JSON.stringify(error.response.data) : error.message);
        try {
            const fallbackText = await queryFallbackAI(prompt);
            return {
                shouldReply: true,
                replyMessage: String(fallbackText),
                update_ai_thoughts: false,
                new_ai_thoughts: '',
                update_direction_of_communication: false,
                new_direction_of_communication: '',
                update_questions_to_user: false,
                new_questions_to_user: '',
                update_unread_notes: false,
                new_unread_notes: '',
                update_user_rules: false,
                new_user_rules: '',
                update_commander_knowledge: false,
                new_commander_knowledge_memory: '',
                new_group_members: [],
                inject_tasks: []
            };
        } catch (fallbackError) {
            console.error('[LLM API] Fallback AI Error:', fallbackError.message);
            return getStopAIResult();
        }
    }
}

// ─────────────────────────────────────────────
//  COMMANDER ↔ AGENT CHAT
// ─────────────────────────────────────────────

/**
 * Processes a Commander chat message and returns an AI response.
 * AI can also inject tasks into the queue by returning "inject_tasks" in JSON.
 */
async function processCommanderChatMessage(commanderMessage, chatHistory = []) {
    const commanderProfile = db.getCommanderProfile();
    const personas = await db.getAllPersonas();
    const groups = await db.getAllGroups();

    if (!GEMINI_API_KEY || !GEMINI_API_KEY.startsWith('AIzaSy')) {
        try {
            const fallbackText = await queryFallbackAI(commanderMessage);
            return {
                agentReply: String(fallbackText),
                inject_tasks: []
            };
        } catch (fallbackError) {
            console.error('[LLM API] Fallback AI Error:', fallbackError.message);
            return getStopCommanderResponse();
        }
    }

    const historyText = chatHistory.length > 0
        ? chatHistory.map(h => `${h.role === 'commander' ? 'Commander' : 'Agent'}: ${h.text}`).join('\n')
        : '(No previous conversation)';

    const prompt = `
You are the WhatsApp AI Agent speaking directly with your Commander (the human account owner).
You are intelligent, loyal, and highly capable. You manage WhatsApp conversations autonomously.

==================================================
COMMANDER & AGENT PROFILE
==================================================
${commanderProfile}

==================================================
KNOWN CONTACTS (PERSONAS)
==================================================
${JSON.stringify(personas.map(p => ({ name: p.name, phone: p.phone, direction: p.direction_of_communication })), null, 2)}

==================================================
KNOWN GROUPS
==================================================
${JSON.stringify(groups.map(g => ({ name: g.group_name, direction: g.direction_of_communication })), null, 2)}

==================================================
COMMANDER CHAT HISTORY
==================================================
${historyText}

Commander: ${commanderMessage}

INSTRUCTIONS:
1. Respond naturally and helpfully as the Agent.
2. If the Commander is asking you to perform an action on a contact or group (e.g. "Ask John about the payment", "Teach this group about topic X", "Message Sarah with..."), extract and include it in inject_tasks.
3. inject_tasks is an array of tasks to add to your work queue. Each has: identifier, type (persona/group), priority (1-5, 5=urgent), instruction.
4. Keep your agentReply conversational and confirm any tasks you've understood.

Respond with ONLY this strict JSON:
{
    "agentReply": "Your conversational response to the Commander",
    "inject_tasks": [
        {
            "identifier": "Contact or group name",
            "type": "persona or group",
            "priority": 2,
            "instruction": "What to do in that chat"
        }
    ]
}
`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.4
                }
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        const textResponse = response.data.candidates[0].content.parts[0].text;
        const cleaned = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('[LLM API] Gemini Commander Chat Error:', error.response ? JSON.stringify(error.response.data) : error.message);
        try {
            const fallbackText = await queryFallbackAI(commanderMessage);
            return {
                agentReply: String(fallbackText),
                inject_tasks: []
            };
        } catch (fallbackError) {
            console.error('[LLM API] Fallback AI Error:', fallbackError.message);
            return getStopCommanderResponse();
        }
    }
}

// ─────────────────────────────────────────────
//  MOCK RESPONSE
// ─────────────────────────────────────────────

function mockLLMResponse(personaOrGroup, unreadMessages, isGroup) {
    return {
        shouldReply: true,
        replyMessage: isGroup
            ? 'Hello @Everyone, I have received the updates for our group.'
            : 'Understood! I will check with the Commander and get back to you shortly.',
        update_ai_thoughts: true,
        new_ai_thoughts: (personaOrGroup.ai_thoughts || '') + ' | Memory updated at ' + new Date().toLocaleTimeString(),
        update_direction_of_communication: true,
        new_direction_of_communication: 'Coordinating details and awaiting Commander feedback.',
        update_questions_to_user: true,
        new_questions_to_user: `Should we confirm the proposed time for ${personaOrGroup.name || personaOrGroup.group_name}?`,
        update_unread_notes: true,
        new_unread_notes: `Received ${unreadMessages.length || 1} new message(s).`,
        update_user_rules: false,
        new_user_rules: personaOrGroup.user_rules || '',
        update_commander_knowledge: false,
        new_commander_knowledge_memory: '',
        new_group_members: isGroup ? [] : [],
        inject_tasks: []
    };
}

module.exports = {
    processMessagesWithLLM,
    processCommanderChatMessage
};
