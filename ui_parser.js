const fs = require('fs');
const xml2js = require('xml2js');

async function parseUIDump(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const xml = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xml);
        return result;
    } catch (e) {
        console.error('[UI Parser] XML parsing error:', e.message);
        return null;
    }
}

function extractNodes(node, filterFn, results = []) {
    if (!node) return results;
    if (filterFn(node)) {
        results.push(node);
    }
    if (node.node) {
        node.node.forEach(child => extractNodes(child, filterFn, results));
    }
    return results;
}

/**
 * Parses main screen UI dump to extract all chats by name, type (person vs group using sender prefix clue),
 * and unread badge message count.
 *
 * User Clue Rule:
 * - If last message preview text has "Sender: message" format (contains a colon before message), it is a GROUP.
 * - Otherwise it is a PERSONA.
 */
async function extractChatsFromHomeUIDump(filePath) {
    const parsed = await parseUIDump(filePath);
    if (!parsed) return [];

    const root = parsed.hierarchy;
    const extractedChats = [];

    // Extract all contact/group name nodes
    const nameNodes = extractNodes(root, n => {
        const resId = (n.$ && n.$['resource-id']) ? n.$['resource-id'] : '';
        return resId.includes('conversations_row_contact_name') ||
            resId.includes('contact_name') ||
            resId.includes('conversation_name');
    });

    // Extract all last message preview nodes
    const previewNodes = extractNodes(root, n => {
        const resId = (n.$ && n.$['resource-id']) ? n.$['resource-id'] : '';
        return resId.includes('conversations_row_snippet') ||
            resId.includes('single_msg_tv') ||
            resId.includes('snippet');
    });

    // Extract all unread badge nodes
    const badgeNodes = extractNodes(root, n => {
        const resId = (n.$ && n.$['resource-id']) ? n.$['resource-id'] : '';
        return resId.includes('unread_badge') ||
            resId.includes('counter') ||
            resId.includes('badge');
    });

    nameNodes.forEach((nameNode, idx) => {
        const name = (nameNode.$ && nameNode.$.text) ? nameNode.$.text.trim() : '';
        if (!name) return;

        // Get matching preview node if available
        const previewNode = previewNodes[idx];
        const previewText = (previewNode && previewNode.$ && previewNode.$.text) ? previewNode.$.text.trim() : '';

        // Determine if Group or Persona based on sender prefix clue ("Sender: message")
        let isGroup = false;
        if (previewText && previewText.includes(':')) {
            const parts = previewText.split(':');
            if (parts[0].trim().length > 0 && parts[1].trim().length > 0) {
                isGroup = true;
            }
        }

        // Determine unread count from badge node
        let unreadCount = 0;
        const badgeNode = badgeNodes[idx];
        if (badgeNode && badgeNode.$ && badgeNode.$.text) {
            const parsedCount = parseInt(badgeNode.$.text.trim());
            if (!isNaN(parsedCount)) unreadCount = parsedCount;
        }

        extractedChats.push({
            name,
            type: isGroup ? 'group' : 'persona',
            lastMessagePreview: previewText,
            unreadCount,
            bounds: nameNode.$.bounds || ''
        });
    });

    return extractedChats;
}

/**
 * Extracts top header name (contact name, group name, or phone number) when inside a chat thread.
 */
async function extractTopHeaderFromChatUIDump(filePath) {
    const parsed = await parseUIDump(filePath);
    if (!parsed) return 'Unknown';

    const root = parsed.hierarchy;
    const headerNodes = extractNodes(root, n => {
        const resId = (n.$ && n.$['resource-id']) ? n.$['resource-id'] : '';
        return resId.includes('conversation_contact_name') ||
            resId.includes('action_bar_title') ||
            resId.includes('name');
    });

    for (const h of headerNodes) {
        if (h.$ && h.$.text && h.$.text.trim()) {
            return h.$.text.trim();
        }
    }
    return 'Unknown';
}

/**
 * Checks if the "scroll to recent message" bottom-right button/icon is visible.
 */
async function hasScrollToBottomIcon(filePath) {
    const parsed = await parseUIDump(filePath);
    if (!parsed) return false;

    const root = parsed.hierarchy;
    const scrollButtons = extractNodes(root, n => {
        const resId = (n.$ && n.$['resource-id']) ? n.$['resource-id'] : '';
        const contentDesc = (n.$ && n.$['content-desc']) ? n.$['content-desc'] : '';
        return resId.includes('scroll_to_bottom') ||
            contentDesc.toLowerCase().includes('scroll to recent') ||
            contentDesc.toLowerCase().includes('unread messages');
    });

    return scrollButtons.length > 0;
}

/**
 * Extracts messages from current chat conversation UI dump.
 */
async function extractMessagesFromUIDump(filePath) {
    const parsed = await parseUIDump(filePath);
    if (!parsed) return [];

    const root = parsed.hierarchy;
    const messages = [];

    const textNodes = extractNodes(root, n => {
        const resId = (n.$ && n.$['resource-id']) ? n.$['resource-id'] : '';
        return resId.includes('message_text') || resId.includes('entry') || resId.includes('conversation_text');
    });

    textNodes.forEach(n => {
        if (n.$ && n.$.text) {
            let sender = "Unknown";
            if (n.$.text.includes(':')) {
                const parts = n.$.text.split(':');
                sender = parts[0].trim();
            }

            messages.push({
                sender: sender,
                text: n.$.text,
                bounds: n.$.bounds || ""
            });
        }
    });

    return messages;
}

/**
 * Filters an exported chat text file by removing old messages.
 */
function parseExportedChatFile(txtPath, cutoffDateString = "") {
    if (!fs.existsSync(txtPath)) return [];

    const rawContent = fs.readFileSync(txtPath, 'utf-8');
    const lines = rawContent.split(/\r?\n/);
    const unreadMessages = [];

    lines.forEach(line => {
        if (!line.trim()) return;

        const match = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4},\s\d{1,2}:\d{2}\s?[AP]M)\s-\s([^:]+):\s(.+)$/i);
        if (match) {
            const timestamp = match[1];
            const sender = match[2].trim();
            const messageText = match[3].trim();

            unreadMessages.push({
                timestamp,
                sender,
                text: messageText
            });
        }
    });

    return unreadMessages;
}

module.exports = {
    parseUIDump,
    extractChatsFromHomeUIDump,
    extractTopHeaderFromChatUIDump,
    hasScrollToBottomIcon,
    extractMessagesFromUIDump,
    parseExportedChatFile
};
