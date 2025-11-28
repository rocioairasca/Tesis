const { Server } = require('socket.io');

let io;

module.exports = {
    init: (httpServer) => {
        io = new Server(httpServer, {
            cors: {
                origin: ["http://localhost:3000"],
                methods: ["GET", "POST"]
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
