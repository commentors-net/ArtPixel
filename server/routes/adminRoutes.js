const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');
const auditLogger = require('../services/auditLogger');

// GET /api/admin/images - List all available images
router.get('/images', (req, res) => {
    try {
        const images = sessionManager.getAllImages();
        res.json({ success: true, data: images });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/sessions - List all sessions
router.get('/sessions', (req, res) => {
    try {
        const summaries = sessionManager.getAllSessionsSummary();
        res.json({ success: true, data: summaries });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/admin/sessions - Create single or batch sessions
router.post('/sessions', (req, res) => {
    try {
        const { imageId, count, baseName, maxPlayers } = req.body;
        if (!imageId) {
            return res.status(400).json({ success: false, error: 'imageId is required' });
        }
        const sessions = sessionManager.createBatchSessions({
            imageId,
            count: parseInt(count, 10) || 1,
            baseName,
            maxPlayers: parseInt(maxPlayers, 10) || 10
        });
        res.json({ success: true, count: sessions.length, data: sessions.map(s => s.id) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', (req, res) => {
    try {
        const ok = sessionManager.deleteSession(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Session not found' });
        res.json({ success: true, message: 'Session deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/admin/sessions/:id/reset
router.post('/sessions/:id/reset', (req, res) => {
    try {
        const session = sessionManager.resetGrid(req.params.id);
        res.json({ success: true, message: 'Grid reset successfully', data: session.stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/admin/sessions/:id/fill-master
router.post('/sessions/:id/fill-master', (req, res) => {
    try {
        const session = sessionManager.fillMasterGrid(req.params.id);
        res.json({ success: true, message: 'Master grid filled', data: session.stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/admin/sessions/:id/lock
router.post('/sessions/:id/lock', (req, res) => {
    try {
        const { locked } = req.body;
        const session = sessionManager.lockSession(req.params.id, Boolean(locked));
        res.json({ success: true, status: session.status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/admin/sessions/:id/timer
router.post('/sessions/:id/timer', (req, res) => {
    try {
        const { action } = req.body;
        const timer = sessionManager.setTimerState(req.params.id, action);
        res.json({ success: true, timer });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/sessions/:id/logs
router.get('/sessions/:id/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 100;
        const logs = auditLogger.getSessionLogs(req.params.id, limit);
        res.json({ success: true, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/sessions/:id/leaderboard
router.get('/sessions/:id/leaderboard', (req, res) => {
    try {
        const leaderboard = auditLogger.getPlayerContributions(req.params.id);
        res.json({ success: true, data: leaderboard });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/sessions/:id/export - Export logs as CSV or JSON
router.get('/sessions/:id/export', (req, res) => {
    try {
        const logs = auditLogger.getAllSessionLogs(req.params.id);
        const format = req.query.format === 'json' ? 'json' : 'csv';

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="audit_${req.params.id}.json"`);
            return res.json(logs);
        }

        // CSV export
        const headers = ['id', 'server_timestamp', 'time_iso', 'player_id', 'player_nickname', 'action_type', 'coord_label', 'row_idx', 'col_idx', 'previous_color', 'placed_color', 'target_color', 'is_correct'];
        const csvRows = [headers.join(',')];

        for (const row of logs) {
            const values = [
                row.id,
                row.server_timestamp,
                `"${new Date(row.server_timestamp).toISOString()}"`,
                `"${row.player_id}"`,
                `"${(row.player_nickname || '').replace(/"/g, '""')}"`,
                row.action_type,
                `"${row.coord_label || ''}"`,
                row.row_idx,
                row.col_idx,
                `"${row.previous_color || ''}"`,
                `"${row.placed_color || ''}"`,
                `"${row.target_color || ''}"`,
                row.is_correct ? 1 : 0
            ];
            csvRows.push(values.join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="audit_${req.params.id}.csv"`);
        res.send(csvRows.join('\n'));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
