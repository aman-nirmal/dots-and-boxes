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
// --- TRUE UCLA / BERLEKAMP MASTER AI ---
// --- TRUE UCLA / BERLEKAMP MASTER AI (BUGFIXED) ---
function getBotMove(room) {
    const size = room.boardSize;
    const history = new Set(room.moveHistory);

    // 1. Helper to grab the 4 lines for any box
    const getBoxLines = (r, c) => {
        if (r < 0 || c < 0 || r >= size - 1 || c >= size - 1) return [];
        return [`h-${r}-${c}`, `h-${r+1}-${c}`, `v-${r}-${c}`, `v-${r}-${c+1}`];
    };

    let capturingMoves = []; 
    let safeMoves = []; 
    let dangerousMoves = [];

    // Categorize every available line
    room.availableLines.forEach(line => {
        const parts = line.split('-'); 
        const type = parts[0], r = parseInt(parts[1]), c = parseInt(parts[2]);
        
        const b1Lines = getBoxLines(type === 'h' ? r - 1 : r, type === 'h' ? c : c - 1);
        const b2Lines = getBoxLines(r, c);
        
        const b1Count = b1Lines.length > 0 ? b1Lines.filter(l => history.has(l)).length : -1;
        const b2Count = b2Lines.length > 0 ? b2Lines.filter(l => history.has(l)).length : -1;

        if (b1Count === 3 || b2Count === 3) {
            capturingMoves.push({ line, b1Count, b2Count, b1Lines, b2Lines }); 
        } else if (b1Count === 2 || b2Count === 2) {
            dangerousMoves.push(line); 
        } else {
            safeMoves.push(line); 
        }
    });

    // STRATEGY 1: PERFECT CAPTURE & DOUBLE-CROSS
    if (capturingMoves.length > 0) {
        // If taking the box doesn't leave an adjacent 2-line box, it's totally safe to take.
        let safeCapture = capturingMoves.find(m => m.b1Count !== 2 && m.b2Count !== 2);
        if (safeCapture) return safeCapture.line;

        // Otherwise, we are inside a chain. We must find out if it's the END of the chain.
        for (let move of capturingMoves) {
            let box2Lines = move.b1Count === 3 ? move.b2Lines : move.b1Lines;
            let otherMissingLine = box2Lines.find(l => !history.has(l) && l !== move.line);
            
            if (otherMissingLine) {
                // Look at the box on the OTHER side of the missing line
                const parts = otherMissingLine.split('-');
                const type = parts[0], r = parseInt(parts[1]), c = parseInt(parts[2]);
                const nextB1Lines = getBoxLines(type === 'h' ? r - 1 : r, type === 'h' ? c : c - 1);
                const nextB2Lines = getBoxLines(r, c);
                
                const isNextB1 = JSON.stringify(nextB1Lines) === JSON.stringify(box2Lines);
                const nextBoxLines = isNextB1 ? nextB2Lines : nextB1Lines;
                const nextBoxCount = nextBoxLines.length > 0 ? nextBoxLines.filter(l => history.has(l)).length : -1;

                if (nextBoxCount === 2) {
                    // The chain continues! Keep eating boxes!
                    return move.line; 
                } else if (safeMoves.length === 0) {
                    // This is the end of the chain (exactly 2 boxes left). Execute the sacrifice!
                    return otherMissingLine; 
                }
            }
        }
        
        // Absolute fallback to just take the point
        return capturingMoves[0].line;
    }

    // STRATEGY 2: PLAY SAFE (Center Control)
    if (safeMoves.length > 0) {
        safeMoves.sort((a, b) => {
            const getDist = (line) => {
                const parts = line.split('-');
                const r = parseInt(parts[1]), c = parseInt(parts[2]);
                const center = (size - 1) / 2;
                return Math.abs(r - center) + Math.abs(c - center);
            };
            return getDist(a) - getDist(b);
        });
        const topPicks = safeMoves.slice(0, Math.max(1, Math.floor(safeMoves.length * 0.3)));
        return topPicks[Math.floor(Math.random() * topPicks.length)];
    }

    // STRATEGY 3: CHAIN MINIMIZATION (Forced to open a chain)
    if (dangerousMoves.length > 0) {
        let bestSacrifice = dangerousMoves[0];
        let minBoxesGiven = Infinity;

        dangerousMoves.forEach(testLine => {
            let simHistory = new Set(history);
            simHistory.add(testLine); 
            let boxesGiven = 0;
            let chainReaction = true;

            while (chainReaction) {
                chainReaction = false;
                for (let r = 0; r < size - 1; r++) {
                    for (let c = 0; c < size - 1; c++) {
                        let lines = getBoxLines(r, c);
                        let drawn = lines.filter(l => simHistory.has(l));
                        if (drawn.length === 3) { 
                            simHistory.add(lines.find(l => !simHistory.has(l))); 
                            boxesGiven++;
                            chainReaction = true; 
                        }
                    }
                }
            }

            if (boxesGiven < minBoxesGiven) {
                minBoxesGiven = boxesGiven;
                bestSacrifice = testLine;
            }
        });

        return bestSacrifice;
    }
    
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