// Socket and Session State
const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');
const nickname = localStorage.getItem('pixel_nickname') || 'Player';

let sessionData = null;
let imageData = null;
let playerData = null;
let activePalette = {};
let selectedColorCode = null; // null means eraser
let isEraserMode = false;
let isMouseDown = false;
let isTouching = false;
let viewMode = 'art'; // 'art' = pure solid colors, 'codes' = letter code overlay
let activeTeammates = new Map();
let cursorThrottleTimer = null;

// Dynamic cell sizing & zoom
let currentCellSize = 26;
let baseCellSize = 26;

// Timer state
let timerRunning = false;
let elapsedMs = 0;
let timerStartedAt = null;
let timerTicker = null;

// Audio context for sound effects
let audioCtx = null;
function playTone(freq, type = 'sine', duration = 0.1) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
}

if (!sessionId) {
    alert('No session specified. Returning to lobby.');
    window.location.href = '/';
}

// Global mouse tracking for drag-to-paint
document.addEventListener('mousedown', () => { isMouseDown = true; });
document.addEventListener('mouseup', () => { isMouseDown = false; });

// Connect and join session
socket.on('connect', () => {
    document.getElementById('connectionStatus').textContent = '● Connected';
    document.getElementById('connectionStatus').style.color = '#34d399';

    const clientToken = localStorage.getItem('pixel_token_' + sessionId);
    socket.emit('session:join', { sessionId, nickname, clientToken }, (res) => {
        if (!res.success) {
            alert('Could not join session: ' + res.error);
            window.location.href = '/';
            return;
        }
        setupSession(res.data);
    });
});

socket.on('disconnect', () => {
    document.getElementById('connectionStatus').textContent = '○ Reconnecting...';
    document.getElementById('connectionStatus').style.color = '#f59e0b';
});

// Setup UI once joined
function setupSession(data) {
    sessionData = data.session;
    imageData = data.image;
    playerData = data.player;
    activePalette = sessionData.palette || {};

    if (playerData.id) {
        localStorage.setItem('pixel_token_' + sessionId, playerData.id);
    }

    document.getElementById('navSessionTitle').textContent = sessionData.name;
    document.getElementById('navImageInfo').textContent = `${imageData.title} (${sessionData.width}×${sessionData.height}) · ${imageData.theme}`;

    // Select first color by default
    const colorCodes = Object.keys(activePalette);
    if (colorCodes.length > 0) {
        selectColor(colorCodes[0]);
    }

    initCellSize();
    renderPalette();
    buildCoordinateGrid();
    renderAllCells();
    updateStatsDisplay(sessionData.stats);

    // Initial timer sync
    syncTimer(sessionData.timer);

    // Initial players
    if (data.activePlayers) {
        for (const p of data.activePlayers) {
            activeTeammates.set(p.id, p);
        }
        renderTeammates();
    }
}

// Responsive Zoom calculation
function initCellSize() {
    if (!sessionData) return;
    const screenW = window.innerWidth;
    const gridCols = sessionData.width || 20;

    if (screenW <= 480) {
        // Fits full width on mobile phones without horizontal overflow
        currentCellSize = Math.max(14, Math.floor((screenW - 52) / gridCols));
    } else if (screenW <= 768) {
        currentCellSize = Math.max(18, Math.floor((screenW - 70) / gridCols));
    } else {
        currentCellSize = 26;
    }
    baseCellSize = currentCellSize;
    applyCellSize(currentCellSize);
}

function applyCellSize(size) {
    currentCellSize = size;
    document.documentElement.style.setProperty('--cell-size', `${size}px`);
    const pct = Math.round((currentCellSize / baseCellSize) * 100);
    const zoomEl = document.getElementById('zoomLabel');
    if (zoomEl) zoomEl.textContent = `${pct}%`;
}

function changeZoom(delta) {
    const newSize = Math.min(38, Math.max(12, currentCellSize + delta));
    applyCellSize(newSize);
}

function resetZoom() {
    initCellSize();
}

window.addEventListener('resize', () => {
    // Only re-init if not manually zoomed
    if (Math.abs(currentCellSize - baseCellSize) <= 2) {
        initCellSize();
    }
});

