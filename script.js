const socket = io();

// State
let username = "";
let currentRoom = "";
let isHost = false;
let timerInterval;

// DOM Helpers
const getEl = (id) => document.getElementById(id);
const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    getEl(id).classList.add('active');
};

// 1. INPUT NAMA
getEl('name-input').addEventListener('input', (e) => {
    getEl('submit-name').disabled = e.target.value.trim() === "";
});
getEl('submit-name').addEventListener('click', () => {
    username = getEl('name-input').value.trim();
    if(username) {
        getEl('display-username').innerText = username;
        showScreen('start-menu');
    }
});

// 2. NAVIGASI MENU
getEl('btn-mabar').onclick = () => showScreen('multiplayer-menu');
getEl('btn-create-host').onclick = () => {
    getEl('host-panel').classList.remove('hidden');
    getEl('join-panel').classList.add('hidden');
    getEl('btn-create-host').classList.add('active');
    getEl('btn-join-room').classList.remove('active');
    socket.emit('hostRoom', username);
    isHost = true;
};
getEl('btn-join-room').onclick = () => {
    getEl('join-panel').classList.remove('hidden');
    getEl('host-panel').classList.add('hidden');
    getEl('btn-join-room').classList.add('active');
    getEl('btn-create-host').classList.remove('active');
    isHost = false;
};

// 3. SOCKET LOGIC
socket.on('roomCreated', (code, players) => {
    currentRoom = code;
    getEl('room-code').innerText = code;
    updateLobby(players);
});

socket.on('playerUpdate', (players) => updateLobby(players));

getEl('confirm-join').onclick = () => {
    const code = getEl('join-code-input').value.trim().toUpperCase();
    if(code) socket.emit('joinRoom', code, username);
};

socket.on('roomError', (msg) => alert(msg));
getEl('start-game-btn').onclick = () => socket.emit('startGame', currentRoom);

// --- START SOAL (DIPERBAIKI) ---
socket.on('questionStart', (q, idx) => {
    currentRoom = currentRoom || "SOLO"; 
    showScreen('quiz-area');
    renderQuestion(q, idx);
});

// HASIL JAWABAN
socket.on('answerResult', (data) => {
    const toast = getEl('result-message');
    toast.innerHTML = data.message; // Support HTML (Tebal)
    toast.className = `toast ${data.isCorrect ? 'correct' : 'incorrect'}`;
    toast.classList.remove('hidden');
});

// SCORE UPDATE
socket.on('scoreUpdate', (players) => {
    const me = players.find(p => p.id === socket.id);
    if(me) getEl('current-score').innerText = me.score;
});

// GAME OVER
socket.on('gameOver', (players) => {
    showScreen('game-over');
    const me = players.find(p => p.id === socket.id);
    getEl('final-score').innerText = me ? me.score : 0;

    const list = getEl('leaderboard-list');
    list.innerHTML = "";
    players.sort((a,b) => b.score - a.score).forEach((p, i) => {
        list.innerHTML += `<li style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee">
            <span>#${i+1} <b>${p.name}</b></span> <span>${p.score} pts</span>
        </li>`;
    });
});

// --- HELPERS ---
function updateLobby(players) {
    if(isHost) {
        getEl('host-player-list').innerHTML = players.map(p => `<li><i class="fas fa-user"></i> ${p.name}</li>`).join('');
        getEl('player-count').innerText = players.length;
        const btn = getEl('start-game-btn');
        if(players.length >= 2) {
            btn.disabled = false;
            btn.innerHTML = "MULAI GAME SEKARANG <i class='fas fa-play'></i>";
        } else {
            btn.disabled = true;
            btn.innerHTML = "Tunggu Min. 2 Pemain...";
        }
    } else {
        getEl('join-lobby-display').classList.remove('hidden');
        currentRoom = getEl('join-code-input').value.toUpperCase();
        getEl('join-player-list').innerHTML = players.map(p => `<li><i class="fas fa-user"></i> ${p.name}</li>`).join('');
    }
}

function renderQuestion(q, idx) {
    getEl('q-number').innerText = `Soal ${idx}/40`;
    getEl('q-text').innerHTML = q.question; // innerHTML untuk text tebal
    getEl('result-message').classList.add('hidden');
    const area = getEl('answer-area');
    area.innerHTML = "";

    // RESET & START TIMER
    clearInterval(timerInterval);
    let t = 30;
    getEl('time-left').innerText = t;
    
    timerInterval = setInterval(() => {
        t--;
        getEl('time-left').innerText = t;
        if(t <= 0) {
            clearInterval(timerInterval);
            // WAKTU HABIS: Kirim jawaban NULL
            sendAns(null, 0);
        }
    }, 1000);

    // RENDER TOMBOL
    if(q.type === 'pg') {
        q.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'opt-btn';
            btn.innerText = opt;
            btn.onclick = () => sendAns(opt, t);
            area.appendChild(btn);
        });
    } else if (q.type === 'bs') {
        ['Benar', 'Salah'].forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'opt-btn';
            btn.style.textAlign = 'center';
            btn.style.fontWeight = 'bold';
            btn.style.color = opt === 'Benar' ? '#00b894' : '#d63031';
            btn.innerText = opt;
            btn.onclick = () => sendAns(opt, t);
            area.appendChild(btn);
        });
    } else if (q.type === 'isian') {
        area.innerHTML = `
            <input type="text" id="isian-input" placeholder="Jawaban..." class="big-input" autocomplete="off" style="margin-bottom:10px">
            <button id="kirim-isian" class="btn-main">Kirim</button>
        `;
        getEl('kirim-isian').onclick = () => sendAns(getEl('isian-input').value, t);
    }
}

function sendAns(ans, t) {
    clearInterval(timerInterval);
    // Disable semua input agar tidak jawab 2x
    const all = document.querySelectorAll('.opt-btn, #isian-input, #kirim-isian');
    all.forEach(el => el.disabled = true);
    
    socket.emit('submitAnswer', { roomCode: currentRoom, answer: ans, timeLeft: t });
}