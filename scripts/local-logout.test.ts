import { expect, test } from 'bun:test';
import { logoutWithConfirmation } from './local-logout';

test('retries through combat cooldown even when every button dispatch succeeds', async () => {
    let clock = 0;
    let attempts = 0;
    let disconnected = false;
    await logoutWithConfirmation({
        now: () => clock,
        wait: async ms => { clock += ms; },
        isLoggedOut: async () => disconnected,
        request: async () => {
            attempts++;
            // Models the server dropping early requests during its 10-second cooldown.
            if (clock >= 10000) disconnected = true;
        },
    });
    expect(attempts).toBe(6);
    expect(disconnected).toBe(true);
    expect(clock).toBeGreaterThanOrEqual(10000);
});

test('never reports successful logout without an observed disconnection', async () => {
    let clock = 0;
    await expect(logoutWithConfirmation({
        now: () => clock,
        wait: async ms => { clock += ms; },
        timeoutMs: 5000,
        isLoggedOut: async () => false,
        request: async () => {},
    })).rejects.toThrow('Logout was not confirmed');
});

test('accepts a confirmed disconnect during the button request', async () => {
    let disconnected = false;
    await logoutWithConfirmation({
        isLoggedOut: async () => disconnected,
        request: async () => { disconnected = true; throw new Error('Client disconnected'); },
    });
});

test('connection errors are not mistaken for a successful logout', async () => {
    await expect(logoutWithConfirmation({
        isLoggedOut: async () => { throw new Error('Gateway unavailable'); },
        request: async () => {},
    })).rejects.toThrow('Gateway unavailable');
});