// Build coordinate headers (A-T / A-Y, 1-20 / 1-25)
function buildCoordinateGrid() {
    const colContainer = document.getElementById('topColHeaders');
    const rowContainer = document.getElementById('leftRowHeaders');
    const board = document.getElementById('pixelBoard');

    colContainer.innerHTML = '';
    rowContainer.innerHTML = '';
    board.innerHTML = '';

    const width = sessionData.width;
    const height = sessionData.height;

    board.style.gridTemplateColumns = `repeat(${width}, var(--cell-size, 26px))`;
    board.style.gridTemplateRows = `repeat(${height}, var(--cell-size, 26px))`;

    // Top col headers
    for (let c = 0; c < width; c++) {
        const colLabel = document.createElement('div');
        colLabel.className = 'col-label';
        colLabel.textContent = sessionData.colHeaders[c] || String.fromCharCode(65 + c);
        colContainer.appendChild(colLabel);
    }

    // Left row headers
    for (let r = 0; r < height; r++) {
        const rowLabel = document.createElement('div');
        rowLabel.className = 'row-label';
        rowLabel.textContent = sessionData.rowHeaders[r] || (r + 1);
        rowContainer.appendChild(rowLabel);
    }

    // Build board cells
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            const cell = document.createElement('div');
            cell.className = 'pixel-cell';
            cell.id = `cell_${r}_${c}`;
            cell.dataset.row = r;
            cell.dataset.col = c;

            // Mouse painting
            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                paintCell(r, c);
            });

            cell.addEventListener('mouseenter', () => {
                updateHoverInfo(r, c);
                emitCursorMove(r, c);
                if (isMouseDown) {
                    paintCell(r, c);
                }
            });

            board.appendChild(cell);
        }
    }

    // Setup touch drag-to-paint on mobile devices
    setupTouchPainting(board);
}

// Mobile touch painting handler
function setupTouchPainting(board) {
    board.addEventListener('touchstart', (e) => {
        isTouching = true;
        handleTouch(e.touches[0]);
    }, { passive: false });

    board.addEventListener('touchmove', (e) => {
        if (!isTouching) return;
        e.preventDefault(); // prevent viewport scrolling while dragging to paint
        handleTouch(e.touches[0]);
    }, { passive: false });

    board.addEventListener('touchend', () => {
        isTouching = false;
    });

    board.addEventListener('touchcancel', () => {
        isTouching = false;
    });

    function handleTouch(touch) {
        if (!touch) return;
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && target.classList && target.classList.contains('pixel-cell')) {
            const r = parseInt(target.dataset.row, 10);
            const c = parseInt(target.dataset.col, 10);
            if (!isNaN(r) && !isNaN(c)) {
                paintCell(r, c);
                updateHoverInfo(r, c);
            }
        }
    }
}

// Render palette buttons without scrollbar clipping
function renderPalette() {
    const container = document.getElementById('paletteGrid');
    container.innerHTML = '';

    const shortcuts = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
    let idx = 0;

    for (const [code, info] of Object.entries(activePalette)) {
        const shortcut = shortcuts[idx] || '';
        const btn = document.createElement('div');
        btn.className = `palette-btn ${selectedColorCode === code && !isEraserMode ? 'active' : ''}`;
        btn.id = `palette_btn_${code}`;
        btn.title = `${info.name} (${code}) · Click to select`;
        btn.onclick = () => selectColor(code);

        btn.innerHTML = `
            <div class="swatch-box" style="background-color: ${info.hex}"></div>
            <div class="swatch-info">
                <span class="swatch-name">${escapeHtml(info.name)}</span>
                <span class="swatch-sub">${code} · ${info.hex}</span>
            </div>
            ${shortcut ? `<span class="shortcut-badge">${shortcut}</span>` : ''}
        `;

        container.appendChild(btn);
        idx++;
    }

    // Adaptive shortcut tip for mobile
    const tipEl = document.getElementById('paletteShortcutTip');
    if (tipEl) {
        if (window.innerWidth <= 600 || ('ontouchstart' in window)) {
            tipEl.innerHTML = '⚡ Tap any swatch above, then tap/drag on the grid to paint!';
        } else {
            tipEl.innerHTML = '⚡ Tip: Keys <strong>1-9, 0, -, =</strong> switch colors rapidly!';
        }
    }
}

function selectColor(code) {
    isEraserMode = false;
    selectedColorCode = code;
    document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('eraserBtn').classList.remove('btn-warning');
    document.getElementById('eraserBtn').classList.add('btn-secondary');

    const activeBtn = document.getElementById(`palette_btn_${code}`);
    if (activeBtn) activeBtn.classList.add('active');
}

function selectEraser() {
    isEraserMode = true;
    selectedColorCode = '';
    document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('eraserBtn').classList.remove('btn-secondary');
    document.getElementById('eraserBtn').classList.add('btn-warning');
}

