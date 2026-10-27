BEGIN;

DO $migration$
DECLARE
    col RECORD;
    converted_count INTEGER := 0;
    naive_count INTEGER;
BEGIN
    IF current_setting('TimeZone') <> 'UTC' THEN
        RAISE EXCEPTION
            'Timestamp migration aborted: session TimeZone must be UTC, found %.',
            current_setting('TimeZone');
    END IF;
    SELECT COUNT(*)
    INTO naive_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone';

    IF naive_count <> 25 THEN
        RAISE EXCEPTION
            'Timestamp migration aborted: expected 25 naive timestamp columns, found %.',
            naive_count;
    END IF;

    FOR col IN
        SELECT
            c.table_name,
            c.column_name,
            c.column_default
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
          AND c.data_type = 'timestamp without time zone'
        ORDER BY c.table_name, c.ordinal_position
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
            'public', col.table_name, col.column_name
        );

        EXECUTE format(
            'ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE %L',
            'public',
            col.table_name,
            col.column_name,
            col.column_name,
            'UTC'
        );

        IF col.column_default IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',
                'public',
                col.table_name,
                col.column_name,
                col.column_default
            );
        END IF;

        converted_count := converted_count + 1;
    END LOOP;

    RAISE NOTICE 'Converted % timestamp columns to timestamptz.', converted_count;
END
$migration$;

COMMIT;
