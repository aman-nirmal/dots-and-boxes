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
            
            const currentPlayer = room.players[room.currentTurnIndex || 0];
            
            // AFK Tracking Logic
            if (currentPlayer && !currentPlayer.isDead) {
                currentPlayer.afkCount = (currentPlayer.afkCount || 0) + 1;
                
                // Kick if AFK 3 times
                if (currentPlayer.afkCount >= 3) {
                    currentPlayer.isDead = true;
                    const aliveCount = room.players.filter(p => !p.isDead).length;
                    
                    io.to(roomCode).emit('playerLeft', { playerId: currentPlayer.id, reason: 'afk' });
                    
                    if (aliveCount <= 1) {
                        const winner = room.players.find(p => !p.isDead);
                        if (winner) io.to(roomCode).emit('playerWonByDefault', winner);
                        stopTurnTimer(roomCode);
                    }
                    return; // Stop here. The clients will advance the turn and sync to restart the timer.
                }
            }

            // Auto-move if not kicked
            if (room.availableLines && room.availableLines.length > 0) {
                const randomIndex = Math.floor(Math.random() * room.availableLines.length);
                const randomLineId = room.availableLines.splice(randomIndex, 1)[0];
                room.moveHistory.push(randomLineId);
                io.to(roomCode).emit('receiveMove', randomLineId);
            }
        }
    }, 1000);
}

function stopTurnTimer(roomCode) {
    if (rooms[roomCode]) clearInterval(rooms[roomCode].timerInterval);
}

io.on('connection', (socket) => {
    
    // Core Room Management
    socket.on('createGame', (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const sessionId = Math.random().toString(36).substring(2, 15);
        rooms[roomCode] = { 
            boardSize: userData.boardSize, started: false, moveHistory: [], availableLines: [], timerInterval: null, timeLeft: 15, currentTurnIndex: 0,
            players: [{ id: socket.id, sessionId, name: userData.name, color: userData.color, afkCount: 0, isDead: false }] 
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
        if (usedColors.includes(finalColor)) finalColor = palette.find(c => !usedColors.includes(c)) || palette[0];

        const sessionId = Math.random().toString(36).substring(2, 15);
        room.players.push({ id: socket.id, sessionId, name: userData.name, color: finalColor, afkCount: 0, isDead: false });
        socket.join(roomCode);
        socket.emit('joinSuccess', { sessionId });
        io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: room.players[0].id, players: room.players });
    });

    // Reconnection and Leaving
    socket.on('rejoinGame', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            const playerIndex = room.players.findIndex(p => p.sessionId === data.sessionId);
            if (playerIndex !== -1) {
                room.players[playerIndex].id = socket.id;
                socket.join(data.roomCode);
                return socket.emit('rejoinSuccess', { roomCode: data.roomCode, boardSize: room.boardSize, players: room.players, myPlayerIndex: playerIndex, moveHistory: room.moveHistory, gameStarted: room.started });
            }
        }
        socket.emit('errorMsg', 'Session expired. Please join as a new player.');
    });

    socket.on('leaveRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            if (!room.started) {
                room.players = room.players.filter(p => p.id !== socket.id);
                if (room.players.length === 0) delete rooms[roomCode];
                else io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: room.players[0].id, players: room.players });
            } else {
                const player = room.players.find(p => p.id === socket.id);
                if (player && !player.isDead) {
                    player.isDead = true;
                    const aliveCount = room.players.filter(p => !p.isDead).length;
                    io.to(roomCode).emit('playerLeft', { playerId: socket.id, reason: 'left' });
                    
                    if (aliveCount <= 1) {
                        const winner = room.players.find(p => !p.isDead);
                        if (winner) io.to(roomCode).emit('playerWonByDefault', winner);
                        stopTurnTimer(roomCode);
                    }
                }
            }
        }
        socket.leave(roomCode);
    });

    // Gameplay Systems
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = true; room.moveHistory = []; room.availableLines = []; room.currentTurnIndex = 0;
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
            // Reset AFK counter because the player successfully moved
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) room.players[pIndex].afkCount = 0;

            room.availableLines = room.availableLines.filter(id => id !== lineId);
            room.moveHistory.push(lineId);
            io.to(roomCode).emit('receiveMove', lineId);
        }
    });

    // Validates turn cycling to restart timer accurately
    socket.on('syncTurn', ({ roomCode, turnIndex }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentTurnIndex = turnIndex;
            startTurnTimer(roomCode);
        }
    });

    socket.on('gameOver', (roomCode) => stopTurnTimer(roomCode));

    socket.on('requestRematch', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = false; room.moveHistory = []; room.availableLines = [];
            room.players.forEach(p => { p.isDead = false; p.afkCount = 0; });
            stopTurnTimer(roomCode);
            io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: room.players[0].id, players: room.players });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));