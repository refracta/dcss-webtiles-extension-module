// The W3C adapter does not expose terminate(). Keep its transport-specific
// teardown here so a dead TCP connection cannot hold a recording open forever.
export function terminateSocket(socket, reason = 'connection closed') {
    if (!socket || socket.readyState === 3) return;
    socket.failureReason = reason;
    if (socket._connection) {
        socket._connection.drop(4000, reason, true);
    } else {
        const client = socket._client;
        socket.close();
        client.abort();
    }
}

export function watchSocket(socket, {
    connectTimeoutMs = 20_000,
    idleTimeoutMs = 90_000,
    label = 'websocket'
} = {}) {
    let timer;
    const stop = () => clearTimeout(timer);
    const arm = (phase, timeoutMs) => {
        stop();
        timer = setTimeout(() => {
            const reason = `${phase} timeout after ${timeoutMs}ms`;
            console.error(new Date().toISOString(), `[${label}] ${reason}`);
            terminateSocket(socket, reason);
        }, timeoutMs);
        timer.unref();
    };
    const received = () => {
        if (socket.readyState === 1) arm('receive', idleTimeoutMs);
    };
    socket.addEventListener('open', received);
    socket.addEventListener('message', received);
    socket.addEventListener('close', stop);
    socket.addEventListener('error', stop);
    arm('connect', connectTimeoutMs);
    return stop;
}
