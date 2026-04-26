const socket = io();

const screens = { 
    landing: document.getElementById('landing-screen'), 
    botSetup: document.getElementById('bot-setup-screen'), 
    lobby: document.getElementById('lobby-screen'), 
    game: document.getElementById('game-screen') 
};
const timerText = document.getElementById('timer-display');
const turnDisplay = document.getElementById('turn-display');
const paletteColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

let currentRoom = ''; let mySessionId = ''; let roomPlayers = []; let scores = [];
let myPlayerIndex = -1; let myName = ''; let myColor = '#000';
let currentTurnIndex = 0; let dotsCount = 10; let boxesCount = 9; 

// --- AUDIO SYSTEM ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Wakes up audio instantly on first click
document.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
}, { once: true });

function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if (type === 'draw') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'box') {
        osc.type = 'square'; osc.frequency.setValueAtTime(600, audioCtx.currentTime); osc.frequency.setValueAtTime(900, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    }
}

function renderPalette(containerId, inputId, defaultColor) {
    const container = document.getElementById(containerId); const input = document.getElementById(inputId); input.value = defaultColor;
    paletteColors.forEach(color => {
        const swatch = document.createElement('div'); swatch.className = 'swatch'; swatch.style.backgroundColor = color;
        if(color === defaultColor) swatch.classList.add('selected');
        swatch.onclick = () => { container.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected')); swatch.classList.add('selected'); input.value = color; };
        container.appendChild(swatch);
    });
}
renderPalette('player-palette', 'player-color', '#3b82f6'); 

window.onload = () => {
    const savedData = JSON.parse(localStorage.getItem('dotsGame'));
    if (savedData && savedData.roomCode && savedData.sessionId) {
        socket.emit('rejoinGame', { roomCode: savedData.roomCode, sessionId: savedData.sessionId });
    }
};

// --- MAIN MENU ACTIONS ---
document.getElementById('host-btn').addEventListener('click', () => { 
    myName = document.getElementById('player-name').value || 'Player'; 
    myColor = document.getElementById('player-color').value;
    const boardSize = parseInt(document.getElementById('board-size').value);
    socket.emit('createGame', { name: myName, color: myColor, boardSize }); 
});

document.getElementById('join-btn').addEventListener('click', () => {
    const code = document.getElementById('room-input').value.toUpperCase();
    myName = document.getElementById('player-name').value || 'Player'; 
    myColor = document.getElementById('player-color').value;
    if (code.length > 0) socket.emit('joinGame', { roomCode: code, name: myName, color: myColor });
});

// --- BOT SETUP ACTIONS ---
document.getElementById('play-bot-btn').addEventListener('click', () => {
    switchScreen(screens.botSetup);
});

document.getElementById('back-to-home-btn').addEventListener('click', () => {
    switchScreen(screens.landing);
});

document.getElementById('start-bot-game-btn').addEventListener('click', () => {
    myName = document.getElementById('player-name').value || 'Player'; 
    myColor = document.getElementById('player-color').value;
    const boardSize = parseInt(document.getElementById('bot-board-size').value);
    
    socket.emit('createBotGame', { name: myName, color: myColor, boardSize }); 
});

// --- LEAVE SYSTEM ---
function leaveGame() {
    if (currentRoom) socket.emit('leaveRoom', currentRoom);
    localStorage.removeItem('dotsGame'); 
    location.reload(); 
}
document.getElementById('leave-lobby-btn').addEventListener('click', leaveGame);
document.getElementById('leave-game-btn').addEventListener('click', leaveGame);
document.getElementById('leave-modal-btn').addEventListener('click', leaveGame);

// --- NETWORK EVENTS ---
socket.on('errorMsg', (msg) => { document.getElementById('error-msg').innerText = msg; localStorage.removeItem('dotsGame'); });
socket.on('gameCreated', (data) => { mySessionId = data.sessionId; currentRoom = data.roomCode; saveSession(); });
socket.on('joinSuccess', (data) => { mySessionId = data.sessionId; });

socket.on('lobbyUpdated', (data) => {
    currentRoom = data.roomCode; roomPlayers = data.players;
    document.getElementById('room-code-display').innerText = currentRoom;
    document.getElementById('player-count').innerText = roomPlayers.length;
    
    const list = document.getElementById('lobby-player-list'); list.innerHTML = '';
    roomPlayers.forEach(p => list.innerHTML += `<li><span style="background-color: ${p.color}"></span> ${p.name}</li>`);

    if (socket.id === data.hostId && roomPlayers.length >= 2) {
        document.getElementById('start-game-btn').classList.remove('hidden');
        document.getElementById('waiting-msg').classList.add('hidden');
    } else {
        document.getElementById('start-game-btn').classList.add('hidden');
        document.getElementById('waiting-msg').classList.remove('hidden');
    }
    switchScreen(screens.lobby); saveSession();
});

// Starts the timer when Host clicks "Start Game" in a multiplayer lobby
if (document.getElementById('start-game-btn')) {
    document.getElementById('start-game-btn').addEventListener('click', () => socket.emit('startGame', currentRoom));
}

socket.on('gameStarted', (data) => {
    roomPlayers = data.players; dotsCount = data.boardSize; boxesCount = dotsCount - 1;
    roomPlayers.forEach((p, index) => { document.documentElement.style.setProperty(`--p${index}-color`, p.color); if (p.id === socket.id) myPlayerIndex = index; });
    switchScreen(screens.game); resetLocalGame();
});

socket.on('rejoinSuccess', (data) => {
    currentRoom = data.roomCode; roomPlayers = data.players; dotsCount = data.boardSize; boxesCount = dotsCount - 1;
    myPlayerIndex = data.myPlayerIndex; myName = roomPlayers[myPlayerIndex].name; myColor = roomPlayers[myPlayerIndex].color;
    roomPlayers.forEach((p, index) => document.documentElement.style.setProperty(`--p${index}-color`, p.color));
    
    if (data.gameStarted) {
        switchScreen(screens.game); resetLocalGame();
        data.moveHistory.forEach(lineId => processMove(lineId, true));
        updateUI();
    }
    // BUG FIX: Removed the 'else' block that was blindly requesting a new player slot!
});

socket.on('spectatorJoined', (data) => {
    currentRoom = data.roomCode; roomPlayers = data.players; dotsCount = data.boardSize; boxesCount = dotsCount - 1;
    myPlayerIndex = -1; myName = "Spectator"; myColor = "#999";
    roomPlayers.forEach((p, index) => document.documentElement.style.setProperty(`--p${index}-color`, p.color));
    switchScreen(screens.game); resetLocalGame(); 
    if(data.moveHistory) data.moveHistory.forEach(lineId => processMove(lineId, true));
});

// DROPOUT & AFK HANDLING
socket.on('playerLeft', (data) => {
    const pIndex = roomPlayers.findIndex(p => p.id === data.playerId);
    if (pIndex !== -1) {
        roomPlayers[pIndex].isDead = true;
        document.getElementById(`card-p${pIndex}`).classList.add('dead');
        
        if (currentTurnIndex === pIndex) {
            advanceTurn();
            updateUI();
            
            const firstAlive = roomPlayers.find(p => !p.isDead);
            if (firstAlive && socket.id === firstAlive.id) {
                socket.emit('syncTurn', { roomCode: currentRoom, turnIndex: currentTurnIndex });
            }
        }
    }
});

function fireConfetti() {
    confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.5 },
        colors: paletteColors 
    });
}

