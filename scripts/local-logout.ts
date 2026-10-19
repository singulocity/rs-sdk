type LogoutAttempt = {
    request: () => Promise<void>;
    isLoggedOut: () => Promise<boolean>;
    wait?: (ms: number) => Promise<unknown>;
    now?: () => number;
    timeoutMs?: number;
};

// A successful button dispatch is not proof of logout: combat consumes/rejects
// the request. Retry until the game client really disconnects.
export async function logoutWithConfirmation({
    request, isLoggedOut, wait = Bun.sleep, now = Date.now, timeoutMs = 90000,
}: LogoutAttempt): Promise<void> {
    const deadline = now() + timeoutMs;
    let lastError: unknown;
    while (now() < deadline) {
        if (await isLoggedOut()) return;
        try {
            await request();
        } catch (error) {
            // The client can disconnect between our check and the button request, and the
            // gateway may take a moment to report it dead. Keep polling instead of failing.
            lastError = error;
        }
        for (let poll = 0; poll < 4 && now() < deadline; poll++) {
            await wait(500);
            if (await isLoggedOut()) return;
        }
    }
    const detail = lastError instanceof Error ? ' Last error: ' + lastError.message : '';
    throw new Error('Logout was not confirmed within 90 seconds. Combat or another game restriction may still be blocking it; the server will remain running.' + detail);
}

if (import.meta.main) {
    const { runScript } = await import('../sdk/runner');
    const result = await runScript(async ({ bot, sdk }) => {
        const name = process.env.BOT_USERNAME;
        if (!name) throw new Error('No configured bot username.');
        // The local lite client exits on game logout. A stale state frame alone
        // is not evidence; require the gateway to report its client as dead.
        const isLoggedOut = async () => {
            const response = await fetch(
                'http://127.0.0.1:7780/state/' + encodeURIComponent(name),
                { signal: AbortSignal.timeout(3000) },
            );
            if (!response.ok) {
                throw new Error('Cannot confirm logout: gateway returned ' + response.status);
            }
            const status = await response.json() as { botStatus?: string };
            return status.botStatus === 'dead';
        };
        let attempts = 0;
        await logoutWithConfirmation({
            isLoggedOut,
            request: async () => {
                if (attempts++ === 0) {
                    await bot.dismissBlockingUI();
                    await sdk.sendSetTab(10);
                    await sdk.waitForTicks(1);
                }
                const action = await sdk.sendClickComponent(2458);
                if (!action.success) throw new Error(action.message);
                if (attempts === 1 || attempts % 5 === 0) {
                    console.log('Logout requested; waiting for server confirmation (combat may block it).');
                }
            },
        });
        console.log('Logout confirmed: the game client disconnected.');
    }, { onDisconnect: 'ignore', printState: false, timeout: 100000 });
    if (!result.success) process.exitCode = 1;
}
