const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Standard express and socket setup
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Active game states and fallback colors
const rooms = {};
const palette = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

// Main AI logic based on Berlekamp's Dots & Boxes algorithms
function getBotMove(room) {
    const size = room.boardSize;
    const m = size - 1; 
    const n = size - 1; 
    
    // Quick lookup for past moves
    const history = new Set(room.moveHistory);

    // Map board state to matrices (1 = drawn line, 0 = empty)
    const hedge = Array.from({length: m+1}, (_, i) =>
        Array.from({length: n}, (_, j) => history.has(`h-${i}-${j}`) ? 1 : 0));
    const vedge = Array.from({length: m}, (_, i) =>
        Array.from({length: n+1}, (_, j) => history.has(`v-${i}-${j}`) ? 1 : 0));
        
    // Count lines around each box
    const box = Array.from({length: m}, (_, i) =>
        Array.from({length: n}, (_, j) =>
            hedge[i][j] + hedge[i+1][j] + vedge[i][j] + vedge[i][j+1]));

    let x, y, zz, u, v, count, loop;
    let result = null;

    // Internal simulation helpers
    function sethedge(i, j) {
        if (result === null) result = `h-${i}-${j}`;
        hedge[i][j] = 1;
        if (i > 0) box[i-1][j]++;
        if (i < m) box[i][j]++;
    }
    
    function setvedge(i, j) {
        if (result === null) result = `v-${i}-${j}`;
        vedge[i][j] = 1;
        if (j > 0) box[i][j-1]++;
        if (j < n) box[i][j]++;
    }
    
    function takeedge(zzz, xi, yi) { 
        if (zzz > 1) setvedge(xi, yi); 
        else sethedge(xi, yi); 
    }

    // Check if playing a line gives away a box
    function safehedge(i, j) {
        if (hedge[i][j]) return false;
        if (i === 0) return box[i][j] < 2;
        if (i === m) return box[i-1][j] < 2;
        return box[i][j] < 2 && box[i-1][j] < 2;
    }
    
    function safevedge(i, j) {
        if (vedge[i][j]) return false;
        if (j === 0) return box[i][j] < 2;
        if (j === n) return box[i][j-1] < 2;
        return box[i][j] < 2 && box[i][j-1] < 2;
    }

    // Find boxes that are 1 line away from completion
    function sides3() {
        for (let i = 0; i < m; i++) for (let j = 0; j < n; j++)
            if (box[i][j] === 3) { u = i; v = j; return true; }
        return false;
    }
    
    function sides3not(xi, yi) {
        for (let i = 0; i < m; i++) for (let j = 0; j < n; j++)
            if (box[i][j] === 3 && (i !== xi || j !== yi)) { u = i; v = j; return true; }
        return false;
    }

    // Greedily take 3-sided boxes, unless it opens up a bad chain
    function takesafe3s() {
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < n; j++) {
                if (box[i][j] === 3) {
                    if (!vedge[i][j])   { if (j === 0   || box[i][j-1] !== 2) { setvedge(i, j);   return; } }
                    else if (!hedge[i][j])   { if (i === 0   || box[i-1][j] !== 2) { sethedge(i, j);   return; } }
                    else if (!vedge[i][j+1]) { if (j === n-1 || box[i][j+1] !== 2) { setvedge(i, j+1); return; } }
                    else                     { if (i === m-1 || box[i+1][j] !== 2) { sethedge(i+1, j); return; } }
                }
            }
        }
    }

    function takebox(i, j) {
        if (!hedge[i][j]) sethedge(i, j);
        else if (!vedge[i][j]) setvedge(i, j);
        else if (!hedge[i+1][j]) sethedge(i+1, j);
        else setvedge(i, j+1);
    }
    
    function takeall3s() { while (sides3()) takebox(u, v); }
    function takeallbut(xi, yi) { while (sides3not(xi, yi)) takebox(u, v); }

    // Find completely safe moves and pick one at random
    function sides01() {
        let safeOptions = [];
        for (let i = 0; i <= m; i++) {
            for (let j = 0; j < n; j++) {
                if (safehedge(i, j)) safeOptions.push({ zz: 1, x: i, y: j });
            }
        }
        for (let i = 0; i < m; i++) {
            for (let j = 0; j <= n; j++) {
                if (safevedge(i, j)) safeOptions.push({ zz: 2, x: i, y: j });
            }
        }

        if (safeOptions.length > 0) {
            const pick = safeOptions[Math.floor(Math.random() * safeOptions.length)];
            zz = pick.zz; x = pick.x; y = pick.y;
            return true;
        }
        return false;
    }

    // Force opponent to take a single box (minimal damage)
    function singleton() {
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < n; j++) {
                if (box[i][j] === 2) {
                    if (!hedge[i][j]   && (i === 0   || box[i-1][j] < 2)) { zz=1; x=i;   y=j;   return true; }
                    if (!vedge[i][j]   && (j === 0   || box[i][j-1] < 2)) { zz=2; x=i;   y=j;   return true; }
                    if (!vedge[i][j+1] && (j === n-1 || box[i][j+1] < 2)) { zz=2; x=i;   y=j+1; return true; }
                    if (!hedge[i+1][j] && (i === m-1 || box[i+1][j] < 2)) { zz=1; x=i+1; y=j;   return true; }
                }
            }
        }
        return false;
    }

    // The "Double-Cross" sacrifice: leave exactly 2 boxes in a long chain
    // to force the opponent to open the next one.
    function ldub(i,j) {
        if (!vedge[i][j])   { if (j < 1   || box[i][j-1] < 2)   return true; }
        else if (!hedge[i][j])   { if (i < 1   || box[i-1][j] < 2)   return true; }
        else if (i === m-1 || box[i+1][j] < 2) return true;
        return false;
    }
    function rdub(i,j) {
        if (!vedge[i][j+1]) { if (j+1 === n || box[i][j+1] < 2)   return true; }
        else if (!hedge[i][j])   { if (i < 1   || box[i-1][j] < 2)   return true; }
        else if (i+1 === m || box[i+1][j] < 2) return true;
        return false;
    }
    function udub(i,j) {
        if (!hedge[i][j])   { if (i < 1   || box[i-1][j] < 2)   return true; }
        else if (!vedge[i][j])   { if (j < 1   || box[i][j-1] < 2)   return true; }
        else if (j === n-1 || box[i][j+1] < 2) return true;
        return false;
    }
    function ddub(i,j) {
        if (!hedge[i+1][j]) { if (i === m-1 || box[i+1][j] < 2)   return true; }
        else if (!vedge[i][j])   { if (j < 1   || box[i][j-1] < 2)   return true; }
        else if (j === n-1 || box[i][j+1] < 2) return true;
        return false;
    }
    function doubleton() {
        for (let i = 0; i < m; i++)
            for (let j = 0; j < n-1; j++)
                if (box[i][j] === 2 && box[i][j+1] === 2 && !vedge[i][j+1])
                    if (ldub(i,j) && rdub(i,j+1)) { zz=2; x=i; y=j+1; return true; }
        for (let j = 0; j < n; j++)
            for (let i = 0; i < m-1; i++)
                if (box[i][j] === 2 && box[i+1][j] === 2 && !hedge[i+1][j])
                    if (udub(i,j) && ddub(i+1,j)) { zz=1; x=i+1; y=j; return true; }
        return false;
    }

    // Trace the length of a chain
    function incount(k, i, j) {
        count++;
        if      (k!==1 && !vedge[i][j]   && j>0)   { if (box[i][j-1]>2) { count++; loop=true; } else if (box[i][j-1]>1) incount(3,i,j-1); }
        else if (k!==2 && !hedge[i][j]   && i>0)   { if (box[i-1][j]>2) { count++; loop=true; } else if (box[i-1][j]>1) incount(4,i-1,j); }
        else if (k!==3 && !vedge[i][j+1] && j<n-1) { if (box[i][j+1]>2) { count++; loop=true; } else if (box[i][j+1]>1) incount(1,i,j+1); }
        else if (k!==4 && !hedge[i+1][j] && i<m-1) { if (box[i+1][j]>2) { count++; loop=true; } else if (box[i+1][j]>1) incount(2,i+1,j); }
    }

    // Execute the double-cross sequence
    function outcount(k, i, j) {
        if (count <= 0) return;
        if      (k!==1 && !vedge[i][j]   && j>0)   { if (count!==2) setvedge(i,j);   count--; outcount(3,i,j-1); }
        else if (k!==2 && !hedge[i][j]   && i>0)   { if (count!==2) sethedge(i,j);   count--; outcount(4,i-1,j); }
        else if (k!==3 && !vedge[i][j+1] && j<n-1) { if (count!==2) setvedge(i,j+1); count--; outcount(1,i,j+1); }
        else if (k!==4 && !hedge[i+1][j] && i<m-1) { if (count!==2) sethedge(i+1,j); count--; outcount(2,i+1,j); }
    }

    // Decide whether to take the whole chain or sacrifice the last two
    function sac(i, j) {
        count = 0; loop = false;
        incount(0, i, j);
        if (!loop) takeallbut(i, j);
        let scored = 0;
        for (let r = 0; r < m; r++) for (let c = 0; c < n; c++) if (box[r][c] === 4) scored++;
        if (count + scored === m * n) { takeall3s(); }
        else { if (loop) count -= 2; outcount(0, i, j); }
    }

    // Absolute fallback: pick a random empty line
    function makeanymove() {
        let anyOptions = [];
        for (let i = 0; i <= m; i++) {
            for (let j = 0; j < n; j++) {
                if (!hedge[i][j]) anyOptions.push({ type: 'h', i, j });
            }
        }
        for (let i = 0; i < m; i++) {
            for (let j = 0; j <= n; j++) {
                if (!vedge[i][j]) anyOptions.push({ type: 'v', i, j });
            }
        }

        if (anyOptions.length > 0) {
            const pick = anyOptions[Math.floor(Math.random() * anyOptions.length)];
            if (pick.type === 'h') sethedge(pick.i, pick.j);
            else setvedge(pick.i, pick.j);
        }
    }

    // Evaluate strategies in priority order
    takesafe3s(); // 1. Take free safe boxes
    if (result) return result;

    if (sides3()) {
        if (sides01()) { takeall3s(); takeedge(zz, x, y); }
        else           { sac(u, v); } // 2. Handle chains/sacrifices
    } else if (sides01())  { takeedge(zz, x, y); } // 3. Play safe
    else if (singleton())  { takeedge(zz, x, y); } // 4. Give 1 box
    else if (doubleton())  { takeedge(zz, x, y); } // 5. Setup double-cross
    else                   { makeanymove(); }      // 6. Random fallback

    return result || room.availableLines[0];
}