socket.on('playerWonByDefault', (winner) => {
    const winnerText = document.getElementById('winner-text');
    winnerText.innerText = `${winner.name} Wins by Default!`;
    winnerText.style.color = winner.color;
    document.getElementById('game-over-modal').classList.remove('hidden');
    fireConfetti();
    localStorage.removeItem('dotsGame'); 
});

socket.on('receiveMove', (lineId) => { processMove(lineId, false); });
socket.on('timerUpdate', (timeLeft) => { timerText.innerText = `${timeLeft}s`; timerText.style.color = timeLeft <= 5 ? '#ef4444' : 'var(--ink-dark)'; });
document.getElementById('rematch-btn').addEventListener('click', () => { if(myPlayerIndex !== -1) socket.emit('requestRematch', currentRoom); });

function switchScreen(screen) { Object.values(screens).forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); }); screen.classList.remove('hidden'); screen.classList.add('active'); }
function saveSession() { if (currentRoom && mySessionId) localStorage.setItem('dotsGame', JSON.stringify({ roomCode: currentRoom, sessionId: mySessionId })); }

// --- GAME LOGIC ---
function resetLocalGame() {
    scores = new Array(roomPlayers.length).fill(0); currentTurnIndex = 0; 
    document.getElementById('game-over-modal').classList.add('hidden');
    
    for (let i = 0; i < 4; i++) {
        const card = document.getElementById(`card-p${i}`);
        card.classList.remove('dead');
        if (i < roomPlayers.length) {
            card.classList.remove('hidden');
            document.getElementById(`name-p${i}`).innerText = roomPlayers[i].name;
            document.getElementById(`score-p${i}`).innerText = "0";
            if(roomPlayers[i].isDead) card.classList.add('dead');
        } else {
            card.classList.add('hidden');
        }
    }
    initBoard(); updateUI();
}

