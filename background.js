// background.js – Service Worker (MV3)

// ─── Constants ───────────────────────────────────────────────────────────────
const ALARM_NAME = 'supabase-token-refresh';
// Check every 10 minutes. The real threshold for refreshing is "5 minutes left on the token".
// Tokens last 1 hour, so in the worst case we check 6 times per hour but only actually
// call the API once (when the token is about to expire). This avoids unnecessary API calls
// while still catching tokens before they expire.
const REFRESH_INTERVAL_MINUTES = 10;

// ─── Startup: set up the alarm ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    setupAlarm();
    // Refresh immediately after install in case sessions exist
    refreshAllSessions();
});

chrome.runtime.onStartup.addListener(() => {
    setupAlarm();
    // CRITICAL: Refresh immediately on startup. If Chrome was closed for hours,
    // tokens may be expired. Don't wait for the 30-min alarm delay.
    console.log('[Supabase Switcher] Browser started — refreshing all sessions immediately.');
    refreshAllSessions();
});

function setupAlarm() {
    // Clear any existing alarm first to avoid duplicates
    chrome.alarms.clear(ALARM_NAME, () => {
        chrome.alarms.create(ALARM_NAME, {
            periodInMinutes: REFRESH_INTERVAL_MINUTES,
            delayInMinutes: REFRESH_INTERVAL_MINUTES,
        });
        console.log(`[Supabase Switcher] Token refresh alarm set every ${REFRESH_INTERVAL_MINUTES} min.`);
    });
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
    if (message.action === 'OPEN_LOGIN_TAB') {
        handleOpenLoginTab().then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'GET_PENDING_SESSION') {
        handleGetPendingSession().then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;
    }
    if (message.action === 'CLEAR_PENDING_SESSION') {
        chrome.storage.local.remove('pendingSession').then(() => sendResponse({ success: true }));
        return true;
    }
});

// ─── Login Tab Logic ──────────────────────────────────────────────────────────

/**
 * Opens a fresh Supabase login tab.
 * Clears all sb-* localStorage keys so the page shows the login form,
 * even if the user is currently logged in.
 */
async function handleOpenLoginTab() {
    // Mark that we're waiting for a new login
    await chrome.storage.local.set({ loginTabId: null, pendingSession: null });

    const tab = await chrome.tabs.create({ url: 'https://supabase.com/dashboard/sign-in' });
    await chrome.storage.local.set({ loginTabId: tab.id });
    return { success: true };
}

async function handleGetPendingSession() {
    const { pendingSession = null } = await chrome.storage.local.get('pendingSession');
    return { pendingSession };
}

// ─── Tab watcher: detect login completion ────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;

    const { loginTabId } = await chrome.storage.local.get('loginTabId');
    if (tabId !== loginTabId) return;

    const url = tab.url || '';

    // STEP 1: Tab just loaded on the sign-in page → clear localStorage so
    //         the page shows the login form instead of redirecting to dashboard.
    if (url.includes('/sign-in') || url.includes('/signin')) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && (key.startsWith('sb-') || key.toLowerCase().includes('supabase'))) {
                            keysToRemove.push(key);
                        }
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));
                    if (keysToRemove.length > 0) {
                        // Reload once to let Supabase render the login form cleanly
                        window.location.reload();
                    }
                }
            });
        } catch (e) {
            console.warn('[Supabase Switcher] Could not clear localStorage on login tab:', e.message);
        }
        return;
    }

    // STEP 2: Tab navigated away from sign-in to dashboard → login succeeded!
    if (url.includes('supabase.com/dashboard') && !url.includes('sign-in') && !url.includes('signin')) {
        console.log('[Supabase Switcher] Dashboard activity detected on tab', tabId);

        // Retry loop: Dashboard writes localStorage async, so we retry with delays.
        async function captureTokensWithRetry(retries = 5) {
            for (let attempt = 1; attempt <= retries; attempt++) {
                // Give the Dashboard time to write tokens (longer on first attempt)
                const delay = attempt === 1 ? 1200 : 800;
                await new Promise(r => setTimeout(r, delay));

                try {
                    const results = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            const tokens = {};
                            let userInfo = null;

                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                if (key && (key.startsWith('sb-') || key.toLowerCase().includes('supabase'))) {
                                    tokens[key] = localStorage.getItem(key);
                                }
                            }

                            // Extract userInfo only from real auth token keys
                            for (const key of Object.keys(tokens)) {
                                if (!key.endsWith('-auth-token') && key !== 'supabase.dashboard.auth.token') continue;
                                try {
                                    const parsed = JSON.parse(tokens[key]);
                                    if (parsed?.user?.email) {
                                        userInfo = { email: parsed.user.email, id: parsed.user.id };
                                        break;
                                    }
                                } catch { /* ignore */ }
                            }

                            return { tokens, userInfo };
                        }
                    });

                    const { tokens, userInfo } = results[0]?.result || {};

                    // Only return if we have an actual GoTrue auth token key
                    const hasRealAuthToken = Object.keys(tokens || {}).some(k =>
                        (k.startsWith('sb-') && k.endsWith('-auth-token')) ||
                        k === 'supabase.dashboard.auth.token'
                    );

                    if (hasRealAuthToken) {
                        console.log(`[Supabase Switcher] Auth token captured on attempt ${attempt}`);
                        return { tokens, userInfo };
                    }
                    console.warn(`[Supabase Switcher] Attempt ${attempt}: no auth token yet...`);
                } catch (e) {
                    console.warn(`[Supabase Switcher] Attempt ${attempt} failed:`, e.message);
                }
            }
            return null;
        }

        const captured = await captureTokensWithRetry();

        if (captured && Object.keys(captured.tokens).length > 0) {
            // Check if this session is already saved (optional? No, let user decide)

            // Store as a pending session for the popup to detect
            await chrome.storage.local.set({
                pendingSession: {
                    tokens: captured.tokens,
                    email: captured.userInfo?.email || '',
                    detectedAt: new Date().toISOString(),
                },
                loginTabId: null, // stop watching
            });
            console.log(`[Supabase Switcher] Pending session captured for: ${captured.userInfo?.email || 'unknown'}`);
        }
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
    if (sessions.length === 0) return { refreshed: 0, total: 0 };

    let refreshed = 0;
    const updatedSessions = [...sessions];

    for (let i = 0; i < updatedSessions.length; i++) {
        const session = updatedSessions[i];
        try {
            const result = await refreshSessionTokens(session);
            if (result) {
                updatedSessions[i] = { ...session, tokens: result.tokens, expired: false };
                refreshed++;
                console.log(`[Supabase Switcher] ✓ Refreshed tokens for: ${session.name}`);
            }
        } catch (e) {
            console.warn(`[Supabase Switcher] ✗ Failed to refresh "${session.name}":`, e.message);
            // If it's an auth error (401/400), the refresh token itself has expired
            if (e.message.includes('400') || e.message.includes('401') || e.message.includes('invalid_grant')) {
                updatedSessions[i] = { ...session, expired: true };
                console.warn(`[Supabase Switcher] Session "${session.name}" has an expired refresh token — user must re-login.`);
            }
        }
    }

    await chrome.storage.local.set({ sessions: updatedSessions });
    console.log(`[Supabase Switcher] Done. ${refreshed}/${sessions.length} sessions refreshed.`);
    return { refreshed, total: sessions.length };
}

