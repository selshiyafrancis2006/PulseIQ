BEGIN;

ALTER TABLE public.monitors
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ;

-- Preserve the existing result-based schedule for monitors already checked.
-- Monitors without a result become due immediately.
UPDATE public.monitors AS m
SET next_check_at = COALESCE(
    (
        SELECT mr.checked_at
        FROM public.monitor_results AS mr
        WHERE mr.monitor_id = m.id
        ORDER BY mr.checked_at DESC
        LIMIT 1
    ) + make_interval(secs => m.interval_seconds),
    NOW()
)
WHERE m.next_check_at IS NULL;

ALTER TABLE public.monitors
    ALTER COLUMN next_check_at SET DEFAULT NOW(),
    ALTER COLUMN next_check_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_monitors_due
    ON public.monitors (next_check_at, id)
    WHERE is_active = true;

COMMIT;
