const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const execPromise = util.promisify(exec);
const DEFAULT_EXEC_OPTIONS = { maxBuffer: 20 * 1024 * 1024 }; // 20 MB
require('dotenv').config();

const IP = process.env.PHONE_IP || '192.168.1.100:5555';
const WA_PKG = 'com.whatsapp.w4b'; // WhatsApp Business package

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
//  ADB CONNECTION & BASIC INPUT
// ─────────────────────────────────────────────

async function connect() {
    console.log(`[ADB] Connecting to Samsung A03s at ${IP}...`);
    try {
        const { stdout } = await execPromise(`adb connect ${IP}`);
        console.log('[ADB]', stdout.trim());
        return stdout.includes('connected');
    } catch (e) {
        console.error('[ADB] Connect Error:', e.message);
        return false;
    }
}

async function tap(x, y) {
    await execPromise(`adb -s ${IP} shell input tap ${x} ${y}`);
}

async function swipe(x1, y1, x2, y2, durationMs = 300) {
    await execPromise(`adb -s ${IP} shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
}

/**
 * Gesture back navigation: simulates side swipe from screen edge or KEYCODE_BACK (keyevent 4).
 */
async function gestureBack() {
    console.log('[ADB] Executing Gesture Back (side swipe / keyevent 4)...');
    try {
        // Swipe from left edge (x=10, y=1000) to (x=400, y=1000)
        await swipe(10, 1000, 400, 1000, 200);
        await sleep(900);
    } catch {
        await execPromise(`adb -s ${IP} shell input keyevent 4`);
    }
}

async function wakeAndUnlock() {
    try {
        console.log('[ADB] Waking screen and unlocking with PIN (2222)...');
        await execPromise(`adb -s ${IP} shell input keyevent 26`); // KEYCODE_POWER
        await sleep(1000);

        // Swipe up to reveal lock screen
        await swipe(300, 1200, 300, 300, 300);
        await sleep(1000);

        const pin = process.env.PHONE_PIN || '2222';
        await execPromise(`adb -s ${IP} shell input text ${pin}`);
        await sleep(400);
        await execPromise(`adb -s ${IP} shell input keyevent 66`); // Enter
        await sleep(1500);
        console.log('[ADB] Phone screen unlocked.');
    } catch (e) {
        console.error('[ADB] Unlock error:', e.message);
    }
}

// ─────────────────────────────────────────────
//  EXACT WHATSAPP OPEN & PIN UNLOCK FLOW
// ─────────────────────────────────────────────

/**
 * Exact user specification:
 * 1. Open WhatsApp Business.
 * 2. Touch x=370, y=1411 for "Use PIN" button.
 * 3. Wait 500ms.
 * 4. Press 6 times at x=380, y=1093 with 100ms delay between each (enters PIN 222222).
 * 5. Wait 1000ms (1 second).
 * 6. Open WhatsApp Business again and wait 2000ms (bypasses Samsung A03s crash bug).
 * 7. Fast scroll down from x=390, y=620 to x=390, y=1385.
 * 8. Wait 200ms.
 * 9. Press x=178, y=346 (selects Chats tab).
 */
async function openWhatsAppWithExactSpec() {
    console.log('[ADB] Executing Exact Spec WhatsApp Launch & PIN Unlock...');

    try {
        // Step 1: Open WhatsApp Business
        await execPromise(`adb -s ${IP} shell monkey -p ${WA_PKG} -c android.intent.category.LAUNCHER 1`);
        await sleep(2500);

        // Step 2: Touch x=370, y=1411 for "Use PIN" button
        console.log('[ADB] Tapping "Use PIN" button at (370, 1411)...');
        await tap(370, 1411);

        // Step 3: Wait 500ms
        await sleep(500);

        // Step 4: Press 6 times at x=380, y=1093 with 100ms delay between each
        console.log('[ADB] Pressing PIN key 6 times at (380, 1093)...');
        for (let i = 0; i < 6; i++) {
            await tap(380, 1093);
            await sleep(100);
        }

        // Step 5: Wait 1000ms
        await sleep(1000);

        // Step 6: Open WhatsApp Business again and wait 2000ms
        console.log('[ADB] Re-opening WhatsApp Business (bypassing crash bug)...');
        await execPromise(`adb -s ${IP} shell monkey -p ${WA_PKG} -c android.intent.category.LAUNCHER 1`);
        await sleep(2000);

        // Step 7: Fast scroll down from x=390, y=620 to x=390, y=1385
        console.log('[ADB] Fast scrolling down from (390, 620) to (390, 1385)...');
        await swipe(390, 620, 390, 1385, 200);

        // Step 8: Wait 200ms
        await sleep(200);

        // Step 9: Press x=178, y=346
        console.log('[ADB] Tapping Chats tab at (178, 346)...');
        await tap(178, 346);
        await sleep(1000);

        console.log('[ADB] WhatsApp Opened & Initialized according to Exact Spec.');
    } catch (e) {
        console.error('[ADB] openWhatsAppWithExactSpec error:', e.message);
    }
}

/**
 * Exact user specification for returning to home screen & refreshing:
 * 1. Gesture back (side swipe or keyevent 4)
 * 2. Wait 500ms
 * 3. Press x=58, y=343
 * 4. Wait 500ms
 * 5. Press x=177, y=340
 * 6. Wait 500ms
 */
async function returnToHomeAndRefresh() {
    console.log('[ADB] Navigating back to home screen and refreshing chats tab...');
    await gestureBack();

    await sleep(900);
    await tap(58, 343);
    await sleep(900);
    await tap(177, 340);
    await sleep(900);
}

// ─────────────────────────────────────────────
//  UI DUMP
// ─────────────────────────────────────────────

async function dumpUI() {
    try {
        console.log('[ADB] Dumping UI XML from device over Wi-Fi...');
        await execPromise(`adb -s ${IP} shell uiautomator dump /sdcard/window_dump.xml`);
        const localPath = path.join(__dirname, 'window_dump.xml');
        await execPromise(`adb -s ${IP} pull /sdcard/window_dump.xml "${localPath}"`);
        return localPath;
    } catch (e) {
        console.error('[ADB] UI Dump error:', e.message);
        return null;
    }
}

/**
 * Finds center coordinates of a UI node matching given keywords.
 */
async function findNodeCoords(dumpPath, keywords) {
    try {
        const xml = fs.readFileSync(dumpPath, 'utf-8');
        const parser = new xml2js.Parser();
        const parsed = await parser.parseStringPromise(xml);
        const found = findNodeByText(parsed.hierarchy, keywords);
        if (found && found.$.bounds) {
            return parseBoundsCenter(found.$.bounds);
        }
    } catch (e) {
        console.error('[ADB] findNodeCoords error:', e.message);
    }
    return null;
}

function findNodeByText(node, keywords) {
    if (!node) return null;
    const text = (node.$ && node.$.text || '').toLowerCase();
    const desc = (node.$ && node.$['content-desc'] || '').toLowerCase();
    for (const kw of keywords) {
        if (text.includes(kw) || desc.includes(kw)) return node;
    }
    if (node.node) {
        for (const child of node.node) {
            const result = findNodeByText(child, keywords);
            if (result) return result;
        }
    }
    return null;
}

function parseBoundsCenter(boundsStr) {
    const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!match) return null;
    return {
        x: Math.floor((parseInt(match[1]) + parseInt(match[3])) / 2),
        y: Math.floor((parseInt(match[2]) + parseInt(match[4])) / 2)
    };
}

// ─────────────────────────────────────────────
//  MESSAGE SENDING WITH FALLBACKS
// ─────────────────────────────────────────────

async function sendMessageWithFallbacks(text) {
    console.log(`[ADB] Sending message: "${text}"`);
    await sleep(900);

    // Method 1: Direct input text
    try {
        const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/ /g, '%s');
        await execPromise(`adb -s ${IP} shell input text "${escapedText}"`);
        await sleep(900);
        await execPromise(`adb -s ${IP} shell input keyevent 66`); // Enter / Send
        await tap(980, 2150); // Typical send button
        console.log('[ADB] Sent message via Direct Input.');
        return true;
    } catch (err1) {
        console.warn('[ADB] Direct input failed, trying Clipboard...', err1.message);
    }

    // Method 2: Copy-Paste Clipboard
    try {
        await execPromise(`adb -s ${IP} shell am broadcast -a cli.clipper.set -e text "${text}"`);
        await tap(500, 2100);
        await sleep(900);
        await execPromise(`adb -s ${IP} shell input keyevent 279`); // KEYCODE_PASTE
        await sleep(900);
        await tap(980, 2150);
        console.log('[ADB] Sent message via Clipboard.');
        return true;
    } catch (err2) {
        console.warn('[ADB] Clipboard failed, trying Keyevents...', err2.message);
    }

    // Method 3: Keyevents char-by-char
    try {
        for (const char of text) {
            if (char === ' ') {
                await execPromise(`adb -s ${IP} shell input keyevent 62`);
            } else {
                await execPromise(`adb -s ${IP} shell input text "${char}"`);
            }
            await sleep(80);
        }
        await sleep(900);
        await tap(980, 2150);
        console.log('[ADB] Sent message via Keyevents.');
        return true;
    } catch (err3) {
        console.error('[ADB] All send methods failed!', err3.message);
        return false;
    }
}

// ─────────────────────────────────────────────
//  CHAT EXPORT
// ─────────────────────────────────────────────

async function exportChatToFile() {
    console.log('[ADB] Triggering Chat Export...');
    try {
        await tap(980, 150);
        await sleep(1000);
        await tap(800, 1100);
        await sleep(1000);
        await tap(800, 600);
        await sleep(1500);
        await tap(500, 1400);
        await sleep(2500);

        const remoteTxt = '/sdcard/Download/WhatsApp_Chat_Export.txt';
        const localTxt = path.join(__dirname, 'exported_chat.txt');
        await execPromise(`adb -s ${IP} pull ${remoteTxt} "${localTxt}"`).catch(() => {});

        if (fs.existsSync(localTxt)) {
            return localTxt;
        }
    } catch (e) {
        console.error('[ADB] Chat Export failed:', e.message);
    }
    return null;
}

module.exports = {
    connect,
    wakeAndUnlock,
    openWhatsAppWithExactSpec,
    returnToHomeAndRefresh,
    gestureBack,
    dumpUI,
    tap,
    swipe,
    sendMessageWithFallbacks,
    exportChatToFile,
    findNodeCoords,
    parseBoundsCenter,
    sleep
};