function initBoard() {
    const container = document.querySelector('.board-container'); 
    container.innerHTML = ''; 
    
    const dotSize = 8; 
    const lineThickness = 6; 

    const maxSafeWidth = window.innerWidth > 500 ? 400 : window.innerWidth - 40;
    let spacing = Math.floor((maxSafeWidth - dotSize) / (dotsCount - 1));
    if (spacing > 40) spacing = 40; 
    
    document.documentElement.style.setProperty('--grid-size', `${spacing}px`);
    
    const exactWidth = (spacing * (dotsCount - 1)) + dotSize;
    container.style.width = `${exactWidth}px`; 
    container.style.height = `${exactWidth}px`;

    for (let r = 0; r < dotsCount; r++) {
        for (let c = 0; c < dotsCount; c++) {
            const dot = document.createElement('div'); dot.className = 'dot'; 
            dot.style.left = `${c * spacing}px`; 
            dot.style.top = `${r * spacing}px`; 
            container.appendChild(dot);
            
            if (c < dotsCount - 1) {
                const hLine = document.createElement('div'); hLine.className = 'line h-line'; hLine.id = `h-${r}-${c}`; 
                hLine.style.left = `${(c * spacing) + dotSize}px`; 
                hLine.style.top = `${(r * spacing) + (dotSize - lineThickness) / 2}px`; 
                hLine.style.width = `${spacing - dotSize}px`; hLine.style.height = `${lineThickness}px`; 
                setupLineClick(hLine); container.appendChild(hLine);
            }
            if (r < dotsCount - 1) {
                const vLine = document.createElement('div'); vLine.className = 'line v-line'; vLine.id = `v-${r}-${c}`; 
                vLine.style.left = `${(c * spacing) + (dotSize - lineThickness) / 2}px`; 
                vLine.style.top = `${(r * spacing) + dotSize}px`; 
                vLine.style.width = `${lineThickness}px`; vLine.style.height = `${spacing - dotSize}px`; 
                setupLineClick(vLine); container.appendChild(vLine);
            }
            if (r < dotsCount - 1 && c < dotsCount - 1) {
                const box = document.createElement('div'); box.className = 'box'; box.id = `box-${r}-${c}`; 
                box.style.left = `${(c * spacing) + dotSize}px`; 
                box.style.top = `${(r * spacing) + dotSize}px`; 
                box.style.width = `${spacing - dotSize}px`; box.style.height = `${spacing - dotSize}px`; 
                container.appendChild(box);
            }
        }
    }

    setTimeout(() => {
        const rect = container.getBoundingClientRect();
        const offsetX = rect.left + (dotSize / 2);
        const offsetY = rect.top + (dotSize / 2);
        document.body.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
    }, 50);
}

function setupLineClick(line) {
    line.addEventListener('click', () => {
        if (myPlayerIndex === -1 || currentTurnIndex !== myPlayerIndex || line.dataset.claimed === "true") return;
        socket.emit('makeMove', { roomCode: currentRoom, lineId: line.id });
    });
}

