const db = require('../db/database');
const auditLogger = require('./auditLogger');
const { backupDatabaseToGCS } = require('./cloudStorageSync');

// Random avatar colors for players
const AVATAR_COLORS = [
    '#38bdf8', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
];

class SessionManager {
    constructor() {
        this.sessions = new Map(); // sessionId -> SessionState
        this.images = new Map();   // imageId -> ImageRecord
        this.loadImages();
        this.loadSessionsFromDb();

        // Start snapshot persistence timer (every 5 seconds)
        setInterval(() => this.persistDirtySessions(), 5000);
    }

    loadImages() {
        const rows = db.prepare('SELECT * FROM images').all();
        for (const row of rows) {
            this.images.set(row.id, {
                ...row,
                col_headers: JSON.parse(row.col_headers),
                row_headers: JSON.parse(row.row_headers),
                palette: JSON.parse(row.palette),
                master_grid: JSON.parse(row.master_grid)
            });
        }
        console.log(`[SessionManager] Cached ${this.images.size} images in memory.`);
    }

    loadSessionsFromDb() {
        const rows = db.prepare('SELECT * FROM sessions').all();
        for (const row of rows) {
            const image = this.images.get(row.image_id);
            if (!image) continue;

            const currentGrid = JSON.parse(row.current_grid);
            const totalTargetCells = image.total_target_cells || (image.width * image.height);
            
            // Calculate matching cells
            let matchingCellsCount = 0;
            for (let r = 0; r < image.height; r++) {
                for (let c = 0; c < image.width; c++) {
                    const current = currentGrid[r] ? currentGrid[r][c] : '';
                    const target = image.master_grid[r] ? image.master_grid[r][c] : '';
                    if (current && target && current === target) {
                        matchingCellsCount++;
                    }
                }
            }

            const sessionState = {
                id: row.id,
                imageId: row.image_id,
                name: row.name,
                status: row.status,
                maxPlayers: row.max_players,
                width: image.width,
                height: image.height,
                colHeaders: image.col_headers,
                rowHeaders: image.row_headers,
                palette: image.palette,
                masterGrid: image.master_grid,
                currentGrid,
                timer: {
                    running: Boolean(row.timer_running),
                    elapsedMs: row.elapsed_ms || 0,
                    startedAt: row.timer_started_at || null
                },
                stats: {
                    totalTargetCells,
                    matchingCellsCount,
                    totalPlacedAttempts: row.stats_total_placed || 0,
                    totalCorrectAttempts: row.stats_correct_placed || 0,
                    completedPercent: Number(row.stats_completed_pct) || 0,
                    accuracyPercent: Number(row.stats_accuracy_pct) || 0
                },
                players: new Map(), // socketId -> ActivePlayer
                dirty: false
            };

            this.sessions.set(sessionState.id, sessionState);
        }
        console.log(`[SessionManager] Restored ${this.sessions.size} sessions from database.`);
    }

    getImage(imageId) {
        return this.images.get(imageId);
    }

    getAllImages() {
        return Array.from(this.images.values()).map(img => ({
            id: img.id,
            title: img.title,
            theme: img.theme,
            difficulty: img.difficulty,
            width: img.width,
            height: img.height,
            totalTargetCells: img.total_target_cells,
            palette: img.palette
        }));
    }

