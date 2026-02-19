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
        console.log('[Supabase Switcher] New login detected on tab', tabId);
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
                    for (const key of Object.keys(tokens)) {
                        try {
                            const parsed = JSON.parse(tokens[key]);
                            if (parsed && parsed.user) {
                                userInfo = { email: parsed.user.email, id: parsed.user.id };
                                break;
                            }
                        } catch { /* ignore */ }
                    }
                    return { tokens, userInfo };
                }
            });

            const { tokens, userInfo } = results[0]?.result || {};

            if (tokens && Object.keys(tokens).length > 0) {
                // Store as a pending session for the popup to detect
                await chrome.storage.local.set({
                    pendingSession: {
                        tokens,
                        email: userInfo?.email || '',
                        detectedAt: new Date().toISOString(),
                    },
                    loginTabId: null, // stop watching
                });
                console.log(`[Supabase Switcher] Pending session captured for: ${userInfo?.email}`);
            }
        } catch (e) {
            console.warn('[Supabase Switcher] Failed to read tokens after login:', e.message);
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

    // Find the auth token key (sb-<project-ref>-auth-token)
    const authKey = Object.keys(tokens).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!authKey) {
        console.warn(`[Supabase Switcher] No sb-*-auth-token key found for "${session.name}"`);
        return null;
    }

    // Extract project ref: sb-<project-ref>-auth-token
    const match = authKey.match(/^sb-(.+)-auth-token$/);
    if (!match) return null;
    const projectRef = match[1];

    // Parse the stored token JSON
    let tokenData;
    try {
        tokenData = JSON.parse(tokens[authKey]);
    } catch {
        console.warn(`[Supabase Switcher] Could not parse token JSON for "${session.name}"`);
        return null;
    }

    const refreshToken = tokenData?.refresh_token;
    if (!refreshToken) {
        console.warn(`[Supabase Switcher] No refresh_token in "${session.name}"`);
        return null;
    }

    // --- Smarter threshold check ---
    // Use expires_at (Unix seconds) if available, otherwise estimate from expires_in
    const nowSec = Math.floor(Date.now() / 1000);
    let secsRemaining = null;

    if (tokenData.expires_at) {
        secsRemaining = tokenData.expires_at - nowSec;
    } else if (tokenData.expires_in) {
        // Fallback: treat as recently-issued — refresh if expires_in < threshold
        secsRemaining = tokenData.expires_in;
    }

    // Skip if more than 5 minutes remaining (more aggressive than before —
    // the real safety net is: if we're within 5 min, refresh no matter what)
    const REFRESH_THRESHOLD_SECS = 5 * 60; // 5 minutes
    if (secsRemaining !== null && secsRemaining > REFRESH_THRESHOLD_SECS) {
        console.log(`[Supabase Switcher] "${session.name}" still valid (${Math.round(secsRemaining / 60)} min left), skipping.`);
        return null;
    }

    // --- Call the GoTrue refresh endpoint ---
    const url = `https://${projectRef}.supabase.co/auth/v1/token?grant_type=refresh_token`;
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
    } catch (networkErr) {
        throw new Error(`Network error during refresh: ${networkErr.message}`);
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase refresh failed (${response.status}): ${body}`);
    }

    const newTokenData = await response.json();

    /**
     * CRITICAL: Merge strategy.
     * The GoTrue API returns the full session object, but we merge ONTO the previous
     * object to preserve any extra fields the Supabase dashboard stores (like provider_token,
     * user metadata, etc.). Fields from the new response always win.
     *
     * This also ensures the new refresh_token (from rotation) is correctly saved.
     */
    const mergedTokenData = {
        ...tokenData,       // preserve all original fields
        ...newTokenData,    // overwrite with fresh fields (access_token, refresh_token, expires_at, etc.)
        // Also update expires_at explicitly in case the API returns only expires_in
        expires_at: newTokenData.expires_at || (nowSec + (newTokenData.expires_in || 3600)),
    };

    // Rebuild the tokens map
    const updatedTokens = { ...tokens };
    updatedTokens[authKey] = JSON.stringify(mergedTokenData);

    console.log(`[Supabase Switcher] ✓ "${session.name}" token refreshed. New refresh_token saved. Expires in ${Math.round((mergedTokenData.expires_at - nowSec) / 60)} min.`);
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
