const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const palette = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

// --- UCLA-INSPIRED AI ALGORITHM ---
function getBotMove(room) {
    const size = room.boardSize;
    const history = new Set(room.moveHistory);

    const getBoxCount = (r, c) => {
        if (r < 0 || c < 0 || r >= size - 1 || c >= size - 1) return -1;
        return [`h-${r}-${c}`, `h-${r+1}-${c}`, `v-${r}-${c}`, `v-${r}-${c+1}`].filter(l => history.has(l)).length;
    };

    let capturingMoves = []; let safeMoves = []; let dangerousMoves = [];

    room.availableLines.forEach(line => {
        const parts = line.split('-'); const type = parts[0], r = parseInt(parts[1]), c = parseInt(parts[2]);
        let box1Count, box2Count;
        if (type === 'h') { box1Count = getBoxCount(r - 1, c); box2Count = getBoxCount(r, c); } 
        else { box1Count = getBoxCount(r, c - 1); box2Count = getBoxCount(r, c); }

        if (box1Count === 3 || box2Count === 3) capturingMoves.push(line); 
        else if (box1Count === 2 || box2Count === 2) dangerousMoves.push(line); 
        else safeMoves.push(line);
    });

    if (capturingMoves.length > 0) return capturingMoves[Math.floor(Math.random() * capturingMoves.length)];
    if (safeMoves.length > 0) return safeMoves[Math.floor(Math.random() * safeMoves.length)];
    if (dangerousMoves.length > 0) return dangerousMoves[Math.floor(Math.random() * dangerousMoves.length)];
    return room.availableLines[0];
}

// --- UPDATED TIMER ---
function startTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.started) return; 

    clearInterval(room.timerInterval);
    room.timeLeft = 15;
    io.to(roomCode).emit('timerUpdate', room.timeLeft);

    const currentPlayer = room.players[room.currentTurnIndex || 0];

    // IF IT IS THE BOT'S TURN:
    if (currentPlayer && currentPlayer.isBot && !room.moveLocked) {
        room.moveLocked = true;
        setTimeout(() => {
            if (rooms[roomCode] && rooms[roomCode].started) {
                const botLine = getBotMove(rooms[roomCode]);
                if (botLine) {
                    stopTurnTimer(roomCode);
                    rooms[roomCode].availableLines = rooms[roomCode].availableLines.filter(id => id !== botLine);
                    rooms[roomCode].moveHistory.push(botLine);
                    io.to(roomCode).emit('receiveMove', botLine);
                }
            }
        }, 1000); 
    }

    room.timerInterval = setInterval(() => {
        room.timeLeft--;
        io.to(roomCode).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timerInterval);
            
            if (currentPlayer && !currentPlayer.isDead && !currentPlayer.isBot) {
                currentPlayer.afkCount = (currentPlayer.afkCount || 0) + 1;
                if (currentPlayer.afkCount >= 3) {
                    currentPlayer.isDead = true;
                    const aliveCount = room.players.filter(p => !p.isDead).length;
                    io.to(roomCode).emit('playerLeft', { playerId: currentPlayer.id, reason: 'afk' });
                    
                    if (aliveCount <= 1) {
                        const winner = room.players.find(p => !p.isDead);
                        if (winner) io.to(roomCode).emit('playerWonByDefault', winner);
                        stopTurnTimer(roomCode);
                    }
                    return; 
                }
            }

            if (room.availableLines && room.availableLines.length > 0) {
                room.moveLocked = true; 
                const randomIndex = Math.floor(Math.random() * room.availableLines.length);
                const randomLineId = room.availableLines.splice(randomIndex, 1)[0];
                room.moveHistory.push(randomLineId);
                io.to(roomCode).emit('receiveMove', randomLineId);
            }
        }
    }, 1000);
}

// --- MISSING STOP TIMER FUNCTION ---
function stopTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (room && room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
    }
}

io.on('connection', (socket) => {
    
    // --- BOT ROUTE ---
    socket.on('createBotGame', (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const sessionId = Math.random().toString(36).substring(2, 15);
        
        rooms[roomCode] = { 
            boardSize: userData.boardSize, started: true, moveHistory: [], availableLines: [], 
            timerInterval: null, timeLeft: 15, currentTurnIndex: 0, moveLocked: false,
            players: [
                { id: socket.id, sessionId, name: userData.name, color: userData.color, afkCount: 0, isDead: false, isBot: false },
                { id: 'bot-1', sessionId: 'bot-1', name: 'Computer', color: '#64748b', afkCount: 0, isDead: false, isBot: true }
            ] 
        };

        const room = rooms[roomCode];
        
        for (let r = 0; r < room.boardSize; r++) {
            for (let c = 0; c < room.boardSize; c++) {
                if (c < room.boardSize - 1) room.availableLines.push(`h-${r}-${c}`);
                if (r < room.boardSize - 1) room.availableLines.push(`v-${r}-${c}`);
            }
        }

        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, sessionId });
        io.to(roomCode).emit('gameStarted', room);
        startTurnTimer(roomCode);
    });

    socket.on('createGame', (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const sessionId = Math.random().toString(36).substring(2, 15);
        rooms[roomCode] = { boardSize: userData.boardSize, started: false, players: [], moveHistory: [], availableLines: [], timerInterval: null, timeLeft: 15, currentTurnIndex: 0, moveLocked: false };
        const room = rooms[roomCode];

        room.players.push({ id: socket.id, sessionId, name: userData.name, color: userData.color, afkCount: 0, isDead: false, isBot: false });
        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, sessionId });
        io.to(roomCode).emit('lobbyUpdated', { roomCode, hostId: socket.id, players: room.players });
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

    socket.on('rejoinGame', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            const playerIndex = room.players.findIndex(p => p.sessionId === data.sessionId);
            if (playerIndex !== -1) {
                room.players[playerIndex].id = socket.id;
                socket.join(data.roomCode);
                socket.emit('rejoinSuccess', { roomCode: data.roomCode, boardSize: room.boardSize, players: room.players, myPlayerIndex: playerIndex, moveHistory: room.moveHistory, gameStarted: room.started });
                
                // BUG FIX: If the game hasn't started, just redraw the lobby UI
                if (!room.started) {
                    io.to(data.roomCode).emit('lobbyUpdated', { roomCode: data.roomCode, hostId: room.players[0].id, players: room.players });
                }
                return;
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

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = true; room.moveHistory = []; room.availableLines = []; 
            room.currentTurnIndex = 0; room.moveLocked = false;
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
        if (room && !room.moveLocked && room.availableLines.includes(lineId)) {
            room.moveLocked = true; 
            stopTurnTimer(roomCode); 
            
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) room.players[pIndex].afkCount = 0;

            room.availableLines = room.availableLines.filter(id => id !== lineId);
            room.moveHistory.push(lineId);
            io.to(roomCode).emit('receiveMove', lineId);
        }
    });

    socket.on('syncTurn', ({ roomCode, turnIndex }) => {
        const room = rooms[roomCode];
        if (room) {
            room.moveLocked = false; 
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