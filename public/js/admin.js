const socket = io();
let currentSessions = new Map();
let inspectedSessionId = null;
let imageCatalog = [];

// Socket setup
socket.on('connect', () => {
    socket.emit('admin:join');
});

// Telemetry tick every 1000ms
socket.on('admin:telemetry_tick', ({ timestamp, sessions }) => {
    if (!sessions) return;
    for (const s of sessions) {
        currentSessions.set(s.id, s);
    }
    renderSessionCards(sessions);

    // If an inspector modal is open for a session, update its canvas
    if (inspectedSessionId && currentSessions.has(inspectedSessionId)) {
        updateInspectorCanvas(currentSessions.get(inspectedSessionId));
    }
});

// Real-time audit events for the inspected session
socket.on('admin:audit_event', (logEntry) => {
    if (!inspectedSessionId || logEntry.sessionId !== inspectedSessionId) return;
    prependAuditRow(logEntry);
    fetchLeaderboard(inspectedSessionId);
});

// Inspection data initial response
socket.on('admin:inspection_data', ({ sessionId, logs, leaderboard }) => {
    if (sessionId !== inspectedSessionId) return;
    renderAuditLogs(logs || []);
    renderLeaderboard(leaderboard || []);
});

// Initial load: Fetch images
async function initAdmin() {
    try {
        const res = await fetch('/api/admin/images');
        const json = await res.json();
        if (json.success) {
            imageCatalog = json.data;
            populateImageSelect(imageCatalog);
        }
    } catch (err) {
        console.error('Failed to load images:', err);
    }
    refreshAdminSessions();
}

function populateImageSelect(images) {
    const select = document.getElementById('selectImage');
    select.innerHTML = images.map(img => `
        <option value="${img.id}">
            ${escapeHtml(img.title)} (${img.width}×${img.height}) · ${escapeHtml(img.theme || '')}
        </option>
    `).join('');
}

async function refreshAdminSessions() {
    try {
        const res = await fetch('/api/admin/sessions');
        const json = await res.json();
        if (json.success) {
            for (const s of json.data) {
                currentSessions.set(s.id, s);
            }
            renderSessionCards(json.data);
        }
    } catch (err) {
        console.error('Failed to fetch sessions:', err);
    }
}

// Session Creation
async function handleCreateSessions(e) {
    e.preventDefault();
    const imageId = document.getElementById('selectImage').value;
    const count = document.getElementById('inputCount').value;
    const maxPlayers = document.getElementById('inputMaxPlayers').value;
    const baseName = document.getElementById('inputBaseName').value;

    const btn = document.getElementById('btnCreateSessions');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const res = await fetch('/api/admin/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageId, count, maxPlayers, baseName })
        });
        const json = await res.json();
        if (json.success) {
            refreshAdminSessions();
        } else {
            alert('Failed to create sessions: ' + json.error);
        }
    } catch (err) {
        alert('Network error creating sessions.');
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Create Sessions';
    }
}

