const sessionManager = require('../services/sessionManager');
const auditLogger = require('../services/auditLogger');

function setupSockets(io) {
    // 1-second background telemetry tick for Admin multi-session monitoring
    setInterval(() => {
        const summaries = sessionManager.getAllSessionsSummary();
        io.to('admin:all').emit('admin:telemetry_tick', {
            timestamp: Date.now(),
            sessions: summaries
        });
    }, 1000);

    io.on('connection', (socket) => {
        // --- PLAYER EVENTS ---
        socket.on('session:join', ({ sessionId, nickname, clientToken }, callback) => {
            try {
                const { session, player, timerStarted } = sessionManager.joinPlayer(sessionId, {
                    socketId: socket.id,
                    nickname,
                    clientToken
                });

                socket.join(`session:${sessionId}`);
                socket.data.sessionId = sessionId;
                socket.data.playerId = player.id;

                const image = sessionManager.getImage(session.imageId);

                // Notify peers
                socket.to(`session:${sessionId}`).emit('player:joined', {
                    playerId: player.id,
                    nickname: player.nickname,
                    avatarColor: player.avatarColor,
                    activeCount: session.players.size
                });

                // If timer just started on join, broadcast to all players in the room
                if (timerStarted) {
                    io.to(`session:${sessionId}`).emit('timer:sync', {
                        sessionId,
                        running: session.timer.running,
                        elapsedMs: session.timer.elapsedMs,
                        startedAt: session.timer.startedAt,
                        serverTime: Date.now()
                    });
                }

                const initPayload = {
                    session: {
                        id: session.id,
                        name: session.name,
                        status: session.status,
                        width: session.width,
                        height: session.height,
                        colHeaders: session.colHeaders,
                        rowHeaders: session.rowHeaders,
                        palette: session.palette,
                        currentGrid: session.currentGrid,
                        stats: session.stats,
                        timer: {
                            running: session.timer.running,
                            elapsedMs: session.timer.elapsedMs,
                            startedAt: session.timer.startedAt,
                            serverTime: Date.now()
                        }
                    },
                    image: {
                        id: image.id,
                        title: image.title,
                        theme: image.theme,
                        difficulty: image.difficulty
                    },
                    player: {
                        id: player.id,
                        nickname: player.nickname,
                        avatarColor: player.avatarColor
                    },
                    activePlayers: Array.from(session.players.values()).map(p => ({
                        id: p.id,
                        nickname: p.nickname,
                        avatarColor: p.avatarColor,
                        pixelsPlaced: p.pixelsPlaced,
                        accuracyPercent: p.accuracyPercent
                    }))
                };

                if (typeof callback === 'function') {
                    callback({ success: true, data: initPayload });
                }
            } catch (err) {
                console.error(`[Socket] Join error for socket ${socket.id}:`, err.message);
                if (typeof callback === 'function') {
                    callback({ success: false, error: err.message });
                }
            }
        });

        // Pixel paint action
        socket.on('pixel:paint', ({ row, col, colorCode, clientSeq }, callback) => {
            try {
                const sessionId = socket.data.sessionId;
                const playerId = socket.data.playerId;
                if (!sessionId || !playerId) {
                    throw new Error('Not joined to any session.');
                }

                const result = sessionManager.paintPixel(sessionId, playerId, { row, col, colorCode });
                if (result.unchanged) {
                    if (typeof callback === 'function') callback({ success: true, unchanged: true });
                    return;
                }

                const updatePayload = {
                    row: result.row,
                    col: result.col,
                    colorCode: result.colorCode,
                    coordLabel: result.coordLabel,
                    isCorrect: result.isCorrect,
                    playerId: result.player ? result.player.id : playerId,
                    playerNickname: result.player ? result.player.nickname : 'Player',
                    avatarColor: result.player ? result.player.avatarColor : '#38bdf8',
                    stats: result.session.stats,
                    clientSeq
                };

                // Broadcast to all players in the session (including sender for authoritative sync)
                io.to(`session:${sessionId}`).emit('pixel:updated', updatePayload);

                // If painting triggered timer start, broadcast timer:sync
                if (result.timerStarted) {
                    io.to(`session:${sessionId}`).emit('timer:sync', {
                        sessionId,
                        running: result.session.timer.running,
                        elapsedMs: result.session.timer.elapsedMs,
                        startedAt: result.session.timer.startedAt,
                        serverTime: Date.now()
                    });
                }

                // Send live audit event to admin drill-down room
                io.to(`admin:session:${sessionId}`).emit('admin:audit_event', result.logEntry);

                // If completed 100%, trigger victory
                if (result.isCompletedNow) {
                    io.to(`session:${sessionId}`).emit('timer:sync', {
                        sessionId,
                        running: false,
                        elapsedMs: result.session.timer.elapsedMs,
                        startedAt: null,
                        serverTime: Date.now()
                    });
                    io.to(`session:${sessionId}`).emit('session:completed', {
                        sessionId,
                        stats: result.session.stats,
                        leaderboard: auditLogger.getPlayerContributions(sessionId)
                    });
                }

                if (typeof callback === 'function') {
                    callback({ success: true, isCorrect: result.isCorrect });
                }
            } catch (err) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: err.message });
                }
            }
        });

        // Real-time hover cursor sharing
        socket.on('cursor:move', ({ row, col }) => {
            const sessionId = socket.data.sessionId;
            const playerInfo = sessionManager.getPlayerBySocket(socket.id);
            if (sessionId && playerInfo) {
                socket.to(`session:${sessionId}`).emit('cursor:updated', {
                    playerId: playerInfo.player.id,
                    nickname: playerInfo.player.nickname,
                    avatarColor: playerInfo.player.avatarColor,
                    row,
                    col
                });
            }
        });

        // --- ADMIN EVENTS ---
        socket.on('admin:join', () => {
            socket.join('admin:all');
            socket.emit('admin:telemetry_tick', {
                timestamp: Date.now(),
                sessions: sessionManager.getAllSessionsSummary()
            });
        });

        socket.on('admin:inspect_session', ({ sessionId }) => {
            // Leave any previous admin inspection room
            for (const room of socket.rooms) {
                if (room.startsWith('admin:session:')) {
                    socket.leave(room);
                }
            }
            if (sessionId) {
                socket.join(`admin:session:${sessionId}`);
                const logs = auditLogger.getSessionLogs(sessionId, 50);
                const leaderboard = auditLogger.getPlayerContributions(sessionId);
                socket.emit('admin:inspection_data', { sessionId, logs, leaderboard });
            }
        });

        socket.on('admin:control_timer', ({ sessionId, action }) => {
            try {
                const timer = sessionManager.setTimerState(sessionId, action);
                io.to(`session:${sessionId}`).emit('timer:sync', {
                    sessionId,
                    running: timer.running,
                    elapsedMs: timer.elapsedMs,
                    startedAt: timer.startedAt,
                    serverTime: Date.now()
                });
            } catch (err) {
                socket.emit('error:rejected', { message: err.message });
            }
        });

        socket.on('admin:reset_grid', ({ sessionId }) => {
            try {
                const session = sessionManager.resetGrid(sessionId);
                io.to(`session:${sessionId}`).emit('session:grid_reset', {
                    sessionId,
                    grid: session.currentGrid,
                    stats: session.stats
                });
                io.to(`session:${sessionId}`).emit('timer:sync', {
                    sessionId,
                    running: session.timer.running,
                    elapsedMs: session.timer.elapsedMs,
                    startedAt: session.timer.startedAt,
                    serverTime: Date.now()
                });
            } catch (err) {
                socket.emit('error:rejected', { message: err.message });
            }
        });

        socket.on('admin:lock_session', ({ sessionId, locked }) => {
            try {
                const session = sessionManager.lockSession(sessionId, locked);
                io.to(`session:${sessionId}`).emit('session:status_changed', {
                    sessionId,
                    status: session.status
                });
            } catch (err) {
                socket.emit('error:rejected', { message: err.message });
            }
        });

        socket.on('admin:fill_master', ({ sessionId }) => {
            try {
                const session = sessionManager.fillMasterGrid(sessionId);
                io.to(`session:${sessionId}`).emit('session:master_filled', {
                    sessionId,
                    grid: session.currentGrid,
                    stats: session.stats
                });
                io.to(`session:${sessionId}`).emit('session:completed', {
                    sessionId,
                    stats: session.stats,
                    leaderboard: auditLogger.getPlayerContributions(sessionId)
                });
            } catch (err) {
                socket.emit('error:rejected', { message: err.message });
            }
        });

        // Disconnect cleanup
        socket.on('disconnect', () => {
            const left = sessionManager.leavePlayer(socket.id);
            if (left) {
                io.to(`session:${left.session.id}`).emit('player:left', {
                    playerId: left.player.id,
                    nickname: left.player.nickname,
                    activeCount: left.session.players.size
                });
            }
        });
    });
}

module.exports = { setupSockets };
