BEGIN;

ALTER TABLE public.monitors
    ADD COLUMN IF NOT EXISTS check_claim_token UUID,
    ADD COLUMN IF NOT EXISTS check_claimed_until TIMESTAMPTZ;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'monitors_check_claim_pair'
          AND conrelid = 'public.monitors'::regclass
    ) THEN
        ALTER TABLE public.monitors
            ADD CONSTRAINT monitors_check_claim_pair
            CHECK (
                (check_claim_token IS NULL) =
                (check_claimed_until IS NULL)
            );
    END IF;
END
$migration$;

COMMIT;