function advanceTurn() {
    do {
        currentTurnIndex = (currentTurnIndex + 1) % roomPlayers.length;
    } while (roomPlayers[currentTurnIndex].isDead);
}

function processMove(lineId, isReplay) {
    const playerIndex = currentTurnIndex; 
    const line = document.getElementById(lineId); 
    if(!line) return;
    
    line.classList.add(`claimed-p${playerIndex}`); line.dataset.claimed = "true";
    if (!isReplay) playSound('draw');
    
    let boxesScored = calculateBoxes(lineId, playerIndex);
    if (boxesScored > 0) {
        if (!isReplay) playSound('box'); scores[playerIndex] += boxesScored;
    } else {
        advanceTurn();
    }
    
    updateUI(); 
    
    if (!isReplay) {
        checkWinCondition();
        const firstAlive = roomPlayers.find(p => !p.isDead);
        if (firstAlive && socket.id === firstAlive.id) {
            socket.emit('syncTurn', { roomCode: currentRoom, turnIndex: currentTurnIndex });
        }
    }
}

function calculateBoxes(lineId, playerIndex) {
    const parts = lineId.split('-'); const type = parts[0]; const r = parseInt(parts[1]); const c = parseInt(parts[2]); let formed = 0;
    if (type === 'h') {
        if (r > 0 && checkBox(r - 1, c, playerIndex)) formed++; 
        if (r < boxesCount && checkBox(r, c, playerIndex)) formed++; 
    } else if (type === 'v') {
        if (c > 0 && checkBox(r, c - 1, playerIndex)) formed++; 
        if (c < boxesCount && checkBox(r, c, playerIndex)) formed++; 
    }
    return formed;
}

function checkBox(r, c, playerIndex) {
    const top = document.getElementById(`h-${r}-${c}`), bottom = document.getElementById(`h-${r+1}-${c}`), left = document.getElementById(`v-${r}-${c}`), right = document.getElementById(`v-${r}-${c+1}`);
    if (top?.dataset.claimed && bottom?.dataset.claimed && left?.dataset.claimed && right?.dataset.claimed) {
        const box = document.getElementById(`box-${r}-${c}`);
        if (!box.dataset.claimed) { 
            box.dataset.claimed = "true"; box.classList.add(`claimed-p${playerIndex}`); 
            return true; 
        }
    }
    return false;
}

function updateUI() {
    roomPlayers.forEach((p, i) => {
        document.getElementById(`score-p${i}`).innerText = scores[i];
        document.getElementById(`card-p${i}`).classList.remove('active-turn');
    });
    document.getElementById(`card-p${currentTurnIndex}`).classList.add('active-turn');
    turnDisplay.innerText = (myPlayerIndex !== -1 && currentTurnIndex === myPlayerIndex) ? "YOUR TURN" : `${roomPlayers[currentTurnIndex].name}'S TURN`;
}

function checkWinCondition() {
    const aliveCount = roomPlayers.filter(p => !p.isDead).length;
    if (scores.reduce((a, b) => a + b, 0) === boxesCount * boxesCount && aliveCount > 1) {
        socket.emit('gameOver', currentRoom); 
        setTimeout(() => {
            const maxScore = Math.max(...scores); 
            const winners = roomPlayers.filter((p, i) => scores[i] === maxScore && !p.isDead);
            const winnerText = document.getElementById('winner-text');
            
            if (winners.length === 1) { 
                winnerText.innerText = `${winners[0].name} Wins!`; 
                winnerText.style.color = winners[0].color; 
                fireConfetti(); 
            } else { 
                winnerText.innerText = "It's a Tie!"; 
                winnerText.style.color = "var(--ink-dark)"; 
            }
            
            const list = document.getElementById('final-scores-list'); list.innerHTML = '';
            roomPlayers.forEach((p, i) => {
                if(!p.isDead) list.innerHTML += `<div style="color: ${p.color}">${p.name}: ${scores[i]}</div>`;
            });
            
            document.getElementById('game-over-modal').classList.remove('hidden');
            localStorage.removeItem('dotsGame'); 
        }, 500); 
    }
}