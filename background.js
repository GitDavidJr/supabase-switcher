// background.js – Service Worker (MV3)

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SAVE_SESSION') {
    handleSaveSession(message.data).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true; // async response
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
});

// Get the currently active Supabase tab
async function getActiveSupabaseTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.url || !tab.url.includes('supabase.com')) {
    throw new Error('Nenhuma aba do Supabase encontrada. Abra o dashboard do Supabase primeiro.');
  }
  return tab;
}

// Read localStorage tokens from the active Supabase tab
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
      // Also grab user info from the first token we find
      let userInfo = null;
      for (const key of Object.keys(tokens)) {
        try {
          const parsed = JSON.parse(tokens[key]);
          if (parsed && parsed.user) {
            userInfo = {
              email: parsed.user.email,
              id: parsed.user.id,
            };
            break;
          }
        } catch (e) { /* ignore */ }
      }
      return { tokens, userInfo };
    }
  });
  return results[0]?.result || { tokens: {}, userInfo: null };
}

// Save session
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

// Switch to a saved session
async function handleSwitchSession(data) {
  const tab = await getActiveSupabaseTab();
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const session = sessions.find(s => s.id === data.id);

  if (!session) {
    throw new Error('Sessão não encontrada.');
  }

  // Inject tokens into localStorage and reload
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (tokens) => {
      // Clear existing supabase tokens
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // Write new tokens
      for (const [key, value] of Object.entries(tokens)) {
        localStorage.setItem(key, value);
      }
      window.location.href = 'https://supabase.com/dashboard';
    },
    args: [session.tokens]
  });

  // Mark this session as active
  await chrome.storage.local.set({ activeSessionId: session.id });
  return { success: true };
}

// Get all sessions
async function handleGetSessions() {
  const { sessions = [], activeSessionId = null } = await chrome.storage.local.get(['sessions', 'activeSessionId']);
  return { sessions, activeSessionId };
}

// Delete a session
async function handleDeleteSession(data) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const updated = sessions.filter(s => s.id !== data.id);
  await chrome.storage.local.set({ sessions: updated });
  return { success: true };
}

// Rename a session
async function handleRenameSession(data) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const updated = sessions.map(s => s.id === data.id ? { ...s, name: data.name } : s);
  await chrome.storage.local.set({ sessions: updated });
  return { success: true };
}

function getRandomColor() {
  const colors = [
    '#3ECF8E', '#F472B6', '#60A5FA', '#FBBF24', '#A78BFA',
    '#34D399', '#F87171', '#38BDF8', '#FB923C', '#818CF8'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