// Keyboard shortcuts for quick palette picking
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const shortcuts = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
    const sIndex = shortcuts.indexOf(e.key);
    if (sIndex !== -1) {
        const codes = Object.keys(activePalette);
        if (sIndex < codes.length) {
            selectColor(codes[sIndex]);
            playTone(440, 'sine', 0.05);
        }
    } else if (e.key.toLowerCase() === 'e') {
        selectEraser();
    }
});

// Painting a cell (fills the actual color directly!)
function paintCell(r, c) {
    if (!sessionData) return;
    const colorToPlace = isEraserMode ? '' : selectedColorCode;

    // Check if cell already has this exact color
    if (sessionData.currentGrid[r][c] === colorToPlace) return;

    // Optimistic local update with the ACTUAL COLOR
    sessionData.currentGrid[r][c] = colorToPlace;
    updateCellDOM(r, c, colorToPlace);
    playTone(isEraserMode ? 260 : 520, 'sine', 0.05);

    // Send to authoritative server
    socket.emit('pixel:paint', {
        row: r,
        col: c,
        colorCode: colorToPlace,
        clientSeq: Date.now()
    }, (res) => {
        if (!res.success) {
            console.warn('Paint rejected by server:', res.error);
        }
    });
}

// Update single cell DOM - fills the pure solid color!
function updateCellDOM(r, c, code) {
    const cell = document.getElementById(`cell_${r}_${c}`);
    if (!cell) return;

    if (code && activePalette[code]) {
        cell.style.backgroundColor = activePalette[code].hex;
        cell.style.color = activePalette[code].text;
        cell.textContent = (viewMode === 'codes') ? code : '';
    } else {
        cell.style.backgroundColor = '';
        cell.style.color = '';
        cell.textContent = '';
    }
}

function renderAllCells() {
    if (!sessionData) return;
    for (let r = 0; r < sessionData.height; r++) {
        for (let c = 0; c < sessionData.width; c++) {
            updateCellDOM(r, c, sessionData.currentGrid[r][c]);
        }
    }
}

window.onThemeChange = function() {
    renderAllCells();
};

function setViewMode(mode) {
    viewMode = mode;
    document.getElementById('btnArtView').className = `btn btn-sm ${mode === 'art' ? 'btn-primary' : 'btn-secondary'}`;
    document.getElementById('btnCodeView').className = `btn btn-sm ${mode === 'codes' ? 'btn-primary' : 'btn-secondary'}`;
    renderAllCells();
}

function updateHoverInfo(r, c) {
    if (!sessionData) return;
    const colName = sessionData.colHeaders[c] || `C${c+1}`;
    const rowName = sessionData.rowHeaders[r] || `${r+1}`;
    document.getElementById('hoverCoordLabel').textContent = `${colName}${rowName}`;

    const targetCode = sessionData.masterGrid && sessionData.masterGrid[r] ? sessionData.masterGrid[r][c] : '';
    if (targetCode && activePalette[targetCode]) {
        document.getElementById('hoverTargetLabel').textContent = `${activePalette[targetCode].name} (${targetCode})`;
    } else {
        document.getElementById('hoverTargetLabel').textContent = '--';
    }
}

function emitCursorMove(r, c) {
    if (!cursorThrottleTimer) {
        cursorThrottleTimer = setTimeout(() => {
            cursorThrottleTimer = null;
            socket.emit('cursor:move', { row: r, col: c });
        }, 50);
    }
}

// Remote socket event listeners
socket.on('pixel:updated', (payload) => {
    if (!sessionData) return;
    const { row, col, colorCode, avatarColor, stats } = payload;
    sessionData.currentGrid[row][col] = colorCode;
    updateCellDOM(row, col, colorCode);

    if (stats) updateStatsDisplay(stats);

    // Pop animation effect
    const cell = document.getElementById(`cell_${row}_${col}`);
    if (cell) {
        cell.style.transform = 'scale(1.2)';
        cell.style.boxShadow = `0 0 10px ${avatarColor || '#38bdf8'}`;
        setTimeout(() => {
            cell.style.transform = 'scale(1)';
            cell.style.boxShadow = 'none';
        }, 150);
    }
});

socket.on('cursor:updated', ({ playerId, nickname, avatarColor, row, col }) => {
    document.querySelectorAll(`.peer-cursor-${playerId}`).forEach(el => el.remove());

    const cell = document.getElementById(`cell_${row}_${col}`);
    if (cell) {
        const ring = document.createElement('div');
        ring.className = `peer-cursor-ring peer-cursor-${playerId}`;
        ring.style.setProperty('--peer-color', avatarColor);
        ring.title = `${nickname} is here`;
        cell.appendChild(ring);
    }
});

