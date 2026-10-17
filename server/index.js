const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { restoreDatabaseFromGCS, backupDatabaseToGCS } = require('./services/cloudStorageSync');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

async function bootstrap() {
    // 1. Restore persistent database from GCS if running in Cloud Run
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../pixel_mission.db');
    await restoreDatabaseFromGCS(dbPath);


    // 2. Initialize database and services
    const db = require('./db/database');
    const { importExcelData } = require('./services/excelImporter');
    const { setupSockets } = require('./sockets/socketHandler');
    const adminRoutes = require('./routes/adminRoutes');
    const sessionRoutes = require('./routes/sessionRoutes');

    // 3. Seed Excel data if library is empty
    const excelFile = path.join(__dirname, '../Pixel_Mission_Sample_Images.xlsx');
    try {
        importExcelData(excelFile);
    } catch (err) {
        console.error('[Bootstrap] Failed to import Excel images:', err.message);
    }

    // 4. Routes
    app.use('/api/admin', adminRoutes);
    app.use('/api/sessions', sessionRoutes);

    // 5. Fallback navigation
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/admin.html'));
    });
    app.get('/game', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/game.html'));
    });

    // 6. Setup Real-Time WebSockets
    setupSockets(io);

    // 7. Graceful shutdown handler for Cloud Run container lifecycle
    const handleShutdown = async (signal) => {
        console.log(`\n[Server] Received ${signal}. Backing up database to GCS before exit...`);
        try {
            await backupDatabaseToGCS(db.dbPath, db);
        } catch (e) {
            console.error('[Server] Shutdown backup failed:', e.message);
        }
        process.exit(0);
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n======================================================`);
        console.log(`🚀 Pixel Mission Multiplayer Server is running!`);
        console.log(`👉 Player Lobby:     http://localhost:${PORT}`);
        console.log(`👉 Admin Dashboard: http://localhost:${PORT}/admin.html`);
        console.log(`======================================================\n`);
    });
}

bootstrap().catch(err => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
});
