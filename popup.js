// popup.js — Supabase Account Switcher

const COLORS = [
    '#3ECF8E', '#F472B6', '#60A5FA', '#FBBF24', '#A78BFA',
    '#34D399', '#F87171', '#38BDF8', '#FB923C', '#818CF8'
];

let sessions = [];
let activeSessionId = null;
let selectedColor = COLORS[0];
let deletingId = null;

// DOM refs
const sessionsList = document.getElementById('sessions-list');
const emptyState = document.getElementById('empty-state');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const modalOverlay = document.getElementById('modal-overlay');
const modalEmail = document.getElementById('modal-email');
const accountNameInput = document.getElementById('account-name');
const colorPicker = document.getElementById('color-picker');
const deleteModalOverlay = document.getElementById('delete-modal-overlay');
const deleteAccountName = document.getElementById('delete-account-name');

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    buildColorPicker();
    await loadSessions();

    document.getElementById('btn-add').addEventListener('click', openSaveModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-save-confirm').addEventListener('click', confirmSave);
    document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);
    document.getElementById('btn-delete-confirm').addEventListener('click', confirmDelete);
    document.getElementById('btn-refresh-all').addEventListener('click', forceRefreshAll);
    document.getElementById('btn-export').addEventListener('click', exportSessions);
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', importSessions);

    accountNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmSave();
    });
});

// ─── Load sessions ───────────────────────────────────────────────────────────
async function loadSessions() {
    const res = await sendMessage({ action: 'GET_SESSIONS' });
    if (res.error) { showStatus(res.error, 'error'); return; }
    sessions = res.sessions || [];
    activeSessionId = res.activeSessionId || null;
    renderSessions();
}

// ─── Render ──────────────────────────────────────────────────────────────────
function renderSessions() {
    sessionsList.innerHTML = '';
    if (sessions.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    sessions.forEach(session => {
        const li = document.createElement('li');
        const isActive = session.id === activeSessionId;
        const isExpired = session.expired === true;

        li.className = 'session-item' + (isActive ? ' active' : '') + (isExpired ? ' expired' : '');
        li.title = isExpired
            ? '⚠️ Sessão expirada — faça login novamente no Supabase e salve outra vez'
            : `Trocar para: ${session.name}`;

        const initials = getInitials(session.name);

        li.innerHTML = `
      <div class="session-avatar" style="background: ${isExpired ? '#555' : session.color}">${initials}</div>
      <div class="session-info">
        <div class="session-name">${escHtml(session.name)}</div>
        ${session.email ? `<div class="session-email">${escHtml(session.email)}</div>` : ''}
      </div>
      ${isExpired ? '<span class="expired-badge">⚠ Expirada</span>' : (isActive ? '<span class="active-badge">Ativa</span>' : '')}
      <div class="session-actions">
        <button class="btn-icon danger" data-id="${session.id}" data-action="delete" title="Remover">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      </div>
    `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('[data-action]')) return;
            if (isExpired) {
                showStatus('⚠ Sessão expirada. Faça login no Supabase e salve novamente.', 'error');
                setTimeout(clearStatus, 4000);
                return;
            }
            switchSession(session.id);
        });

        li.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
            e.stopPropagation();
            openDeleteModal(session.id, session.name);
        });

        sessionsList.appendChild(li);
    });
}


// ─── Switch session ───────────────────────────────────────────────────────────
async function switchSession(id) {
    showStatus('<span class="spinner"></span>Trocando de conta...', 'info');

    const res = await sendMessage({ action: 'SWITCH_SESSION', data: { id } });
    if (res.error) {
        showStatus(res.error, 'error');
        return;
    }
    activeSessionId = id;
    renderSessions();
    showStatus('✓ Conta trocada com sucesso!', 'success');
    setTimeout(clearStatus, 2500);
}

// ─── Save modal ───────────────────────────────────────────────────────────────
let pendingUserInfo = null;

async function openSaveModal() {
    // Try to read current session info for pre-filling
    showStatus('<span class="spinner"></span>Lendo sessão atual...', 'info');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url?.includes('supabase.com')) {
            clearStatus();
            showStatus('Abra o Supabase em uma aba para salvar.', 'error');
            return;
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key?.startsWith('sb-')) {
                        try {
                            const parsed = JSON.parse(localStorage.getItem(key));
                            if (parsed?.user?.email) return { email: parsed.user.email };
                        } catch { }
                    }
                }
                return null;
            }
        });

        pendingUserInfo = results?.[0]?.result;
        clearStatus();
    } catch (e) {
        clearStatus();
    }

    // Pre-fill fields
    accountNameInput.value = '';
    selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    updateColorSelection();

    if (pendingUserInfo?.email) {
        modalEmail.textContent = `Sessão detectada: ${pendingUserInfo.email}`;
        accountNameInput.placeholder = 'Ex: Cliente A, Empresa XYZ...';
    } else {
        modalEmail.textContent = 'Certifique-se de estar logado no Supabase.';
    }

    modalOverlay.classList.remove('hidden');
    setTimeout(() => accountNameInput.focus(), 100);
}

function closeModal() {
    modalOverlay.classList.add('hidden');
    pendingUserInfo = null;
}