// Manage turn timers and AFK kicking
function startTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.started) return; 

    clearInterval(room.timerInterval);
    room.timeLeft = 15;
    io.to(roomCode).emit('timerUpdate', room.timeLeft);

    const currentPlayer = room.players[room.currentTurnIndex || 0];

    // Artificial delay so the bot doesn't move instantly
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
        }, 350); 
    }

    room.timerInterval = setInterval(() => {
        room.timeLeft--;
        io.to(roomCode).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timerInterval);
            
            if (currentPlayer && !currentPlayer.isDead && !currentPlayer.isBot) {
                currentPlayer.afkCount = (currentPlayer.afkCount || 0) + 1;
                
                // Kick player after 3 missed turns
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

            // Force random move if time expires
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

function stopTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (room && room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
    }
}

// Handle socket connections
io.on('connection', (socket) => {
    
    // Spin up a 1v1 match vs computer
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

    // Multiplayer room creation
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

    // Join existing room
    socket.on('joinGame', (userData) => {
        const roomCode = userData.roomCode;
        if (!rooms[roomCode]) return socket.emit('errorMsg', 'Invalid Room Code.');
        const room = rooms[roomCode];
        
        // Push as spectator if full/started
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

    // Handle page refreshes smoothly
    socket.on('rejoinGame', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            const playerIndex = room.players.findIndex(p => p.sessionId === data.sessionId);
            if (playerIndex !== -1) {
                room.players[playerIndex].id = socket.id;
                socket.join(data.roomCode);
                socket.emit('rejoinSuccess', { roomCode: data.roomCode, boardSize: room.boardSize, players: room.players, myPlayerIndex: playerIndex, moveHistory: room.moveHistory, gameStarted: room.started });
                
                if (!room.started) {
                    io.to(data.roomCode).emit('lobbyUpdated', { roomCode: data.roomCode, hostId: room.players[0].id, players: room.players });
                }
                return;
            }
        }
        socket.emit('errorMsg', 'Session expired. Please join as a new player.');
    });

    // Player disconnect cleanup
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

    // Start the match
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.started = true; 
            room.moveHistory = []; 
            room.availableLines = []; 
            room.currentTurnIndex = 0; 
            room.moveLocked = false;
            
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

    // Validate and broadcast moves
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

    // Keep clients and server in sync
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