    createSession({ imageId, name, maxPlayers = 10 }) {
        const image = this.images.get(imageId);
        if (!image) throw new Error(`Image ID "${imageId}" not found.`);

        const sessionId = 'ses_' + Math.random().toString(36).substring(2, 8);
        const emptyGrid = Array.from({ length: image.height }, () => Array(image.width).fill(''));

        const sessionState = {
            id: sessionId,
            imageId: image.id,
            name: name || `${image.title} Session`,
            status: 'waiting',
            maxPlayers: parseInt(maxPlayers, 10) || 10,
            width: image.width,
            height: image.height,
            colHeaders: image.col_headers,
            rowHeaders: image.row_headers,
            palette: image.palette,
            masterGrid: image.master_grid,
            currentGrid: emptyGrid,
            timer: {
                running: false,
                elapsedMs: 0,
                startedAt: null
            },
            stats: {
                totalTargetCells: image.total_target_cells || (image.width * image.height),
                matchingCellsCount: 0,
                totalPlacedAttempts: 0,
                totalCorrectAttempts: 0,
                completedPercent: 0,
                accuracyPercent: 0
            },
            players: new Map(),
            dirty: true
        };

        // Persist to DB
        const insertStmt = db.prepare(`
            INSERT INTO sessions (
                id, image_id, name, status, max_players, elapsed_ms, 
                timer_running, timer_started_at, current_grid, 
                stats_total_placed, stats_correct_placed, stats_accuracy_pct, stats_completed_pct
            ) VALUES (?, ?, ?, ?, ?, 0, 0, NULL, ?, 0, 0, 0.0, 0.0)
        `);

        insertStmt.run(
            sessionState.id,
            sessionState.imageId,
            sessionState.name,
            sessionState.status,
            sessionState.maxPlayers,
            JSON.stringify(sessionState.currentGrid)
        );

        this.sessions.set(sessionState.id, sessionState);
        console.log(`[SessionManager] Created session: ${sessionState.name} (${sessionState.id})`);
        return sessionState;
    }

    createBatchSessions({ imageId, count = 1, baseName, maxPlayers = 10 }) {
        const image = this.images.get(imageId);
        if (!image) throw new Error(`Image ID "${imageId}" not found.`);

        const created = [];
        const n = Math.max(1, Math.min(20, parseInt(count, 10) || 1));
        const prefix = baseName && baseName.trim() ? baseName.trim() : `${image.title}`;

        for (let i = 1; i <= n; i++) {
            const sessionName = n === 1 ? prefix : `${prefix} - Table ${i}`;
            const s = this.createSession({ imageId, name: sessionName, maxPlayers });
            created.push(s);
        }
        return created;
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        this.sessions.delete(sessionId);
        console.log(`[SessionManager] Deleted session: ${sessionId}`);
        return true;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    getAllSessionsSummary() {
        const summaries = [];
        for (const session of this.sessions.values()) {
            const image = this.images.get(session.imageId);
            let elapsed = session.timer.elapsedMs;
            if (session.timer.running && session.timer.startedAt) {
                elapsed += (Date.now() - session.timer.startedAt);
            }

            summaries.push({
                id: session.id,
                name: session.name,
                imageId: session.imageId,
                imageTitle: image ? image.title : 'Unknown Image',
                theme: image ? image.theme : '',
                difficulty: image ? image.difficulty : '',
                width: session.width,
                height: session.height,
                status: session.status,
                maxPlayers: session.maxPlayers,
                activePlayersCount: session.players.size,
                completedPercent: session.stats.completedPercent,
                accuracyPercent: session.stats.accuracyPercent,
                matchingCellsCount: session.stats.matchingCellsCount,
                totalTargetCells: session.stats.totalTargetCells,
                elapsedMs: elapsed,
                timerRunning: session.timer.running,
                currentGrid: session.currentGrid,
                palette: session.palette
            });
        }
        return summaries;
    }

    joinPlayer(sessionId, { socketId, nickname, clientToken }) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');

        if (session.status === 'locked') {
            throw new Error('This session is currently locked by the administrator.');
        }

        if (session.players.size >= session.maxPlayers) {
            // Check if this clientToken already has an active slot
            let existing = null;
            if (clientToken) {
                for (const p of session.players.values()) {
                    if (p.clientToken === clientToken) {
                        existing = p;
                        break;
                    }
                }
            }
            if (!existing) {
                throw new Error(`Session is full (maximum ${session.maxPlayers} players).`);
            }
        }

        const playerId = clientToken || ('usr_' + Math.random().toString(36).substring(2, 9));
        const colorIdx = session.players.size % AVATAR_COLORS.length;
        const avatarColor = AVATAR_COLORS[colorIdx];

        const player = {
            id: playerId,
            socketId,
            sessionId,
            clientToken: playerId,
            nickname: (nickname && nickname.trim()) ? nickname.trim().substring(0, 24) : `Player ${session.players.size + 1}`,
            avatarColor,
            cursor: null,
            pixelsPlaced: 0,
            correctPixels: 0,
            accuracyPercent: 0,
            lastPaintTime: 0
        };

        // If replacing old socket for same player ID, remove old socket
        for (const [sId, p] of session.players.entries()) {
            if (p.id === playerId) {
                session.players.delete(sId);
            }
        }

        session.players.set(socketId, player);
        if (session.status === 'waiting') {
            session.status = 'running';
        }

        return { session, player };
    }

