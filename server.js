const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3008;
const MIN_PLAYERS = 2; 
const MAX_PLAYERS = 24;
const QUESTION_TIMER = 30; // Waktu jawab (detik)

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- DATA SOAL (40 Soal: PG, Isian, BS) ---
const quizData = [
    // 1-35 PG (Contoh sebagian, format <b> didukung)
    { type: "pg", question: "Data yang disajikan berupa <b>angka</b> disebut...", options: ["Kualitatif", "Kuantitatif", "Deskriptif", "Naratif"], correct: "Kuantitatif" },
    { type: "pg", question: "Tanda baca kalimat <b>imperatif</b> adalah...", options: ["?", ".", "!", ","], correct: "!" },
    { type: "pg", question: "Langkah pertama menulis artikel ilmiah adalah...", options: ["Observasi", "Menentukan topik", "Mencari sumber", "Plagiasi"], correct: "Menentukan topik" },
    { type: "pg", question: "Lawan kata (makna pertentangan) disebut...", options: ["Sinonim", "Antonim", "Homonim", "Polisemi"], correct: "Antonim" },
    { type: "pg", question: "Persamaan makna kata disebut...", options: ["Sinonim", "Antonim", "Akronim", "Hipernim"], correct: "Sinonim" },
    // ... (Tambahkan sisa soal PG Anda di sini) ...
    
    // 36-38 ISIAN
    { type: "isian", question: "Iklan makanan dan minuman termasuk jenis iklan...", answer: "Penawaran" },
    { type: "isian", question: "Kalimat 'Ayo hemat listrik!' adalah kalimat...", answer: "Persuasif" },
    { type: "isian", question: "Media promosi barang paling efektif adalah...", answer: "Iklan" },

    // 39-40 BENAR/SALAH
    { type: "bs", question: "Artikel ilmiah populer <b>dilarang</b> menggunakan kata 'saya'.", answer: "Salah" },
    { type: "bs", question: "Bagian penutup wajib berisi penegasan ulang.", answer: "Benar" }
];

const ROOMS = {}; 

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    // --- HOST ROOM ---
    socket.on('hostRoom', (username) => {
        let roomCode = generateRoomCode();
        while (ROOMS[roomCode]) roomCode = generateRoomCode();

        ROOMS[roomCode] = {
            hostId: socket.id,
            players: [{ id: socket.id, name: username, score: 0 }],
            status: 'waiting',
            currentQuestionIndex: 0,
            answerCount: 0,
            timer: null // Timer Server (Wasit)
        };

        socket.join(roomCode);
        socket.emit('roomCreated', roomCode, ROOMS[roomCode].players);
    });

    // --- JOIN ROOM ---
    socket.on('joinRoom', (roomCode, username) => {
        const room = ROOMS[roomCode];
        if (!room) return socket.emit('roomError', 'Kode Room tidak valid.');
        if (room.status !== 'waiting') return socket.emit('roomError', 'Game sedang berjalan.');
        if (room.players.length >= MAX_PLAYERS) return socket.emit('roomError', 'Room penuh.');

        socket.join(roomCode);
        room.players.push({ id: socket.id, name: username, score: 0 });
        io.to(roomCode).emit('playerUpdate', room.players);
    });

    // --- START GAME ---
    socket.on('startGame', (roomCode) => {
        const room = ROOMS[roomCode];
        if (!room || socket.id !== room.hostId) return;
        if (room.players.length < MIN_PLAYERS) return;

        room.status = 'active';
        room.currentQuestionIndex = 0;
        sendQuestion(roomCode);
    });

    // --- TERIMA JAWABAN ---
    socket.on('submitAnswer', ({ roomCode, answer, timeLeft }) => {
        const room = ROOMS[roomCode];
        if (!room || room.status !== 'active') return;

        const player = room.players.find(p => p.id === socket.id);
        // Cegah jawaban ganda
        if (!player || player.hasAnswered) return;

        player.hasAnswered = true;
        room.answerCount++;

        // Logika Koreksi
        const question = quizData[room.currentQuestionIndex];
        let isCorrect = false;
        
        // Handle jawaban NULL (Waktu habis di client)
        if (answer !== null) {
            let correctText = question.answer || question.correct;
            if (question.type === 'pg' && answer === question.correct) isCorrect = true;
            else if (question.type === 'bs' && answer === question.answer) isCorrect = true;
            else if (question.type === 'isian' && answer.toLowerCase().trim() === correctText.toLowerCase().trim()) isCorrect = true;
        }

        if (isCorrect) {
            const points = 100 + (timeLeft * 5);
            player.score += points;
            socket.emit('answerResult', { isCorrect: true, message: "✅ BENAR!" });
        } else {
            let correctText = question.answer || question.correct;
            socket.emit('answerResult', { isCorrect: false, message: `❌ SALAH. Jawaban: <b>${correctText}</b>` });
        }

        // Update Skor ke Semua
        io.to(roomCode).emit('scoreUpdate', room.players);

        // CEK APAKAH SEMUA SUDAH MENJAWAB?
        if (room.answerCount >= room.players.length) {
            // Matikan timer server karena semua sudah jawab
            clearTimeout(room.timer);
            // Lanjut soal (beri jeda 2 detik biar baca hasil dulu)
            setTimeout(() => nextQuestion(roomCode), 2000);
        }
    });

    // --- FUNGSI KIRIM SOAL ---
    function sendQuestion(roomCode) {
        const room = ROOMS[roomCode];
        if (!room) return;

        const question = quizData[room.currentQuestionIndex];
        
        // Reset status pemain untuk soal baru
        room.players.forEach(p => p.hasAnswered = false);
        room.answerCount = 0;

        // Kirim soal ke Client
        io.to(roomCode).emit('questionStart', question, room.currentQuestionIndex + 1);

        // NYALAKAN TIMER SERVER (WASIT)
        // Set waktu sedikit lebih lama dari client (30s + 2s buffer) untuk toleransi lag
        if (room.timer) clearTimeout(room.timer);
        room.timer = setTimeout(() => {
            console.log(`Waktu habis di room ${roomCode}, memaksa lanjut.`);
            nextQuestion(roomCode);
        }, (QUESTION_TIMER + 2) * 1000);
    }

    // --- FUNGSI LANJUT SOAL ---
    function nextQuestion(roomCode) {
        const room = ROOMS[roomCode];
        if (!room) return;

        // Matikan timer lama jika ada
        if (room.timer) clearTimeout(room.timer);

        room.currentQuestionIndex++;

        if (room.currentQuestionIndex < quizData.length) {
            sendQuestion(roomCode);
        } else {
            // Game Selesai
            io.to(roomCode).emit('gameOver', room.players);
            delete ROOMS[roomCode];
        }
    }

    // Disconnect Handler (Penting agar answerCount tidak macet jika pemain keluar)
    socket.on('disconnect', () => {
        // Cari socket ini ada di room mana
        for (const code in ROOMS) {
            const room = ROOMS[code];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                room.players.splice(pIndex, 1);
                io.to(code).emit('playerUpdate', room.players);
                
                // Jika sedang main dan pemain keluar, cek apakah sisa pemain sudah jawab semua
                if (room.status === 'active' && room.answerCount >= room.players.length) {
                    clearTimeout(room.timer);
                    nextQuestion(code);
                }
                break;
            }
        }
    });
});

server.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));