// Render multi-session cards with live canvas thumbnails
function renderSessionCards(sessions) {
    const container = document.getElementById('adminSessionsContainer');
    const emptyState = document.getElementById('adminEmptyState');
    document.getElementById('totalSessionsCount').textContent = sessions.length;

    if (!sessions || sessions.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Update or create cards
    sessions.forEach(s => {
        let card = document.getElementById(`admin_card_${s.id}`);
        if (!card) {
            card = document.createElement('div');
            card.id = `admin_card_${s.id}`;
            card.className = 'admin-session-card';
            container.appendChild(card);
        }

        const badgeClass = `badge-${s.status || 'waiting'}`;
        const timerText = formatTime(s.elapsedMs || 0);

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h3 style="margin: 0 0 4px 0; font-size: 1.1rem; color: #fff;">${escapeHtml(s.name)}</h3>
                    <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(s.imageTitle)} (${s.width}×${s.height})</p>
                </div>
                <span class="badge ${badgeClass}">${(s.status || 'waiting').toUpperCase()}</span>
            </div>

            <!-- Thumbnail Canvas & Progress Stats -->
            <div style="display: flex; gap: 14px; align-items: center;">
                <div class="canvas-thumb-wrapper">
                    <canvas id="thumb_${s.id}" class="session-thumb" width="80" height="80"></canvas>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.82rem;">
                        <span style="color: var(--text-muted);">Completion</span>
                        <strong style="color: #38bdf8;">${s.completedPercent.toFixed(1)}%</strong>
                    </div>
                    <div class="progress-container">
                        <div class="progress-bar" style="width: ${s.completedPercent}%;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--text-muted);">
                        <span>Accuracy: <strong style="color: #34d399;">${s.accuracyPercent.toFixed(1)}%</strong></span>
                        <span>Players: <strong>${s.activePlayersCount} / ${s.maxPlayers}</strong></span>
                    </div>
                    <div style="font-family: monospace; font-size: 0.95rem; font-weight: 700; color: #fff;">
                        ⏱️ ${timerText}
                    </div>
                </div>
            </div>

            <!-- Controls Toolbar -->
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
                <button class="btn btn-sm ${s.timerRunning ? 'btn-warning' : 'btn-success'}" onclick="toggleTimer('${s.id}', ${s.timerRunning})">
                    ${s.timerRunning ? '⏸ Pause' : '▶ Start'}
                </button>
                <button class="btn btn-sm btn-secondary" onclick="resetGrid('${s.id}')">🔄 Reset</button>
                <button class="btn btn-sm btn-secondary" onclick="toggleLock('${s.id}', '${s.status}')">
                    ${s.status === 'locked' ? '🔓 Unlock' : '🔒 Lock'}
                </button>
                <button class="btn btn-sm btn-secondary" onclick="fillMaster('${s.id}')" title="Fill 100% for testing">⚡ Fill</button>
                <button class="btn btn-sm btn-primary" onclick="openInspector('${s.id}')" style="margin-left: auto;">
                    🔍 Inspect & Track
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteSession('${s.id}')" title="Delete Table">🗑</button>
            </div>
        `;

        drawCanvasThumbnail(`thumb_${s.id}`, s.currentGrid, s.palette, s.width, s.height, 80);
    });
}

// High performance canvas thumbnail drawing
function drawCanvasThumbnail(canvasId, grid, palette, width, height, size) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !grid) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const cellW = size / width;
    const cellH = size / height;

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            const code = grid[r] ? grid[r][c] : '';
            if (code && palette && palette[code]) {
                ctx.fillStyle = palette[code].hex;
            } else {
                ctx.fillStyle = '#111827';
            }
            ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
        }
    }
}

// Session Controls
function toggleTimer(sessionId, isRunning) {
    const action = isRunning ? 'pause' : 'start';
    socket.emit('admin:control_timer', { sessionId, action });
}

function resetGrid(sessionId) {
    if (confirm('Are you sure you want to reset this session grid? All player progress will be cleared.')) {
        socket.emit('admin:reset_grid', { sessionId });
    }
}

function toggleLock(sessionId, currentStatus) {
    const lock = currentStatus !== 'locked';
    socket.emit('admin:lock_session', { sessionId, locked: lock });
}

function fillMaster(sessionId) {
    socket.emit('admin:fill_master', { sessionId });
}

async function deleteSession(sessionId) {
    if (confirm('Permanently delete this session and its audit logs?')) {
        await fetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
        currentSessions.delete(sessionId);
        const card = document.getElementById(`admin_card_${sessionId}`);
        if (card) card.remove();
        refreshAdminSessions();
    }
}

// Deep Inspection Modal
function openInspector(sessionId) {
    inspectedSessionId = sessionId;
    const s = currentSessions.get(sessionId);
    if (!s) return;

    document.getElementById('modalSessionTitle').textContent = `Tracking: ${s.name}`;
    document.getElementById('modalSessionSubtitle').textContent = `${s.imageTitle} (${s.width}×${s.height}) · Live Audit Trail & Telemetry`;
    document.getElementById('btnExportCsv').href = `/api/admin/sessions/${sessionId}/export?format=csv`;
    document.getElementById('btnExportJson').href = `/api/admin/sessions/${sessionId}/export?format=json`;

    socket.emit('admin:inspect_session', { sessionId });
    document.getElementById('inspectorModal').classList.add('active');
    updateInspectorCanvas(s);
}

function closeInspector() {
    inspectedSessionId = null;
    socket.emit('admin:inspect_session', { sessionId: null });
    document.getElementById('inspectorModal').classList.remove('active');
}

function updateInspectorCanvas(s) {
    drawCanvasThumbnail('inspectorCanvas', s.currentGrid, s.palette, s.width, s.height, 200);
    document.getElementById('inspectorCanvasMeta').textContent = 
        `Progress: ${s.completedPercent.toFixed(1)}% | Accuracy: ${s.accuracyPercent.toFixed(1)}%`;
}

function renderAuditLogs(logs) {
    const tbody = document.getElementById('auditLogsTbody');
    tbody.innerHTML = '';
    for (const log of logs) {
        appendAuditRow(log, false);
    }
}

function prependAuditRow(log) {
    const tbody = document.getElementById('auditLogsTbody');
    const tr = createLogRow(log);
    tbody.insertBefore(tr, tbody.firstChild);

    // Limit table length in DOM to 200 rows for performance
    if (tbody.children.length > 200) {
        tbody.removeChild(tbody.lastChild);
    }
}

function appendAuditRow(log, isPrepend = false) {
    const tbody = document.getElementById('auditLogsTbody');
    const tr = createLogRow(log);
    if (isPrepend) {
        tbody.insertBefore(tr, tbody.firstChild);
    } else {
        tbody.appendChild(tr);
    }
}

function createLogRow(log) {
    const tr = document.createElement('tr');
    const timeStr = new Date(log.server_timestamp || log.serverTimestamp).toLocaleTimeString();
    const isCorrect = Boolean(log.is_correct !== undefined ? log.is_correct : log.isCorrect);
    const placedColor = log.placed_color || log.placedColor || '';
    const targetColor = log.target_color || log.targetColor || '';
    const nickname = log.player_nickname || log.playerNickname || 'Player';
    const actionType = log.action_type || log.actionType || 'PIXEL_PAINT';
    const coord = log.coord_label || log.coordLabel || '--';

    tr.innerHTML = `
        <td style="font-family: monospace; font-size: 0.78rem; color: var(--text-muted);">${timeStr}</td>
        <td><strong>${escapeHtml(nickname)}</strong></td>
        <td><span style="font-size: 0.75rem; color: #94a3b8;">${actionType}</span></td>
        <td><span style="font-family: monospace; font-weight: 700; color: #38bdf8;">${coord}</span></td>
        <td>${placedColor ? `<code>${placedColor}</code>` : '<em style="color:#64748b;">(clear)</em>'}</td>
        <td><code>${targetColor}</code></td>
        <td class="${isCorrect ? 'log-match' : 'log-mismatch'}">
            ${isCorrect ? '✓ MATCH' : '✗ MISMATCH'}
        </td>
    `;
    return tr;
}

function renderLeaderboard(leaderboard) {
    const tbody = document.getElementById('leaderboardTbody');
    if (!leaderboard || leaderboard.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No player actions yet.</td></tr>';
        return;
    }

    tbody.innerHTML = leaderboard.map(p => `
        <tr>
            <td><strong>${escapeHtml(p.player_nickname)}</strong></td>
            <td>${p.total_actions}</td>
            <td style="color: #34d399; font-weight: 700;">${p.correct_actions}</td>
            <td><strong>${p.accuracy_pct}%</strong></td>
        </tr>
    `).join('');
}

async function fetchLeaderboard(sessionId) {
    try {
        const res = await fetch(`/api/admin/sessions/${sessionId}/leaderboard`);
        const json = await res.json();
        if (json.success) {
            renderLeaderboard(json.data);
        }
    } catch (e) {}
}

function formatTime(msTotal) {
    const secTotal = msTotal / 1000;
    const mins = Math.floor(secTotal / 60);
    const secs = Math.floor(secTotal % 60);
    const tenths = Math.floor((secTotal % 1) * 10);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}

// Start admin on window load
window.onload = initAdmin;
