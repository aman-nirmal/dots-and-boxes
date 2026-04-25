const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const palette = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

// --- TIMER LOGIC ---
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
            // Save the timeout to history so page refreshes don't break the turn order
            room.moveHistory.push({ type: 'timeout' }); 
            io.to(roomCode).emit('turnTimeout');
            startTurnTimer(roomCode);
        }
    }, 1000);
}

function stopTurnTimer(roomCode) {
    if (rooms[roomCode]) clearInterval(rooms[roomCode].timerInterval);
}

// --- SOCKET EVENTS ---
io.on('connection', (socket) => {

    socket.on('createGame', (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const sessionId = Math.random().toString(36).substring(2, 15);
        
        rooms[roomCode] = { 
            boardSize: userData.boardSize,
            started: false,
            moveHistory: [], 
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
            socket.emit('spectatorJoined', { 
                roomCode, boardSize: room.boardSize, 
                players: room.players, moveHistory: room.moveHistory 
            });
            return;
        }

        let finalColor = userData.color;
        const usedColors = room.players.map(p => p.color);
        if (usedColors.includes(finalColor)) finalColor = palette.find(c => !usedColors.includes(c));

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
                
                socket.emit('rejoinSuccess', {
                    roomCode: data.roomCode,
                    boardSize: room.boardSize,
                    players: room.players,
                    myPlayerIndex: playerIndex,
                    moveHistory: room.moveHistory,
                    gameStarted: room.started
                });
                return;
            }
        }
        socket.emit('errorMsg', 'Session expired. Please join as a new player.');
    });

    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].started = true;
            rooms[roomCode].moveHistory = []; // Reset history on new game
            io.to(roomCode).emit('gameStarted', rooms[roomCode]);
            startTurnTimer(roomCode);
        }
    });

    socket.on('makeMove', ({ roomCode, moveData }) => {
        const room = rooms[roomCode];
        if (room) {
            room.moveHistory.push(moveData);
            io.to(roomCode).emit('receiveMove', moveData);
            startTurnTimer(roomCode); // Restart timer on valid move
        }
    });

    socket.on('sendChat', (data) => io.to(data.roomCode).emit('receiveChat', data));

    // Kills the timer when someone wins
    socket.on('gameOver', (roomCode) => stopTurnTimer(roomCode));

    socket.on('requestRematch', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = false;
            room.moveHistory = [];
            stopTurnTimer(roomCode);
            io.to(roomCode).emit('returnToLobby', room.players);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));