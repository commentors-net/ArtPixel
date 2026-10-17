const db = require('../db/database');

const insertLogStmt = db.prepare(`
    INSERT INTO action_logs (
        session_id, player_id, player_nickname, action_type,
        row_idx, col_idx, coord_label, previous_color, placed_color,
        target_color, is_correct, server_timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getSessionLogsStmt = db.prepare(`
    SELECT 
        id, session_id, player_id, player_nickname, action_type,
        row_idx, col_idx, coord_label, previous_color, placed_color,
        target_color, is_correct, server_timestamp
    FROM action_logs
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
`);

const getAllSessionLogsStmt = db.prepare(`
    SELECT 
        id, session_id, player_id, player_nickname, action_type,
        row_idx, col_idx, coord_label, previous_color, placed_color,
        target_color, is_correct, server_timestamp
    FROM action_logs
    WHERE session_id = ?
    ORDER BY id ASC
`);

const getLeaderboardStmt = db.prepare(`
    SELECT 
        player_id,
        player_nickname,
        COUNT(*) as total_actions,
        SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_actions,
        ROUND((SUM(CASE WHEN is_correct = 1 THEN 1.0 ELSE 0.0 END) / COUNT(*)) * 100, 1) as accuracy_pct
    FROM action_logs
    WHERE session_id = ? AND action_type = 'PIXEL_PAINT'
    GROUP BY player_id, player_nickname
    ORDER BY correct_actions DESC, total_actions DESC
`);

const auditLogger = {
    logAction({
        sessionId, playerId, playerNickname, actionType,
        rowIdx, colIdx, coordLabel, previousColor, placedColor,
        targetColor, isCorrect, serverTimestamp
    }) {
        const ts = serverTimestamp || Date.now();
        const info = insertLogStmt.run(
            sessionId,
            playerId,
            playerNickname || 'Anonymous',
            actionType || 'PIXEL_PAINT',
            rowIdx !== undefined ? rowIdx : null,
            colIdx !== undefined ? colIdx : null,
            coordLabel || null,
            previousColor || '',
            placedColor || '',
            targetColor || '',
            isCorrect ? 1 : 0,
            ts
        );
        return {
            id: Number(info.lastInsertRowid),
            sessionId,
            playerId,
            playerNickname,
            actionType,
            rowIdx,
            colIdx,
            coordLabel,
            previousColor,
            placedColor,
            targetColor,
            isCorrect: Boolean(isCorrect),
            serverTimestamp: ts
        };
    },

    getSessionLogs(sessionId, limit = 100) {
        return getSessionLogsStmt.all(sessionId, limit).map(row => ({
            ...row,
            is_correct: Boolean(row.is_correct)
        }));
    },

    getAllSessionLogs(sessionId) {
        return getAllSessionLogsStmt.all(sessionId).map(row => ({
            ...row,
            is_correct: Boolean(row.is_correct)
        }));
    },

    getPlayerContributions(sessionId) {
        return getLeaderboardStmt.all(sessionId);
    }
};

module.exports = auditLogger;