/**
 * Refreshes tokens for a single session.
 *
 * Key insight from GoTrue/Supabase internals:
 * - Refresh Token Rotation: using a refresh_token invalidates it and returns a NEW one.
 *   We MUST save the new refresh_token or the next refresh will fail with 400 invalid_grant.
 * - The stored localStorage value must contain ALL original fields (user, token_type, etc.)
 *   We merge the new token data onto the old object to preserve everything.
 * - expires_at is a Unix timestamp (seconds). We check against it directly.
 */
async function refreshSessionTokens(session) {
    const { tokens } = session;
    const updatedTokens = { ...tokens };
    let anyRefreshed = false;

    // Identify all keys that look like auth tokens
    const authKeys = Object.keys(tokens).filter(k =>
        (k.startsWith('sb-') && k.endsWith('-auth-token')) ||
        k === 'supabase.dashboard.auth.token'
    );

    if (authKeys.length === 0) return null;

    for (const authKey of authKeys) {
        try {
            // 1. Identify refresh URL
            let refreshUrl = '';
            if (authKey === 'supabase.dashboard.auth.token') {
                refreshUrl = 'https://alt.supabase.io/auth/v1/token?grant_type=refresh_token';
            } else {
                const projectRef = authKey.match(/^sb-(.+)-auth-token$/)?.[1];
                if (!projectRef) continue;
                refreshUrl = `https://${projectRef}.supabase.co/auth/v1/token?grant_type=refresh_token`;
            }

            // 2. Parse current token data
            let tokenData;
            try {
                tokenData = JSON.parse(tokens[authKey]);
            } catch { continue; }

            const refreshToken = tokenData?.refresh_token;
            if (!refreshToken) continue;

            // 3. Check expiration (refresh if < 10 mins remaining for safety)
            const nowSec = Math.floor(Date.now() / 1000);
            const expiresAt = tokenData.expires_at || (nowSec + (tokenData.expires_in || 3600));
            const secsRemaining = expiresAt - nowSec;

            if (secsRemaining > 600) { // 10 minutes
                continue;
            }

            console.log(`[Supabase Switcher] Refreshing ${authKey} for "${session.name}"...`);

            // 4. Perform refresh
            const response = await fetch(refreshUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`HTTP ${response.status}: ${errBody}`);
            }

            const newTokenData = await response.json();

            // 5. Merge and Update
            const mergedData = {
                ...tokenData,
                ...newTokenData,
                expires_at: newTokenData.expires_at || (nowSec + (newTokenData.expires_in || 3600))
            };

            updatedTokens[authKey] = JSON.stringify(mergedData);
            anyRefreshed = true;

            // 6. Special sync for Dashboard User key
            if (authKey === 'supabase.dashboard.auth.token' && mergedData.user) {
                const userKey = 'supabase.dashboard.auth.token-user';
                if (updatedTokens[userKey]) {
                    updatedTokens[userKey] = JSON.stringify({ user: mergedData.user });
                }
            }
        } catch (e) {
            console.warn(`[Supabase Switcher] Failed to refresh ${authKey}:`, e.message);
            // Re-throw if it's a fatal auth error to mark session as expired
            if (e.message.includes('400') || e.message.includes('invalid_grant')) {
                throw e;
            }
        }
    }

    return anyRefreshed ? { tokens: updatedTokens } : null;
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
                if (key && (key.startsWith('sb-') || key.toLowerCase().includes('supabase'))) {
                    tokens[key] = localStorage.getItem(key);
                }
            }
            let userInfo = null;
            for (const key of Object.keys(tokens)) {
                try {
                    const parsed = JSON.parse(tokens[key]);
                    if (parsed) {
                        if (parsed.user) {
                            userInfo = { email: parsed.user.email, id: parsed.user.id };
                        } else if (parsed.email) {
                            userInfo = { email: parsed.email, id: parsed.id };
                        }
                    }
                    if (userInfo?.email) break;
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
