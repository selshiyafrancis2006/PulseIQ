jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

const pool = require('../src/config/db');
const {
    loadJobRuns,
    loadJobRunsStrict
} = require('../src/services/jobRunStore.service');

describe('job run store - strict loading', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('strict loader propagates database errors', async () => {
        const error = new Error('Database unavailable');
        pool.query.mockRejectedValueOnce(error);

        await expect(loadJobRunsStrict()).rejects.toBe(error);

        expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('safe loader logs database errors and returns an empty array', async () => {
        pool.query.mockRejectedValueOnce(
            new Error('Database unavailable')
        );

        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            await expect(loadJobRuns()).resolves.toEqual([]);

            expect(errorSpy).toHaveBeenCalledWith(
                'Could not load saved job run state:',
                'Database unavailable'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });
});
