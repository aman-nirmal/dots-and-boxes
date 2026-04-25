const socket = io();

// UI Elements
const landingScreen = document.getElementById('landing-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverModal = document.getElementById('game-over-modal');

const turnDisplay = document.getElementById('turn-display');
const p1ScoreEl = document.getElementById('p1-score');
const p2ScoreEl = document.getElementById('p2-score');
const p1NameEl = document.getElementById('p1-name-display');
const p2NameEl = document.getElementById('p2-name-display');

// Colors Palette
const paletteColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

let currentRoom = '';
let myPlayerId = 1; 
let currentTurn = 1; 
let p1Score = 0; let p2Score = 0;
let p1Name = 'Player 1'; let p2Name = 'Player 2';

const dotsCount = 10; 
const boxesCount = dotsCount - 1; 
const totalBoxesToWin = boxesCount * boxesCount;

// --- INITIALIZE UI ---
function renderPalette(containerId, inputId, defaultColor) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    input.value = defaultColor;

    paletteColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = color;
        if(color === defaultColor) swatch.classList.add('selected');
        
        swatch.onclick = () => {
            container.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            input.value = color;
        };
        container.appendChild(swatch);
    });
}

renderPalette('player-palette', 'player-color', '#3b82f6'); 

// --- NETWORK LOGIC ---
document.getElementById('host-btn').addEventListener('click', () => { 
    const name = document.getElementById('player-name').value || 'P1';
    const color = document.getElementById('player-color').value;
    socket.emit('createGame', { name, color }); 
});

document.getElementById('join-btn').addEventListener('click', () => {
    const code = document.getElementById('room-input').value.toUpperCase();
    const name = document.getElementById('player-name').value || 'P2';
    const color = document.getElementById('player-color').value;
    
    if (code.length > 0) socket.emit('joinGame', { roomCode: code, name, color });
});

socket.on('gameCreated', (roomCode) => {
    myPlayerId = 1; 
    currentRoom = roomCode;
    document.getElementById('room-code-display').innerText = roomCode;
    switchScreen(lobbyScreen);
});

socket.on('gameStarted', (data) => {
    if (!currentRoom) myPlayerId = 2; 
    currentRoom = data.roomCode;
    
    p1Name = data.p1Name; p2Name = data.p2Name;
    p1NameEl.innerText = p1Name; p2NameEl.innerText = p2Name;
    
    document.documentElement.style.setProperty('--p1-color', data.p1Color);
    document.documentElement.style.setProperty('--p2-color', data.p2Color);
    
    switchScreen(gameScreen);
    resetLocalGame();
});

socket.on('receiveMove', (moveData) => { processMove(moveData.lineId, moveData.player); });

document.getElementById('rematch-btn').addEventListener('click', () => { socket.emit('requestRematch', currentRoom); });
socket.on('resetBoard', () => { resetLocalGame(); });

function switchScreen(screen) {
    document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
    screen.classList.remove('hidden'); screen.classList.add('active');
}

// --- GAME LOGIC ---

function resetLocalGame() {
    p1Score = 0; p2Score = 0; currentTurn = 1;
    gameOverModal.classList.add('hidden');
    initBoard(); updateUI();
}

function initBoard() {
    const container = document.querySelector('.board-container');
    container.innerHTML = ''; 
    const spacing = 40;   
    const dotSize = 8; 
    const lineThickness = 6; 

    for (let r = 0; r < dotsCount; r++) {
        for (let c = 0; c < dotsCount; c++) {
            const dot = document.createElement('div');
            dot.className = 'dot';
            dot.style.left = `${c * spacing}px`; dot.style.top = `${r * spacing}px`;
            container.appendChild(dot);

            if (c < dotsCount - 1) {
                const hLine = document.createElement('div');
                hLine.className = 'line h-line'; hLine.id = `h-${r}-${c}`;
                hLine.style.left = `${c * spacing + dotSize}px`; hLine.style.top = `${r * spacing + (dotSize - lineThickness)/2}px`;
                hLine.style.width = `${spacing - dotSize}px`; hLine.style.height = `${lineThickness}px`;
                setupLineClick(hLine); container.appendChild(hLine);
            }

            if (r < dotsCount - 1) {
                const vLine = document.createElement('div');
                vLine.className = 'line v-line'; vLine.id = `v-${r}-${c}`;
                vLine.style.left = `${c * spacing + (dotSize - lineThickness)/2}px`; vLine.style.top = `${r * spacing + dotSize}px`;
                vLine.style.width = `${lineThickness}px`; vLine.style.height = `${spacing - dotSize}px`;
                setupLineClick(vLine); container.appendChild(vLine);
            }
            
            if (r < dotsCount - 1 && c < dotsCount - 1) {
                const box = document.createElement('div');
                box.className = 'box'; box.id = `box-${r}-${c}`;
                box.style.left = `${c * spacing + dotSize}px`; box.style.top = `${r * spacing + dotSize}px`;
                box.style.width = `${spacing - dotSize}px`; box.style.height = `${spacing - dotSize}px`;
                container.appendChild(box);
            }
        }
    }
}

