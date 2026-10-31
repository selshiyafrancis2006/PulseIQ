BEGIN;

ALTER TABLE notification_channels
    ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE notification_channels
    ALTER COLUMN url DROP NOT NULL;

ALTER TABLE notification_channels
    DROP CONSTRAINT IF EXISTS notification_channels_type_check;

ALTER TABLE notification_channels
    ADD CONSTRAINT notification_channels_type_check
    CHECK (type IN ('slack', 'webhook', 'email'));

ALTER TABLE notification_channels
    DROP CONSTRAINT IF EXISTS notification_channels_destination_check;

ALTER TABLE notification_channels
    ADD CONSTRAINT notification_channels_destination_check
    CHECK (
        (
            type IN ('slack', 'webhook')
            AND url IS NOT NULL
            AND length(trim(url)) > 0
            AND email IS NULL
        )
        OR
        (
            type = 'email'
            AND url IS NULL
            AND email IS NOT NULL
            AND length(trim(email)) > 0
        )
    );

COMMIT;