socket.on('player:joined', ({ playerId, nickname, avatarColor }) => {
    activeTeammates.set(playerId, { id: playerId, nickname, avatarColor });
    renderTeammates();
});

socket.on('player:left', ({ playerId }) => {
    activeTeammates.delete(playerId);
    document.querySelectorAll(`.peer-cursor-${playerId}`).forEach(el => el.remove());
    renderTeammates();
});

function renderTeammates() {
    const list = document.getElementById('playersList');
    const countEl = document.getElementById('teammatesCount');
    countEl.textContent = activeTeammates.size;
    list.innerHTML = '';

    for (const p of activeTeammates.values()) {
        const item = document.createElement('div');
        item.className = 'player-item';
        item.innerHTML = `
            <div>
                <span class="player-badge-dot" style="background-color: ${p.avatarColor}"></span>
                <strong>${escapeHtml(p.nickname)}</strong>
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${p.pixelsPlaced ? p.pixelsPlaced + ' px' : 'active'}</span>
        `;
        list.appendChild(item);
    }
}

// Timer synchronization
socket.on('timer:sync', (timerPayload) => {
    syncTimer(timerPayload);
});

let localSyncAt = Date.now();
let serverBaseElapsed = 0;

function syncTimer(timer) {
    if (!timer) return;
    timerRunning = Boolean(timer.running);
    
    // Calculate exact elapsed ms up to the moment of sync
    const baseElapsed = Number(timer.elapsedMs) || 0;
    const serverTime = Number(timer.serverTime) || Date.now();
    const startedAt = Number(timer.startedAt) || 0;
    const runningElapsed = (timerRunning && startedAt > 0) ? Math.max(0, serverTime - startedAt) : 0;
    serverBaseElapsed = baseElapsed + runningElapsed;
    localSyncAt = Date.now();

    if (timerTicker) clearInterval(timerTicker);

    const updateTimerDisplay = () => {
        let currentElapsed = serverBaseElapsed;
        if (timerRunning) {
            currentElapsed += (Date.now() - localSyncAt);
        }
        const timerEl = document.getElementById('timerDisplay');
        if (timerEl) {
            timerEl.textContent = formatTime(currentElapsed);
        }
    };

    updateTimerDisplay();
    if (timerRunning) {
        timerTicker = setInterval(updateTimerDisplay, 100);
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && timerRunning) {
        const timerEl = document.getElementById('timerDisplay');
        if (timerEl) {
            timerEl.textContent = formatTime(serverBaseElapsed + (Date.now() - localSyncAt));
        }
    }
});

function formatTime(msTotal) {
    if (isNaN(msTotal) || msTotal < 0) msTotal = 0;
    const secTotal = msTotal / 1000;
    const mins = Math.floor(secTotal / 60);
    const secs = Math.floor(secTotal % 60);
    const tenths = Math.floor((secTotal % 1) * 10);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function updateStatsDisplay(stats) {
    if (!stats) return;
    document.getElementById('progressText').textContent = `${stats.completedPercent.toFixed(1)}%`;
    document.getElementById('progressBar').style.width = `${stats.completedPercent}%`;
    document.getElementById('accuracyText').textContent = `${stats.accuracyPercent.toFixed(1)}%`;
    document.getElementById('matchedCellsText').textContent = `${stats.matchingCellsCount} / ${stats.totalTargetCells}`;
}

// Grid Reset & Completed Events
socket.on('session:grid_reset', ({ grid, stats }) => {
    sessionData.currentGrid = grid;
    renderAllCells();
    updateStatsDisplay(stats);
});

socket.on('session:master_filled', ({ grid, stats }) => {
    sessionData.currentGrid = grid;
    renderAllCells();
    updateStatsDisplay(stats);
});

socket.on('session:completed', ({ stats }) => {
    playTone(660, 'sine', 0.2);
    setTimeout(() => playTone(880, 'sine', 0.3), 200);
    setTimeout(() => playTone(1100, 'sine', 0.5), 400);

    let currentElapsed = elapsedMs;
    if (timerRunning && timerStartedAt) {
        currentElapsed += (Date.now() - timerStartedAt);
    }
    document.getElementById('victoryFinalTime').textContent = formatTime(currentElapsed);
    document.getElementById('victoryModal').classList.add('active');
});

function closeVictoryModal() {
    document.getElementById('victoryModal').classList.remove('active');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}
