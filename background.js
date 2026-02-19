// background.js – Service Worker (MV3)

// ─── Constants ───────────────────────────────────────────────────────────────
const ALARM_NAME = 'supabase-token-refresh';
const REFRESH_INTERVAL_MINUTES = 45; // Refresh before the 1h expiry

// ─── Startup: set up the alarm ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(setupAlarm);

function setupAlarm() {
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: REFRESH_INTERVAL_MINUTES,
        delayInMinutes: REFRESH_INTERVAL_MINUTES,
    });
    console.log(`[Supabase Switcher] Token refresh alarm set every ${REFRESH_INTERVAL_MINUTES} min.`);
}

// ─── Alarm handler ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log('[Supabase Switcher] Running scheduled token refresh...');
        await refreshAllSessions();
    }
});

// ─── Message handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SAVE_SESSION') {
        handleSaveSession(message.data).then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'SWITCH_SESSION') {
        handleSwitchSession(message.data).then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'GET_SESSIONS') {
        handleGetSessions().then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'DELETE_SESSION') {
        handleDeleteSession(message.data).then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'RENAME_SESSION') {
        handleRenameSession(message.data).then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'FORCE_REFRESH') {
        refreshAllSessions().then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
});

// ─── Token Refresh Logic ──────────────────────────────────────────────────────

/**
 * Iterates all saved sessions and refreshes their tokens via the Supabase REST API.
 * The localStorage key format is `sb-<project-ref>-auth-token`, so we extract
 * the project-ref and call: POST https://<project-ref>.supabase.co/auth/v1/token?grant_type=refresh_token
 */
async function refreshAllSessions() {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    if (sessions.length === 0) return { refreshed: 0 };

    let refreshed = 0;
    const updatedSessions = [...sessions];

    for (let i = 0; i < updatedSessions.length; i++) {
        const session = updatedSessions[i];
        try {
            const result = await refreshSessionTokens(session);
            if (result) {
                updatedSessions[i] = { ...session, tokens: result.tokens };
                refreshed++;
                console.log(`[Supabase Switcher] Refreshed tokens for: ${session.name}`);
            }
        } catch (e) {
            console.warn(`[Supabase Switcher] Failed to refresh "${session.name}":`, e.message);
        }
    }

    await chrome.storage.local.set({ sessions: updatedSessions });
    console.log(`[Supabase Switcher] Done. ${refreshed}/${sessions.length} sessions refreshed.`);
    return { refreshed, total: sessions.length };
}

/**
 * Refreshes tokens for a single session.
 * Returns { tokens } with updated localStorage-ready token map, or null on failure.
 */
