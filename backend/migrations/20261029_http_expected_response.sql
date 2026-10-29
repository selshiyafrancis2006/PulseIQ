BEGIN;

-- Add optional HTTP response expectations to existing deployments.
ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS expected_status_codes JSONB,
    ADD COLUMN IF NOT EXISTS expected_keyword VARCHAR(500),
    ADD COLUMN IF NOT EXISTS max_response_time_ms INTEGER;

-- Validate JSON arrays at the database level as well as in the API.
CREATE OR REPLACE FUNCTION public.is_valid_http_status_codes(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    item JSONB;
    code NUMERIC;
    seen_codes INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
    IF value IS NULL THEN
        RETURN TRUE;
    END IF;

    IF jsonb_typeof(value) <> 'array' THEN
        RETURN FALSE;
    END IF;

    IF jsonb_array_length(value) NOT BETWEEN 1 AND 20 THEN
        RETURN FALSE;
    END IF;

    FOR item IN
        SELECT jsonb_array_elements(value)
    LOOP
        IF jsonb_typeof(item) <> 'number' THEN
            RETURN FALSE;
        END IF;

        code := (item #>> '{}')::NUMERIC;

        IF code <> trunc(code) OR code < 100 OR code > 599 THEN
            RETURN FALSE;
        END IF;

        IF code::INTEGER = ANY(seen_codes) THEN
            RETURN FALSE;
        END IF;

        seen_codes := array_append(seen_codes, code::INTEGER);
    END LOOP;

    RETURN TRUE;
END;
$function$;

-- Replace the earlier shape-only constraint with full validation.
ALTER TABLE monitors
    DROP CONSTRAINT IF EXISTS monitors_expected_status_codes_check;

ALTER TABLE monitors
    ADD CONSTRAINT monitors_expected_status_codes_check
    CHECK (public.is_valid_http_status_codes(expected_status_codes));

-- Enforce the response-time limit for existing and future rows.
ALTER TABLE monitors
    DROP CONSTRAINT IF EXISTS monitors_max_response_time_check;

ALTER TABLE monitors
    ADD CONSTRAINT monitors_max_response_time_check
    CHECK (
        max_response_time_ms IS NULL
        OR max_response_time_ms BETWEEN 1 AND 30000
    );

COMMIT;
