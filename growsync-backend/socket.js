const { Server } = require('socket.io');

let io;

module.exports = {
    init: (httpServer) => {
        io = new Server(httpServer, {
            cors: {
                origin: [
                    "https://tesis-seven-phi.vercel.app",
                    process.env.FRONTEND_URL,
                    "http://localhost:3000",
                    "http://localhost:5173",
                ].filter(Boolean),
                methods: ["GET", "POST"],
                credentials: true,
            }
        });

        io.on('connection', (socket) => {
            console.log('Cliente conectado:', socket.id);

            // Unirse a una sala personal basada en el ID de usuario
            socket.on('join_room', (userId) => {
                if (userId) {
                    socket.join(userId);
                    console.log(`Usuario ${userId} unido a su sala`);
                }
            });

            socket.on('disconnect', () => {
                console.log('Cliente desconectado:', socket.id);
            });
        });

        return io;
    },
    getIO: () => {
        if (!io) {
            throw new Error('Socket.io no inicializado!');
        }
        return io;
    }
};
