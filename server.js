const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const palette = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

function startTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.started) return; 

    clearInterval(room.timerInterval);
    room.timeLeft = 15;
    io.to(roomCode).emit('timerUpdate', room.timeLeft);

    room.timerInterval = setInterval(() => {
        room.timeLeft--;
        io.to(roomCode).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timerInterval);
            if (room.availableLines && room.availableLines.length > 0) {
                const randomIndex = Math.floor(Math.random() * room.availableLines.length);
                const randomLineId = room.availableLines.splice(randomIndex, 1)[0];
                room.moveHistory.push(randomLineId);
                io.to(roomCode).emit('receiveMove', randomLineId);
                startTurnTimer(roomCode); 
            }
        }
    }, 1000);
}

function stopTurnTimer(roomCode) {
    if (rooms[roomCode]) clearInterval(rooms[roomCode].timerInterval);
}

io.on('connection', (socket) => {
    socket.on('createGame', (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const sessionId = Math.random().toString(36).substring(2, 15);
        rooms[roomCode] = { 
            boardSize: userData.boardSize,
            started: false,
            moveHistory: [], 
            availableLines: [],
            timerInterval: null,
            timeLeft: 15,
            players: [{ id: socket.id, sessionId, name: userData.name, color: userData.color }] 
        };
        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, sessionId });
        io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: socket.id, players: rooms[roomCode].players });
    });

    socket.on('joinGame', (userData) => {
        const roomCode = userData.roomCode;
        if (!rooms[roomCode]) return socket.emit('errorMsg', 'Invalid Room Code.');
        const room = rooms[roomCode];
        
        if (room.started || room.players.length >= 4) {
            socket.join(roomCode);
            return socket.emit('spectatorJoined', { roomCode, boardSize: room.boardSize, players: room.players, moveHistory: room.moveHistory });
        }

        let finalColor = userData.color;
        const usedColors = room.players.map(p => p.color);
        if (usedColors.includes(finalColor)) {
            finalColor = palette.find(c => !usedColors.includes(c)) || palette[0];
        }

        const sessionId = Math.random().toString(36).substring(2, 15);
        room.players.push({ id: socket.id, sessionId, name: userData.name, color: finalColor });
        socket.join(roomCode);
        socket.emit('joinSuccess', { sessionId });
        io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: room.players[0].id, players: room.players });
    });

    socket.on('rejoinGame', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            const playerIndex = room.players.findIndex(p => p.sessionId === data.sessionId);
            if (playerIndex !== -1) {
                room.players[playerIndex].id = socket.id;
                socket.join(data.roomCode);
                socket.emit('rejoinSuccess', { roomCode: data.roomCode, boardSize: room.boardSize, players: room.players, myPlayerIndex: playerIndex, moveHistory: room.moveHistory, gameStarted: room.started });
                return;
            }
        }
        socket.emit('errorMsg', 'Session expired. Please join as a new player.');
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = true;
            room.moveHistory = [];
            room.availableLines = [];
            for (let r = 0; r < room.boardSize; r++) {
                for (let c = 0; c < room.boardSize; c++) {
                    if (c < room.boardSize - 1) room.availableLines.push(`h-${r}-${c}`);
                    if (r < room.boardSize - 1) room.availableLines.push(`v-${r}-${c}`);
                }
            }
            io.to(roomCode).emit('gameStarted', room);
            startTurnTimer(roomCode);
        }
    });

    socket.on('makeMove', ({ roomCode, lineId }) => {
        const room = rooms[roomCode];
        if (room && room.availableLines.includes(lineId)) {
            room.availableLines = room.availableLines.filter(id => id !== lineId);
            room.moveHistory.push(lineId);
            io.to(roomCode).emit('receiveMove', lineId);
            startTurnTimer(roomCode); 
        }
    });

    socket.on('gameOver', (roomCode) => stopTurnTimer(roomCode));

    socket.on('requestRematch', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = false;
            room.moveHistory = [];
            room.availableLines = [];
            stopTurnTimer(roomCode);
            io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: room.players[0].id, players: room.players });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));