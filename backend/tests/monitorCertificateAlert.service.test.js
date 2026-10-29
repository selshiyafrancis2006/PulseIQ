jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/notification.service', () => ({
    notifyUser: jest.fn()
}));

const db = require('../src/config/db');
const { notifyUser } = require('../src/services/notification.service');

const {
    getCertificateAlertLevel,
    getCertificateAlertEvent,
    processCertificateAlert
} = require('../src/services/monitorCertificateAlert.service');

describe('monitorCertificateAlert.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        [30, 0],
        [15, 0],
        [14, 1],
        [8, 1],
        [7, 2],
        [2, 2],
        [1, 3],
        [0, 3],
        [-1, 4],
        [null, 0],
        [undefined, 0]
    ])('days remaining %s gives alert level %s', (days, expected) => {
        expect(getCertificateAlertLevel(days)).toBe(expected);
    });

    test('uses certificate-specific event types and messages', () => {
        expect(getCertificateAlertEvent(1).type).toBe('CERTIFICATE_EXPIRING');
        expect(getCertificateAlertEvent(4).type).toBe('CERTIFICATE_EXPIRED');
        expect(getCertificateAlertEvent(0)).toBeNull();
    });

    test('does nothing when certificate expiry data is missing', async () => {
        await processCertificateAlert(
            { id: 1, user_id: 2 },
            { certificateExpiresAt: null, certificateDaysRemaining: 5 }
        );

        expect(db.query).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('records certificate expiry outside the warning window without notifying', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ last_alert_level: 0 }] });

        await processCertificateAlert(
            { id: 1, user_id: 2 },
            {
                certificateExpiresAt: '2027-01-15T12:00:00.000Z',
                certificateDaysRemaining: 30
            }
        );

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][0]).toContain(
            'monitor_certificate_alert_state'
        );
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('sends an alert when a threshold is reached and a channel succeeds', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ last_alert_level: 0 }] })
            .mockResolvedValueOnce({ rows: [] });

        notifyUser.mockResolvedValue([{ channel_id: 1, ok: true, error: null }]);

        await processCertificateAlert(
            { id: 1, user_id: 2, name: 'Example', url: 'https://example.com' },
            {
                certificateExpiresAt: '2027-01-15T12:00:00.000Z',
                certificateDaysRemaining: 7
            }
        );

        expect(notifyUser).toHaveBeenCalledWith(2, expect.objectContaining({
            type: 'CERTIFICATE_EXPIRING',
            message: 'SSL certificate expires within 7 days',
            certificateDaysRemaining: 7
        }));

        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining('SET last_alert_level = $2'),
            [1, 2]
        );
    });

    test('records the attempted threshold even when notification delivery fails', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ last_alert_level: 0 }] })
            .mockResolvedValueOnce({ rows: [] });

        notifyUser.mockResolvedValue([
            { channel_id: 1, ok: false, error: 'failed' }
        ]);

        await processCertificateAlert(
            { id: 1, user_id: 2, name: 'Example', url: 'https://example.com' },
            {
                certificateExpiresAt: '2027-01-15T12:00:00.000Z',
                certificateDaysRemaining: 14
            }
        );

        expect(db.query).toHaveBeenCalledTimes(2);
        expect(db.query.mock.calls[1][0]).toContain('SET last_alert_level = $2');
        expect(db.query.mock.calls[1][1]).toEqual([1, 1]);
        expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    test('does not retry a failed notification at an already attempted threshold', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ last_alert_level: 1 }] });

        await processCertificateAlert(
            { id: 1, user_id: 2, name: 'Example', url: 'https://example.com' },
            {
                certificateExpiresAt: '2027-01-15T12:00:00.000Z',
                certificateDaysRemaining: 14
            }
        );

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('does not repeat an alert level already recorded for the same expiry', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ last_alert_level: 2 }] });

        await processCertificateAlert(
            { id: 1, user_id: 2, name: 'Example', url: 'https://example.com' },
            {
                certificateExpiresAt: '2027-01-15T12:00:00.000Z',
                certificateDaysRemaining: 7
            }
        );

        expect(notifyUser).not.toHaveBeenCalled();
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

    test('resets the alert level when the certificate expiry date changes', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ last_alert_level: 0 }] })
            .mockResolvedValueOnce({ rows: [] });

        notifyUser.mockResolvedValue([{ channel_id: 1, ok: true, error: null }]);

        await processCertificateAlert(
            { id: 1, user_id: 2, name: 'Renewed site', url: 'https://example.com' },
            {
                certificateExpiresAt: '2027-02-15T12:00:00.000Z',
                certificateDaysRemaining: 7
            }
        );

        expect(db.query.mock.calls[0][0]).toContain(
            'IS DISTINCT FROM EXCLUDED.certificate_expires_at'
        );
        expect(notifyUser).toHaveBeenCalledWith(2, expect.objectContaining({
            certificateExpiresAt: '2027-02-15T12:00:00.000Z',
            message: 'SSL certificate expires within 7 days'
        }));
    });
