const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');

// GET /api/sessions - List public active sessions
router.get('/', (req, res) => {
    try {
        const summaries = sessionManager.getAllSessionsSummary().map(s => ({
            id: s.id,
            name: s.name,
            imageTitle: s.imageTitle,
            theme: s.theme,
            difficulty: s.difficulty,
            width: s.width,
            height: s.height,
            status: s.status,
            maxPlayers: s.maxPlayers,
            activePlayersCount: s.activePlayersCount,
            completedPercent: s.completedPercent,
            elapsedMs: s.elapsedMs,
            timerRunning: s.timerRunning
        }));
        res.json({ success: true, data: summaries });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/sessions/:id - Get session info for joining
router.get('/:id', (req, res) => {
    try {
        const session = sessionManager.getSession(req.params.id);
        if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

        const image = sessionManager.getImage(session.imageId);
        let elapsed = session.timer.elapsedMs;
        if (session.timer.running && session.timer.startedAt) {
            elapsed += (Date.now() - session.timer.startedAt);
        }

        res.json({
            success: true,
            data: {
                id: session.id,
                name: session.name,
                status: session.status,
                imageTitle: image ? image.title : 'Pixel Mission',
                theme: image ? image.theme : '',
                difficulty: image ? image.difficulty : '',
                width: session.width,
                height: session.height,
                colHeaders: session.colHeaders,
                rowHeaders: session.rowHeaders,
                palette: session.palette,
                currentGrid: session.currentGrid,
                stats: session.stats,
                elapsedMs: elapsed,
                timerRunning: session.timer.running,
                playersCount: session.players.size,
                maxPlayers: session.maxPlayers
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
