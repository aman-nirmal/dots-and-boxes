const socket = io();

const screens = { landing: document.getElementById('landing-screen'), lobby: document.getElementById('lobby-screen'), game: document.getElementById('game-screen') };
const timerText = document.getElementById('time-left');
const turnDisplay = document.getElementById('turn-display');
const paletteColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

let currentRoom = ''; let mySessionId = ''; let roomPlayers = []; let scores = [];
let myPlayerIndex = -1; let myName = ''; let myColor = '#000';
let currentTurnIndex = 0; let dotsCount = 10; let boxesCount = 9; 

// --- AUDIO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

// --- INIT & LOCAL STORAGE ---
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

// --- NETWORK EVENTS ---
document.getElementById('host-btn').addEventListener('click', () => { 
    if (audioCtx.state === 'suspended') audioCtx.resume();
    myName = document.getElementById('player-name').value || 'P1'; myColor = document.getElementById('player-color').value;
    const boardSize = parseInt(document.getElementById('board-size').value);
    socket.emit('createGame', { name: myName, color: myColor, boardSize }); 
});

document.getElementById('join-btn').addEventListener('click', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const code = document.getElementById('room-input').value.toUpperCase();
    myName = document.getElementById('player-name').value || 'Player'; myColor = document.getElementById('player-color').value;
    if (code.length > 0) socket.emit('joinGame', { roomCode: code, name: myName, color: myColor });
});

document.getElementById('start-game-btn').addEventListener('click', () => socket.emit('startGame', currentRoom));
document.getElementById('leave-btn').addEventListener('click', () => { localStorage.removeItem('dotsGame'); location.reload(); });
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

socket.on('gameStarted', (data) => {
    roomPlayers = data.players; dotsCount = data.boardSize; boxesCount = dotsCount - 1;
    roomPlayers.forEach((p, index) => {
        document.documentElement.style.setProperty(`--p${index}-color`, p.color);
        if (p.id === socket.id) myPlayerIndex = index;
    });
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
    } else {
        socket.emit('joinGame', { roomCode: currentRoom, name: myName, color: myColor });
    }
});

socket.on('spectatorJoined', (data) => {
    currentRoom = data.roomCode; roomPlayers = data.players; dotsCount = data.boardSize; boxesCount = dotsCount - 1;
    myPlayerIndex = -1; myName = "Spectator"; myColor = "#999";
    roomPlayers.forEach((p, index) => document.documentElement.style.setProperty(`--p${index}-color`, p.color));
    switchScreen(screens.game); resetLocalGame(); 
    if(data.moveHistory) data.moveHistory.forEach(lineId => processMove(lineId, true));
});

socket.on('receiveMove', (lineId) => { processMove(lineId, false); });

socket.on('timerUpdate', (timeLeft) => {
    timerText.innerText = `${timeLeft}s`;
    timerText.style.color = timeLeft <= 5 ? '#ef4444' : 'var(--ink-dark)';
});

document.getElementById('rematch-btn').addEventListener('click', () => { if(myPlayerIndex !== -1) socket.emit('requestRematch', currentRoom); });
socket.on('returnToLobby', () => { switchScreen(screens.lobby); });

function switchScreen(screen) { 
    Object.values(screens).forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); }); 
    screen.classList.remove('hidden'); screen.classList.add('active'); 
}

function saveSession() { if (currentRoom && mySessionId) localStorage.setItem('dotsGame', JSON.stringify({ roomCode: currentRoom, sessionId: mySessionId })); }

function resetLocalGame() {
    scores = new Array(roomPlayers.length).fill(0); currentTurnIndex = 0; 
    document.getElementById('game-over-modal').classList.add('hidden');
    buildScoreboard(); initBoard(); updateUI();
}

function buildScoreboard() {
    const sb = document.getElementById('dynamic-scoreboard'); sb.innerHTML = '';
    roomPlayers.forEach((p, i) => sb.innerHTML += `<div class="score-card p-${i}" id="card-p${i}"><span class="name">${p.name}</span><span class="score" id="score-p${i}">0</span></div>`);
}