async function confirmSave() {
    const name = accountNameInput.value.trim();
    if (!name) { accountNameInput.focus(); accountNameInput.classList.add('shake'); setTimeout(() => accountNameInput.classList.remove('shake'), 400); return; }

    const btn = document.getElementById('btn-save-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Salvando...';

    closeModal();

    const res = await sendMessage({
        action: 'SAVE_SESSION',
        data: { name, color: selectedColor }
    });

    btn.disabled = false;
    btn.textContent = 'Salvar conta';

    if (res.error) {
        showStatus(res.error, 'error');
        return;
    }

    await loadSessions();
    showStatus(`✓ "${name}" salva com sucesso!`, 'success');
    setTimeout(clearStatus, 3000);
}

// ─── Delete modal ─────────────────────────────────────────────────────────────
function openDeleteModal(id, name) {
    deletingId = id;
    deleteAccountName.textContent = name;
    deleteModalOverlay.classList.remove('hidden');
}

function closeDeleteModal() {
    deleteModalOverlay.classList.add('hidden');
    deletingId = null;
}

async function confirmDelete() {
    if (!deletingId) return;
    const res = await sendMessage({ action: 'DELETE_SESSION', data: { id: deletingId } });
    closeDeleteModal();
    if (res.error) { showStatus(res.error, 'error'); return; }
    await loadSessions();
    showStatus('Conta removida.', 'info');
    setTimeout(clearStatus, 2000);
}

// ─── Color picker ─────────────────────────────────────────────────────────────
function buildColorPicker() {
    COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch' + (color === selectedColor ? ' selected' : '');
        swatch.style.background = color;
        swatch.addEventListener('click', () => {
            selectedColor = color;
            updateColorSelection();
        });
        colorPicker.appendChild(swatch);
    });
}

function updateColorSelection() {
    document.querySelectorAll('.color-swatch').forEach((el, i) => {
        el.classList.toggle('selected', COLORS[i] === selectedColor);
    });
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function showStatus(html, type = 'info') {
    statusText.innerHTML = html;
    statusBar.className = `status-bar${type === 'error' ? ' error' : ''}`;
}
function clearStatus() { statusBar.className = 'status-bar hidden'; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendMessage(msg) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, (res) => {
            if (chrome.runtime.lastError) {
                resolve({ error: chrome.runtime.lastError.message });
            } else {
                resolve(res || {});
            }
        });
    });
}

function getInitials(name) {
    return name
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() || '')
        .join('');
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Force refresh all tokens ─────────────────────────────────────────────────
async function forceRefreshAll() {
    const btn = document.getElementById('btn-refresh-all');
    const lastRefresh = document.getElementById('last-refresh');

    btn.disabled = true;
    btn.classList.add('spinning');
    lastRefresh.textContent = 'Renovando...';

    const res = await sendMessage({ action: 'FORCE_REFRESH' });

    btn.disabled = false;
    btn.classList.remove('spinning');

    if (res.error) {
        lastRefresh.textContent = 'Erro ao renovar';
        showStatus(res.error, 'error');
        return;
    }

    const count = res.refreshed ?? 0;
    const total = res.total ?? sessions.length;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    lastRefresh.textContent = `${count}/${total} renovados às ${timeStr}`;
    if (count > 0) {
        showStatus(`✓ ${count} token(s) renovados com sucesso!`, 'success');
        setTimeout(clearStatus, 3000);
    } else {
        showStatus('Todos os tokens ainda estão frescos.', 'info');
        setTimeout(clearStatus, 2500);
    }
}

// ─── Export/Import ────────────────────────────────────────────────────────────
async function exportSessions() {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    if (sessions.length === 0) {
        showStatus('Nenhuma conta para exportar.', 'error');
        setTimeout(clearStatus, 2000);
        return;
    }

    const data = JSON.stringify(sessions, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().split('T')[0];

    const a = document.createElement('a');
    a.href = url;
    a.download = `supabase-accounts-${date}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showStatus('✓ Backup exportado com sucesso!', 'success');
    setTimeout(clearStatus, 3000);
}

async function importSessions(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (!Array.isArray(imported)) throw new Error('Formato inválido.');

            const res = await chrome.storage.local.get('sessions');
            const current = res.sessions || [];

            // Merge sessions by ID, avoiding duplicates
            const currentIds = new Set(current.map(s => s.id));
            const newSessions = [...current];

            let addedCount = 0;
            imported.forEach(s => {
                if (s.id && s.tokens && !currentIds.has(s.id)) {
                    newSessions.push(s);
                    addedCount++;
                }
            });

            if (addedCount === 0) {
                showStatus('Nenhuma conta nova encontrada no arquivo.', 'info');
            } else {
                await chrome.storage.local.set({ sessions: newSessions });
                await loadSessions();
                showStatus(`✓ ${addedCount} conta(s) importada(s)! Verificando tokens...`, 'success');
                // Trigger background check for the new sessions
                sendMessage({ action: 'FORCE_REFRESH' }).then(() => loadSessions());
            }
            setTimeout(clearStatus, 4000);
        } catch (err) {
            showStatus('Erro ao importar: arquivo inválido.', 'error');
            setTimeout(clearStatus, 4000);
        }
        e.target.value = ''; // Reset file input
    };
    reader.readAsText(file);
}
