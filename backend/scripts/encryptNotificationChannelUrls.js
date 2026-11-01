const pool = require('../src/config/db');
const {
    encryptUrl,
    decryptUrl
} = require('../src/services/notificationChannelCrypto.service');

async function migrateNotificationChannelUrls() {
    const client = await pool.connect();
    let encryptedCount = 0;
    let alreadyEncryptedCount = 0;

    try {
        await client.query('BEGIN');

        const result = await client.query(`
            SELECT id, url
            FROM notification_channels
            WHERE type IN ('slack', 'webhook')
              AND url IS NOT NULL
            ORDER BY id
            FOR UPDATE
        `);

        for (const row of result.rows) {
            if (row.url.startsWith('enc:v1:')) {
                // Validate existing ciphertext against the configured key.
                decryptUrl(row.url);
                alreadyEncryptedCount++;
                continue;
            }

            const encryptedUrl = encryptUrl(row.url);

            await client.query(
                `UPDATE notification_channels
                 SET url = $1
                 WHERE id = $2`,
                [encryptedUrl, row.id]
            );

            encryptedCount++;
        }

        await client.query('COMMIT');

        console.log('Notification channel URL migration completed.');
        console.log(`Newly encrypted URLs: ${encryptedCount}`);
        console.log(`Already encrypted URLs validated: ${alreadyEncryptedCount}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Notification channel URL migration failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrateNotificationChannelUrls().catch(() => {
    process.exitCode = 1;
});