function initBoard() {
    const container = document.querySelector('.board-container'); container.innerHTML = ''; 
    const maxBoardWidth = window.innerWidth > 500 ? 370 : window.innerWidth - 60; 
    const spacing = Math.floor(maxBoardWidth / dotsCount); 
    const dotSize = 8; const lineThickness = 12; // Thicker click area for mobile
    
    container.style.width = `${spacing * dotsCount}px`; container.style.height = `${spacing * dotsCount}px`;

    for (let r = 0; r < dotsCount; r++) {
        for (let c = 0; c < dotsCount; c++) {
            const dot = document.createElement('div'); dot.className = 'dot'; dot.style.left = `${c * spacing}px`; dot.style.top = `${r * spacing}px`; container.appendChild(dot);
            
            if (c < dotsCount - 1) {
                const hLine = document.createElement('div'); hLine.className = 'line h-line'; hLine.id = `h-${r}-${c}`; 
                hLine.style.left = `${c * spacing + dotSize}px`; hLine.style.top = `${r * spacing + (dotSize - lineThickness)/2}px`; 
                hLine.style.width = `${spacing - dotSize}px`; hLine.style.height = `${lineThickness}px`; 
                setupLineClick(hLine); container.appendChild(hLine);
            }
            if (r < dotsCount - 1) {
                const vLine = document.createElement('div'); vLine.className = 'line v-line'; vLine.id = `v-${r}-${c}`; 
                vLine.style.left = `${c * spacing + (dotSize - lineThickness)/2}px`; vLine.style.top = `${r * spacing + dotSize}px`; 
                vLine.style.width = `${lineThickness}px`; vLine.style.height = `${spacing - dotSize}px`; 
                setupLineClick(vLine); container.appendChild(vLine);
            }
            if (r < dotsCount - 1 && c < dotsCount - 1) {
                const box = document.createElement('div'); box.className = 'box'; box.id = `box-${r}-${c}`; 
                box.style.left = `${c * spacing + dotSize}px`; box.style.top = `${r * spacing + dotSize}px`; 
                box.style.width = `${spacing - dotSize}px`; box.style.height = `${spacing - dotSize}px`; container.appendChild(box);
            }
        }
    }
}

function setupLineClick(line) {
    line.addEventListener('click', () => {
        if (myPlayerIndex === -1 || currentTurnIndex !== myPlayerIndex || line.dataset.claimed === "true") return;
        socket.emit('makeMove', { roomCode: currentRoom, lineId: line.id });
    });
}

function processMove(lineId, isReplay) {
    const playerIndex = currentTurnIndex; 
    const line = document.getElementById(lineId); 
    if(!line) return;
    
    line.classList.add(`claimed-p${playerIndex}`); line.dataset.claimed = "true";
    if (!isReplay) playSound('draw');
    
    let boxesScored = calculateBoxes(lineId, playerIndex, isReplay);
    if (boxesScored > 0) {
        if (!isReplay) playSound('box'); scores[playerIndex] += boxesScored;
    } else currentTurnIndex = (currentTurnIndex + 1) % roomPlayers.length;
    
    updateUI(); 
    if (!isReplay) checkWinCondition();
}

function calculateBoxes(lineId, playerIndex, isReplay) {
    const parts = lineId.split('-'); const type = parts[0]; const r = parseInt(parts[1]); const c = parseInt(parts[2]); let formed = 0;
    if (type === 'h') {
        if (r > 0 && checkBox(r - 1, c, playerIndex, isReplay)) formed++; 
        if (r < boxesCount && checkBox(r, c, playerIndex, isReplay)) formed++; 
    } else if (type === 'v') {
        if (c > 0 && checkBox(r, c - 1, playerIndex, isReplay)) formed++; 
        if (c < boxesCount && checkBox(r, c, playerIndex, isReplay)) formed++; 
    }
    return formed;
}

function checkBox(r, c, playerIndex, isReplay) {
    const top = document.getElementById(`h-${r}-${c}`), bottom = document.getElementById(`h-${r+1}-${c}`), left = document.getElementById(`v-${r}-${c}`), right = document.getElementById(`v-${r}-${c+1}`);
    if (top?.dataset.claimed && bottom?.dataset.claimed && left?.dataset.claimed && right?.dataset.claimed) {
        const box = document.getElementById(`box-${r}-${c}`);
        if (!box.dataset.claimed) { 
            box.dataset.claimed = "true"; box.classList.add(`claimed-p${playerIndex}`); 
            if (isReplay) { box.style.animation = 'none'; box.style.opacity = 0.3; box.style.transform = 'scale(1)'; }
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
    if (scores.reduce((a, b) => a + b, 0) === boxesCount * boxesCount) {
        socket.emit('gameOver', currentRoom); 
        setTimeout(() => {
            const maxScore = Math.max(...scores); const winners = roomPlayers.filter((p, i) => scores[i] === maxScore);
            const winnerText = document.getElementById('winner-text');
            if (winners.length === 1) { winnerText.innerText = `${winners[0].name} Wins!`; winnerText.style.color = winners[0].color; } 
            else { winnerText.innerText = "It's a Tie!"; winnerText.style.color = "var(--ink-dark)"; }
            
            const list = document.getElementById('final-scores-list'); list.innerHTML = '';
            roomPlayers.forEach((p, i) => list.innerHTML += `<div style="color: ${p.color}">${p.name}: ${scores[i]}</div>`);
            
            document.getElementById('game-over-modal').classList.remove('hidden');
            localStorage.removeItem('dotsGame'); 
        }, 500); 
    }
}