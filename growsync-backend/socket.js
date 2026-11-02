const { Server } = require('socket.io');
const { createSocketAuthentication, unauthorized } = require('./services/socketAuthentication');

const userRoom = userId => `user:${userId}`;
const REVALIDATE_MS = 30000;
let io;
let notify;

// Dependencies are injectable for local tests; production always uses checkJwt.
function createNotificationServer(httpServer, { checkJwt, db, revalidateMs = REVALIDATE_MS } = {}) {
    const auth = createSocketAuthentication({
        checkJwt: checkJwt || require('./middleware/checkJwt'),
        db: db || require('./db/supabaseClient'),
    });
    const server = new Server(httpServer, {
        cors: {
            origin: [
                'https://tesis-seven-phi.vercel.app', process.env.FRONTEND_URL,
                'http://localhost:3000', 'http://localhost:5173',
            ].filter(Boolean),
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });
    server.use(async (socket, next) => {
        try {
            const session = await auth.authenticate(socket.handshake.auth?.token);
            // Do not retain the credential in socket handshake/request data.
            socket.handshake.auth = {};
            socket.data = { ...session };
            next();
        } catch {
            socket.handshake.auth = {};
            next(unauthorized());
        }
    });
    server.on('connection', socket => {
        socket.join(userRoom(socket.data.userId));
        // No join_room handler: the client cannot choose a recipient or tenant.
        let checking = false;
        const interval = setInterval(async () => {
            if (checking || !socket.connected) return;
            checking = true;
            try { await auth.revalidate(socket.data); }
            catch { socket.disconnect(true); }
            finally { checking = false; }
        }, revalidateMs);
        // Chunk long TTLs to avoid Node's 32-bit timeout overflow.
        let expiry;
        const expire = () => {
            const remaining = socket.data.expiresAt - Date.now();
            if (remaining <= 0) { socket.disconnect(true); return; }
            expiry = setTimeout(expire, Math.min(remaining, 2147483647));
            expiry.unref?.();
        };
        socket.once('disconnect', () => { clearInterval(interval); clearTimeout(expiry); });
        expire();
        interval.unref?.();
    });

    async function emitNotification(notification) {
        const ids = server.sockets.adapter.rooms.get(userRoom(notification.user_id));
        if (!ids) return;
        await Promise.all([...ids].map(async id => {
            const socket = server.sockets.sockets.get(id);
            if (!socket?.connected) return;
            try {
                // A disabled/moved user must not receive an event between periodic checks.
                await auth.revalidate(socket.data);
                if (notification.company_id && notification.company_id !== socket.data.companyId) return;
                if (socket.connected) socket.emit('new_notification', notification);
            } catch { socket.disconnect(true); }
        }));
    }
    return { io: server, emitNotification };
}

module.exports = {
    userRoom,
    createNotificationServer,
    init(httpServer) {
        const channel = createNotificationServer(httpServer);
        io = channel.io;
        notify = channel.emitNotification;
        return io;
    },
    getIO() {
        if (!io) throw new Error('Socket.io no inicializado!');
        return io;
    },
    async emitNotification(notification) {
        if (!notify) throw new Error('Socket.io no inicializado!');
        await notify(notification);
    },
};
