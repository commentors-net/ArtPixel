const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const bucketName = process.env.GCS_BUCKET;
let storage = null;
let isSyncing = false;

function getStorage() {
    if (!storage && bucketName) {
        storage = new Storage();
    }
    return storage;
}

async function restoreDatabaseFromGCS(targetPath) {
    if (!bucketName) {
        console.log('[GCS Sync] GCS_BUCKET environment variable not set. Running in local filesystem mode.');
        return false;
    }

    try {
        const gcs = getStorage();
        const bucket = gcs.bucket(bucketName);
        const fileName = path.basename(targetPath);
        const file = bucket.file(fileName);

        const [exists] = await file.exists();
        if (exists) {
            console.log(`[GCS Sync] Restoring database from gs://${bucketName}/${fileName} -> ${targetPath}...`);
            await file.download({ destination: targetPath });
            console.log(`[GCS Sync] Database restored successfully (${fs.statSync(targetPath).size} bytes).`);
            return true;
        } else {
            console.log(`[GCS Sync] gs://${bucketName}/${fileName} does not exist yet. Will create and seed new database.`);
            return false;
        }
    } catch (err) {
        console.error('[GCS Sync] Error restoring from GCS:', err.message);
        return false;
    }
}

async function backupDatabaseToGCS(sourcePath, dbInstance) {
    if (!bucketName || isSyncing) return;
    if (!fs.existsSync(sourcePath)) return;

    isSyncing = true;
    try {
        if (dbInstance) {
            try {
                // Checkpoint WAL before snapshotting
                dbInstance.exec('PRAGMA wal_checkpoint(PASSIVE);');
            } catch (e) {}
        }

        const gcs = getStorage();
        const bucket = gcs.bucket(bucketName);
        const fileName = path.basename(sourcePath);

        await bucket.upload(sourcePath, {
            destination: fileName,
            metadata: {
                cacheControl: 'no-cache'
            }
        });
        console.log(`[GCS Sync] Backed up ${fileName} to gs://${bucketName}/${fileName} (${fs.statSync(sourcePath).size} bytes).`);
    } catch (err) {
        console.error('[GCS Sync] Backup failed:', err.message);
    } finally {
        isSyncing = false;
    }
}

module.exports = {
    restoreDatabaseFromGCS,
    backupDatabaseToGCS
};