async function refreshSessionTokens(session) {
    const { tokens } = session;

    // Find the auth token key (sb-<project-ref>-auth-token)
    const authKey = Object.keys(tokens).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!authKey) {
        console.warn(`[Supabase Switcher] No sb-*-auth-token key found for "${session.name}"`);
        return null;
    }

    // Extract project ref from the key: sb-<project-ref>-auth-token
    // e.g. "sb-abcdefghijklmno-auth-token" → "abcdefghijklmno"
    const match = authKey.match(/^sb-(.+)-auth-token$/);
    if (!match) return null;
    const projectRef = match[1];

    // Parse the stored token JSON
    let tokenData;
    try {
        tokenData = JSON.parse(tokens[authKey]);
    } catch {
        return null;
    }

    const refreshToken = tokenData?.refresh_token;
    if (!refreshToken) {
        console.warn(`[Supabase Switcher] No refresh_token in session "${session.name}"`);
        return null;
    }

    // Check if still fresh (don't refresh if more than 20 min left)
    const expiresAt = tokenData?.expires_at;
    if (expiresAt) {
        const nowSec = Math.floor(Date.now() / 1000);
        const secsRemaining = expiresAt - nowSec;
        if (secsRemaining > 20 * 60) {
            console.log(`[Supabase Switcher] "${session.name}" still fresh (${Math.round(secsRemaining / 60)} min left), skipping.`);
            return null;
        }
    }

    // Call Supabase auth refresh endpoint
    const url = `https://${projectRef}.supabase.co/auth/v1/token?grant_type=refresh_token`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase refresh failed (${response.status}): ${body}`);
    }

    const newTokenData = await response.json();

    // Rebuild the tokens map with updated auth token
    const updatedTokens = { ...tokens };
    updatedTokens[authKey] = JSON.stringify(newTokenData);

    return { tokens: updatedTokens };
}

// ─── Active tab: get the Supabase tab ────────────────────────────────────────
async function getActiveSupabaseTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes('supabase.com')) {
        throw new Error('Nenhuma aba do Supabase encontrada. Abra o dashboard do Supabase primeiro.');
    }
    return tab;
}

// ─── Read localStorage tokens from the active tab ───────────────────────────
async function readTokensFromTab(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const tokens = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                    tokens[key] = localStorage.getItem(key);
                }
            }
            let userInfo = null;
            for (const key of Object.keys(tokens)) {
                try {
                    const parsed = JSON.parse(tokens[key]);
                    if (parsed && parsed.user) {
                        userInfo = { email: parsed.user.email, id: parsed.user.id };
                        break;
                    }
                } catch (e) { /* ignore */ }
            }
            return { tokens, userInfo };
        }
    });
    return results[0]?.result || { tokens: {}, userInfo: null };
}

// ─── Save session ─────────────────────────────────────────────────────────────
async function handleSaveSession(data) {
    const tab = await getActiveSupabaseTab();
    const { tokens, userInfo } = await readTokensFromTab(tab.id);

    if (Object.keys(tokens).length === 0) {
        throw new Error('Nenhuma sessão ativa encontrada. Faça login no Supabase primeiro.');
    }

    const { sessions = [] } = await chrome.storage.local.get('sessions');
    const id = `session_${Date.now()}`;
    const newSession = {
        id,
        name: data.name || userInfo?.email || 'Conta sem nome',
        email: userInfo?.email || '',
        color: data.color || getRandomColor(),
        tokens,
        savedAt: new Date().toISOString(),
    };

    sessions.push(newSession);
    await chrome.storage.local.set({ sessions });
    return { success: true, session: newSession };
}

// ─── Switch to a saved session ────────────────────────────────────────────────
async function handleSwitchSession(data) {
    const tab = await getActiveSupabaseTab();
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    const session = sessions.find(s => s.id === data.id);

    if (!session) throw new Error('Sessão não encontrada.');

    // Before switching, try to refresh the tokens for this session
    try {
        const refreshed = await refreshSessionTokens(session);
        if (refreshed) {
            // Update stored session with fresh tokens
            const updatedSessions = sessions.map(s =>
                s.id === session.id ? { ...s, tokens: refreshed.tokens } : s
            );
            await chrome.storage.local.set({ sessions: updatedSessions });
            session.tokens = refreshed.tokens;
            console.log(`[Supabase Switcher] Tokens refreshed before switching to "${session.name}"`);
        }
    } catch (e) {
        // Proceed even if refresh fails — might still be valid
        console.warn(`[Supabase Switcher] Pre-switch refresh failed: ${e.message}`);
    }

    // Inject tokens into localStorage and navigate
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (tokens) => {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            for (const [key, value] of Object.entries(tokens)) {
                localStorage.setItem(key, value);
            }
            window.location.href = 'https://supabase.com/dashboard/organizations';
        },
        args: [session.tokens]
    });

    await chrome.storage.local.set({ activeSessionId: session.id });
    return { success: true };
}

// ─── Get all sessions ────────────────────────────────────────────────────────
async function handleGetSessions() {
    const { sessions = [], activeSessionId = null } = await chrome.storage.local.get(['sessions', 'activeSessionId']);
    return { sessions, activeSessionId };
}

// ─── Delete a session ────────────────────────────────────────────────────────
async function handleDeleteSession(data) {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    const updated = sessions.filter(s => s.id !== data.id);
    await chrome.storage.local.set({ sessions: updated });
    return { success: true };
}

// ─── Rename a session ────────────────────────────────────────────────────────
async function handleRenameSession(data) {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    const updated = sessions.map(s => s.id === data.id ? { ...s, name: data.name } : s);
    await chrome.storage.local.set({ sessions: updated });
    return { success: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getRandomColor() {
    const colors = [
        '#3ECF8E', '#F472B6', '#60A5FA', '#FBBF24', '#A78BFA',
        '#34D399', '#F87171', '#38BDF8', '#FB923C', '#818CF8'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}