function setupLineClick(lineElement) {
    lineElement.addEventListener('click', () => {
        if (currentTurn !== myPlayerId) return;
        if (lineElement.dataset.claimed === "true") return;

        socket.emit('makeMove', { roomCode: currentRoom, moveData: { lineId: lineElement.id, player: myPlayerId } });
    });
}

function processMove(lineId, player) {
    const line = document.getElementById(lineId);
    line.classList.add(`claimed-p${player}`);
    line.dataset.claimed = "true";

    let boxesScored = calculateBoxes(lineId, player);

    if (boxesScored > 0) {
        if (player === 1) p1Score += boxesScored;
        if (player === 2) p2Score += boxesScored;
    } else {
        currentTurn = currentTurn === 1 ? 2 : 1;
    }
    
    updateUI(); checkWinCondition();
}

function calculateBoxes(lineId, player) {
    const parts = lineId.split('-'); const type = parts[0]; const r = parseInt(parts[1]); const c = parseInt(parts[2]);
    let formed = 0;
    if (type === 'h') {
        if (r > 0 && checkBox(r - 1, c, player)) formed++; 
        if (r < boxesCount && checkBox(r, c, player)) formed++; 
    } else if (type === 'v') {
        if (c > 0 && checkBox(r, c - 1, player)) formed++; 
        if (c < boxesCount && checkBox(r, c, player)) formed++; 
    }
    return formed;
}

function checkBox(r, c, player) {
    const top = document.getElementById(`h-${r}-${c}`);
    const bottom = document.getElementById(`h-${r+1}-${c}`);
    const left = document.getElementById(`v-${r}-${c}`);
    const right = document.getElementById(`v-${r}-${c+1}`);

    if (top?.dataset.claimed && bottom?.dataset.claimed && left?.dataset.claimed && right?.dataset.claimed) {
        const box = document.getElementById(`box-${r}-${c}`);
        if (!box.dataset.claimed) {
            box.dataset.claimed = "true"; box.classList.add(`claimed-p${player}`); return true;
        }
    }
    return false;
}

function updateUI() {
    p1ScoreEl.innerText = p1Score; p2ScoreEl.innerText = p2Score;
    if (currentTurn === myPlayerId) {
        turnDisplay.innerText = "YOUR TURN"; turnDisplay.style.textDecoration = "underline";
    } else {
        const oppName = myPlayerId === 1 ? p2Name : p1Name;
        turnDisplay.innerText = `${oppName}'S TURN`; turnDisplay.style.textDecoration = "none";
    }
}

function checkWinCondition() {
    if (p1Score + p2Score === totalBoxesToWin) {
        setTimeout(() => {
            const winnerText = document.getElementById('winner-text');
            const finalP1 = document.getElementById('final-p1');
            const finalP2 = document.getElementById('final-p2');

            if (p1Score > p2Score) {
                winnerText.innerText = `${p1Name} Wins!`; winnerText.style.color = "var(--p1-color)";
            } else if (p2Score > p1Score) {
                winnerText.innerText = `${p2Name} Wins!`; winnerText.style.color = "var(--p2-color)";
            } else {
                winnerText.innerText = "It's a Tie!"; winnerText.style.color = "var(--ink-dark)";
            }

            finalP1.innerText = `${p1Name}: ${p1Score}`; finalP2.innerText = `${p2Name}: ${p2Score}`;
            gameOverModal.classList.remove('hidden');
        }, 500); 
    }
}