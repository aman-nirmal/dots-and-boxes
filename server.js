const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
// The same 12-color palette available on the frontend
const palette = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

io.on('connection', (socket) => {
    socket.on('createGame', (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = { players: [{ id: socket.id, name: userData.name, color: userData.color }] };
        socket.join(roomCode);
        socket.emit('gameCreated', roomCode);
    });

    socket.on('joinGame', (userData) => {
        const roomCode = userData.roomCode;
        if (rooms[roomCode] && rooms[roomCode].players.length === 1) {
            const p1Color = rooms[roomCode].players[0].color;
            let finalP2Color = userData.color;

            // Prevent players from having the exact same color
            if (finalP2Color === p1Color) {
                finalP2Color = palette.find(c => c !== p1Color);
            }

            rooms[roomCode].players.push({ id: socket.id, name: userData.name, color: finalP2Color });
            socket.join(roomCode);
            
            io.to(roomCode).emit('gameStarted', {
                roomCode,
                p1Name: rooms[roomCode].players[0].name,
                p1Color: p1Color,
                p2Name: userData.name,
                p2Color: finalP2Color
            });
        } else {
            socket.emit('errorMsg', 'Invalid code or room is full.');
        }
    });

    socket.on('makeMove', ({ roomCode, moveData }) => {
        io.to(roomCode).emit('receiveMove', moveData);
    });

    socket.on('requestRematch', (roomCode) => {
        io.to(roomCode).emit('resetBoard');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));