    leavePlayer(socketId) {
        for (const session of this.sessions.values()) {
            if (session.players.has(socketId)) {
                const player = session.players.get(socketId);
                session.players.delete(socketId);
                return { session, player };
            }
        }
        return null;
    }

    getPlayerBySocket(socketId) {
        for (const session of this.sessions.values()) {
            if (session.players.has(socketId)) {
                return { session, player: session.players.get(socketId) };
            }
        }
        return null;
    }

    paintPixel(sessionId, playerId, { row, col, colorCode }) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');
        if (session.status === 'locked') throw new Error('Session is locked.');

        const r = parseInt(row, 10);
        const c = parseInt(col, 10);
        if (r < 0 || r >= session.height || c < 0 || c >= session.width) {
            throw new Error(`Coordinates out of bounds: row ${r}, col ${c}`);
        }

        const validCode = (colorCode && session.palette[colorCode]) ? colorCode : '';
        const oldCode = session.currentGrid[r][c] || '';
        const targetCode = session.masterGrid[r] ? (session.masterGrid[r][c] || '') : '';

        // If already the same color, no-op
        if (oldCode === validCode) {
            return { unchanged: true, session, row: r, col: c, colorCode: validCode };
        }

        // Apply O(1) matching cell count update
        if (oldCode === targetCode && validCode !== targetCode) {
            session.stats.matchingCellsCount = Math.max(0, session.stats.matchingCellsCount - 1);
        } else if (oldCode !== targetCode && validCode === targetCode) {
            session.stats.matchingCellsCount = Math.min(session.stats.totalTargetCells, session.stats.matchingCellsCount + 1);
        }

        session.currentGrid[r][c] = validCode;
        session.stats.totalPlacedAttempts++;
        const isCorrect = (validCode !== '' && validCode === targetCode);
        if (isCorrect) {
            session.stats.totalCorrectAttempts++;
        }

        // Update percentages
        session.stats.completedPercent = Number(
            ((session.stats.matchingCellsCount / session.stats.totalTargetCells) * 100).toFixed(1)
        );
        session.stats.accuracyPercent = session.stats.totalPlacedAttempts > 0 
            ? Number(((session.stats.totalCorrectAttempts / session.stats.totalPlacedAttempts) * 100).toFixed(1))
            : 0;

        // Player statistics update
        let activePlayer = null;
        for (const p of session.players.values()) {
            if (p.id === playerId) {
                p.pixelsPlaced++;
                if (isCorrect) p.correctPixels++;
                p.accuracyPercent = Number(((p.correctPixels / p.pixelsPlaced) * 100).toFixed(1));
                activePlayer = p;
                break;
            }
        }

        session.dirty = true;

        // Coordinate label (e.g. 'C4' or 'T20')
        const colLetter = session.colHeaders[c] || `C${c+1}`;
        const rowLabel = session.rowHeaders[r] || `${r+1}`;
        const coordLabel = `${colLetter}${rowLabel}`;

        // Audit Log
        const logEntry = auditLogger.logAction({
            sessionId,
            playerId,
            playerNickname: activePlayer ? activePlayer.nickname : 'Anonymous',
            actionType: validCode ? 'PIXEL_PAINT' : 'PIXEL_CLEAR',
            rowIdx: r,
            colIdx: c,
            coordLabel,
            previousColor: oldCode,
            placedColor: validCode,
            targetColor: targetCode,
            isCorrect,
            serverTimestamp: Date.now()
        });

