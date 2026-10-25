jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/notification.service', () => ({
    notifyUser: jest.fn()
}));

const {
    decideNotification,
    FLAP_THRESHOLD
} = require('../src/services/monitorAlert.service');

const base = {
    notifiedStatus: null,
    isFlapping: false,
    status: 'UP',
    transition: null,
    recentTransitions: 0
};

describe('decideNotification', () => {
    test('notifies DOWN on a new outage', () => {
        const result = decideNotification({
            ...base,
            status: 'DOWN',
            transition: 'DOWN',
            recentTransitions: 1
        });

        expect(result.notify).toBe('DOWN');
        expect(result.next).toEqual({
            notifiedStatus: 'DOWN',
            isFlapping: false
        });
    });

    test('does not notify DOWN twice for the same outage', () => {
        const result = decideNotification({
            ...base,
            notifiedStatus: 'DOWN',
            status: 'DOWN',
            transition: 'DOWN',
            recentTransitions: 1
        });

        expect(result.notify).toBeNull();
    });

    test('notifies recovery after a notified outage', () => {
        const result = decideNotification({
            ...base,
            notifiedStatus: 'DOWN',
            status: 'UP',
            transition: 'UP',
            recentTransitions: 2
        });

        expect(result.notify).toBe('UP');
        expect(result.next.notifiedStatus).toBe('UP');
    });

    test('does not announce recovery if the outage was never announced', () => {
        const result = decideNotification({
            ...base,
            notifiedStatus: null,
            status: 'UP',
            transition: 'UP',
            recentTransitions: 1
        });

        expect(result.notify).toBeNull();
    });

    test('stays quiet below the flap threshold', () => {
        const result = decideNotification({
            ...base,
            status: 'DOWN',
            transition: 'DOWN',
            recentTransitions: FLAP_THRESHOLD - 1
        });

        expect(result.notify).toBe('DOWN');
    });

    test('announces flapping once the threshold is reached', () => {
        const result = decideNotification({
            ...base,
            notifiedStatus: 'DOWN',
            status: 'UP',
            transition: 'UP',
            recentTransitions: FLAP_THRESHOLD
        });

        expect(result.notify).toBe('FLAPPING');
        expect(result.next).toEqual({
            notifiedStatus: 'DOWN',
            isFlapping: true
        });
    });

    test('suppresses DOWN and UP while flapping', () => {
        const down = decideNotification({
            ...base,
            isFlapping: true,
            status: 'DOWN',
            transition: 'DOWN',
            recentTransitions: FLAP_THRESHOLD + 1
        });

        const up = decideNotification({
            ...base,
            isFlapping: true,
            notifiedStatus: 'DOWN',
            status: 'UP',
            transition: 'UP',
            recentTransitions: FLAP_THRESHOLD + 2
        });

        expect(down.notify).toBeNull();
        expect(up.notify).toBeNull();
    });

    test('sends one STABLE message once the window is quiet', () => {
        const result = decideNotification({
            ...base,
            isFlapping: true,
            notifiedStatus: 'DOWN',
            status: 'UP',
            transition: null,
            recentTransitions: 0
        });

        expect(result.notify).toBe('STABLE');
        expect(result.next).toEqual({
            notifiedStatus: 'UP',
            isFlapping: false
        });
    });

    test('does nothing on an ordinary check with no state change', () => {
        const result = decideNotification({
            ...base,
            notifiedStatus: 'UP',
            status: 'UP'
        });

        expect(result.notify).toBeNull();
        expect(result.next).toBeNull();
    });
});

describe('decideNotification: re-notify while down', () => {
    const stillDown = {
        ...base,
        notifiedStatus: 'DOWN',
        status: 'DOWN',
        transition: null,
        renotifyMinutes: 60
    };

    test('sends a reminder once the interval has elapsed', () => {
        const result = decideNotification({
            ...stillDown,
            secondsSinceNotified: 60 * 60
        });

        expect(result.notify).toBe('STILL_DOWN');
        expect(result.next).toEqual({
            notifiedStatus: 'DOWN',
            isFlapping: false
        });
    });

    test('does not remind before the interval has elapsed', () => {
        const result = decideNotification({
            ...stillDown,
            secondsSinceNotified: 60 * 60 - 1
        });

        expect(result.notify).toBeNull();
    });

    test('never reminds when re-notify is disabled', () => {
        const disabled = decideNotification({
            ...stillDown,
            renotifyMinutes: 0,
            secondsSinceNotified: 999999
        });

        const missing = decideNotification({
            ...stillDown,
            renotifyMinutes: undefined,
            secondsSinceNotified: 999999
        });

        expect(disabled.notify).toBeNull();
        expect(missing.notify).toBeNull();
    });

    test('does not remind while flapping', () => {
        const result = decideNotification({
            ...stillDown,
            isFlapping: true,
            recentTransitions: 2,
            secondsSinceNotified: 999999
        });

        expect(result.notify).toBeNull();
    });

    test('does not remind about an outage that was never announced', () => {
        const result = decideNotification({
            ...stillDown,
            notifiedStatus: null,
            secondsSinceNotified: 999999
        });

        expect(result.notify).toBeNull();
    });

    test('does not remind when the monitor is up', () => {
        const result = decideNotification({
            ...stillDown,
            status: 'UP',
            secondsSinceNotified: 999999
        });

        expect(result.notify).toBeNull();
    });
});