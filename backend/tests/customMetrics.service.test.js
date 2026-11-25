const {
    MAX_OBSERVATIONS,
    validateCollectedAt,
    sanitizeTags,
    validateCustomMetrics
} = require('../src/services/customMetrics.service');

const NOW = Date.parse('2026-11-23T08:42:00.000Z');

const validPayload = () => ({
    sample_id: '123e4567-e89b-42d3-a456-426614174000',
    collected_at: '2026-11-23T08:40:00.000Z',
    metrics: [{
        metric_name: 'disk_usage',
        value: 65.4,
        unit: '%',
        tags: { mount: '/', device: 'sda1' }
    }]
});

describe('customMetrics.service', () => {
    describe('validateCollectedAt', () => {
        test('accepts a valid timezone-aware timestamp', () => {
            expect(
                validateCollectedAt('2026-11-23T08:40:00.000Z', NOW)
            ).toBe('2026-11-23T08:40:00.000Z');
        });

        test('accepts December 31 as a valid calendar date', () => {
            expect(
                validateCollectedAt('2026-12-31T23:59:59Z', Date.parse('2027-01-01T00:00:00Z'))
            ).toBe('2026-12-31T23:59:59.000Z');
        });

        test('rejects timestamps without a timezone', () => {
            expect(
                validateCollectedAt('2026-11-23T08:40:00', NOW)
            ).toBeNull();
        });

        test('rejects impossible calendar dates', () => {
            expect(
                validateCollectedAt('2026-02-30T08:40:00Z', NOW)
            ).toBeNull();
        });

        test('rejects timestamps more than five minutes in the future', () => {
            expect(
                validateCollectedAt('2026-11-23T08:48:00Z', NOW)
            ).toBeNull();
        });
    });

    describe('sanitizeTags', () => {
        test('accepts flat string, number and boolean tags', () => {
            expect(sanitizeTags({
                mount: '/',
                index: 2,
                removable: false
            })).toEqual({
                mount: '/',
                index: 2,
                removable: false
            });
        });

        test('defaults missing tags to an empty object', () => {
            expect(sanitizeTags(undefined)).toEqual({});
        });

        test('rejects nested values', () => {
            expect(sanitizeTags({ device: { name: 'sda1' } })).toBeNull();
        });

        test('rejects more than the allowed number of tags', () => {
            const tags = Object.fromEntries(
                Array.from({ length: 11 }, (_, i) => [`tag${i}`, i])
            );

            expect(sanitizeTags(tags)).toBeNull();
        });

        test('rejects oversized tag values', () => {
            expect(sanitizeTags({ device: 'x'.repeat(129) })).toBeNull();
        });
    });

    describe('validateCustomMetrics', () => {
        test('accepts a valid custom metrics batch', () => {
            const result = validateCustomMetrics(validPayload(), NOW);

            expect(result.error).toBeUndefined();
            expect(result.value.metrics).toHaveLength(1);
            expect(result.value.metrics[0]).toEqual({
                metric_name: 'disk_usage',
                value: 65.4,
                unit: '%',
                tags: { mount: '/', device: 'sda1' }
            });
        });

        test('rejects a missing or invalid sample_id', () => {
            const payload = validPayload();
            payload.sample_id = 'invalid';

            expect(validateCustomMetrics(payload, NOW).error)
                .toBe('Invalid sample_id');
        });

        test('rejects missing or empty metrics', () => {
            const payload = validPayload();
            payload.metrics = [];

            expect(validateCustomMetrics(payload, NOW).error).toMatch(
                /between 1 and/
            );
        });

        test('rejects batches above the observation limit', () => {
            const payload = validPayload();
            payload.metrics = Array.from(
                { length: MAX_OBSERVATIONS + 1 },
                () => ({ metric_name: 'temperature', value: 25 })
            );

            expect(validateCustomMetrics(payload, NOW).error).toMatch(
                /between 1 and/
            );
        });

        test('rejects invalid metric names', () => {
            const payload = validPayload();
            payload.metrics[0].metric_name = '1invalid';

            expect(validateCustomMetrics(payload, NOW).error)
                .toBe('Invalid metric_name');
        });

        test('rejects non-finite and non-numeric values', () => {
            for (const value of [NaN, Infinity, '65.4', null]) {
                const payload = validPayload();
                payload.metrics[0].value = value;

                expect(validateCustomMetrics(payload, NOW).error)
                    .toMatch(/Invalid value/);
            }
        });

        test('rejects oversized units', () => {
            const payload = validPayload();
            payload.metrics[0].unit = 'x'.repeat(33);

            expect(validateCustomMetrics(payload, NOW).error)
                .toMatch(/Invalid unit/);
        });

        test('rejects invalid tags', () => {
            const payload = validPayload();
            payload.metrics[0].tags = { nested: ['invalid'] };

            expect(validateCustomMetrics(payload, NOW).error)
                .toMatch(/Invalid tags/);
        });

        test('rejects the entire batch when one observation is invalid', () => {
            const payload = validPayload();
            payload.metrics.push({
                metric_name: 'invalid name',
                value: 10
            });

            expect(validateCustomMetrics(payload, NOW).error)
                .toBe('Invalid metric_name');
        });
    });
});