        // Check if session completed 100%
        let isCompletedNow = false;
        if (session.stats.matchingCellsCount >= session.stats.totalTargetCells && session.status !== 'completed') {
            session.status = 'completed';
            if (session.timer.running) {
                this.setTimerState(sessionId, 'pause');
            }
            isCompletedNow = true;
        }

        return {
            session,
            row: r,
            col: c,
            colorCode: validCode,
            isCorrect,
            coordLabel,
            logEntry,
            player: activePlayer,
            isCompletedNow
        };
    }

    resetGrid(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');

        session.currentGrid = Array.from({ length: session.height }, () => Array(session.width).fill(''));
        session.stats.matchingCellsCount = 0;
        session.stats.completedPercent = 0;
        session.dirty = true;

        auditLogger.logAction({
            sessionId,
            playerId: 'admin',
            playerNickname: 'Administrator',
            actionType: 'GRID_RESET',
            rowIdx: null,
            colIdx: null,
            coordLabel: 'ALL',
            previousColor: null,
            placedColor: null,
            targetColor: null,
            isCorrect: null,
            serverTimestamp: Date.now()
        });

        return session;
    }

    fillMasterGrid(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');

        session.currentGrid = JSON.parse(JSON.stringify(session.masterGrid));
        session.stats.matchingCellsCount = session.stats.totalTargetCells;
        session.stats.completedPercent = 100.0;
        session.status = 'completed';
        if (session.timer.running) {
            this.setTimerState(sessionId, 'pause');
        }
        session.dirty = true;

        auditLogger.logAction({
            sessionId,
            playerId: 'admin',
            playerNickname: 'Administrator',
            actionType: 'ADMIN_FILL_MASTER',
            rowIdx: null,
            colIdx: null,
            coordLabel: 'ALL',
            previousColor: null,
            placedColor: null,
            targetColor: null,
            isCorrect: 1,
            serverTimestamp: Date.now()
        });

        return session;
    }

    setTimerState(sessionId, action) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');

        const now = Date.now();
        if (action === 'start') {
            if (!session.timer.running) {
                session.timer.running = true;
                session.timer.startedAt = now;
            }
        } else if (action === 'pause') {
            if (session.timer.running && session.timer.startedAt) {
                session.timer.elapsedMs += (now - session.timer.startedAt);
                session.timer.running = false;
                session.timer.startedAt = null;
            }
        } else if (action === 'reset') {
            session.timer.running = false;
            session.timer.elapsedMs = 0;
            session.timer.startedAt = null;
        }

        session.dirty = true;
        return session.timer;
    }

    lockSession(sessionId, locked) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found.');

        session.status = locked ? 'locked' : (session.stats.completedPercent >= 100 ? 'completed' : 'running');
        session.dirty = true;
        return session;
    }

    persistDirtySessions() {
        const updateStmt = db.prepare(`
            UPDATE sessions SET
                status = ?,
                elapsed_ms = ?,
                timer_running = ?,
                timer_started_at = ?,
                current_grid = ?,
                stats_total_placed = ?,
                stats_correct_placed = ?,
                stats_accuracy_pct = ?,
                stats_completed_pct = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        let hasDirty = false;
        for (const session of this.sessions.values()) {
            if (session.dirty) {
                let elapsed = session.timer.elapsedMs;
                if (session.timer.running && session.timer.startedAt) {
                    elapsed += (Date.now() - session.timer.startedAt);
                }

                updateStmt.run(
                    session.status,
                    elapsed,
                    session.timer.running ? 1 : 0,
                    session.timer.startedAt,
                    JSON.stringify(session.currentGrid),
                    session.stats.totalPlacedAttempts,
                    session.stats.totalCorrectAttempts,
                    session.stats.accuracyPercent,
                    session.stats.completedPercent,
                    session.id
                );
                session.dirty = false;
                hasDirty = true;
            }
        }

        if (hasDirty) {
            backupDatabaseToGCS(db.dbPath, db);
        }
    }
}


const sessionManager = new SessionManager();
module.exports = sessionManager;
