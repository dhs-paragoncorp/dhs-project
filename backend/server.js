const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// 1. Inisialisasi 'app'
const expressApp = express();

// 2. Folder static
expressApp.use(express.static(path.join(__dirname, '../')));

expressApp.use(cors());
expressApp.use(express.json());

const server = http.createServer(expressApp);

// 🛠️ FIX SOCKET DISCONNECT: Tambahkan konfigurasi pingInterval & pingTimeout yang lebih longgar
// agar browser tidak cepat memutuskan koneksi saat tab ditinggal di background.
const io = new Server(server, { 
    cors: { origin: "*" },
    pingInterval: 25000, // Kirim heartbeat tiap 25 detik
    pingTimeout: 60000   // Tunggu sampai 60 detik sebelum anggap disconnect
});

// ==================== [DATABASE MASTER USER PABRIKAN] ====================
const MASTER_USER_DB = {
    // 🏢 AREA LANTAI 1
    "stp01": { password: "kemas", line: "STP 01", lantai: 1, role: "OPERATOR" },
    "lip16": { password: "kemas", line: "LIP 16", lantai: 1, role: "OPERATOR" },
    "btp03": { password: "kemas", line: "BTP 03", lantai: 1, role: "OPERATOR" },
    "vsn05": { password: "kemas", line: "VSN 05", lantai: 1, role: "OPERATOR" },
    "vmn06": { password: "kemas", line: "VMN 06", lantai: 1, role: "OPERATOR" },
    "brp04": { password: "kemas", line: "BRP 04", lantai: 1, role: "OPERATOR" },
    "vmn05": { password: "kemas", line: "VMN 05", lantai: 1, role: "OPERATOR" },
    "vsn03": { password: "kemas", line: "VSN 03", lantai: 1, role: "OPERATOR" },
    "brp02": { password: "kemas", line: "BRP 02", lantai: 1, role: "OPERATOR" },
    "vam03": { password: "kemas", line: "VAM 03", lantai: 1, role: "OPERATOR" },
    "brp01": { password: "kemas", line: "BRP 01", lantai: 1, role: "OPERATOR" },

    // 🏢 AREA LANTAI 2
    "emp16": { password: "kemas", line: "EMP 16", lantai: 2, role: "OPERATOR" },
    "lip11": { password: "kemas", line: "LIP 11", lantai: 2, role: "OPERATOR" },
    "btp04": { password: "kemas", line: "BTP 04", lantai: 2, role: "OPERATOR" },
    "lip10": { password: "kemas", line: "LIP 10", lantai: 2, role: "OPERATOR" },
    "jrp02": { password: "kemas", line: "JRP 02", lantai: 2, role: "OPERATOR" },
    "fop03": { password: "kemas", line: "FOP 03", lantai: 2, role: "OPERATOR" },
    "btp01": { password: "kemas", line: "BTP 01", lantai: 2, role: "OPERATOR" },
    "btp02": { password: "kemas", line: "BTP 02", lantai: 2, role: "OPERATOR" },
    "lip18": { password: "kemas", line: "LIP 18", lantai: 2, role: "OPERATOR" },
    "vam02": { password: "kemas", line: "VAM 02", lantai: 2, role: "OPERATOR" },
    "sbp01": { password: "kemas", line: "SBP 01", lantai: 2, role: "OPERATOR" },
    "vmn04": { password: "kemas", line: "VMN 04", lantai: 2, role: "OPERATOR" },
    "lip09": { password: "kemas", line: "LIP 09", lantai: 2, role: "OPERATOR" },
    "lip06": { password: "kemas", line: "LIP 06", lantai: 2, role: "OPERATOR" },
    "lip08": { password: "kemas", line: "LIP 08", lantai: 2, role: "OPERATOR" },
    "alp03": { password: "kemas", line: "ALP 03", lantai: 2, role: "OPERATOR" },
    "lip12": { password: "kemas", line: "LIP 12", lantai: 2, role: "OPERATOR" },
    
    // 🚚 LOGISTIK TIM GUDANG KFG & DISPLAY
    "kfg_gudang": { password: "kfg123", line: "GUDANG KFG", lantai: 0, role: "KFG" },
    "kfg_tv": { password: "tv123", line: "TV MONITOR GUDANG", lantai: 0, role: "TV" },
    "qlt_center": { password: "qlt123", line: "ADMIN QLT", lantai: 0, role: "ADMIN" }
};

let antreanTroli = []; 
let antreanFG = [];    
let historyLog = [];   
let currentShift = 'SHIFT 1';

const lineLnt1 = ['STP 01','LIP 16','BTP 03','LIP 09','VSN 05','VMN 06','BRP 04','VMN 05','VSN 03','BRP 02','VAM 03','BRP 01'];
const lineLnt2 = ['EMP 16','LIP 11','BTP 04','LIP 10','JRP 02','FOP 03','BTP 01','BTP 02','LIP 18','VAM 02','SBP 01','VMN 04','LIP 09','LIP 06','LIP 08','ALP 03','LIP 12'];

// Helper untuk format Tanggal dan Jam Lengkap (WIB Lokal)
function getFormattedTimestamp() {
    const now = new Date();
    const tanggal = now.toLocaleDateString('id-ID'); // Format: DD/MM/YYYY
    const jam = now.toLocaleTimeString('id-ID');     // Format: HH:MM:SS WIB
    return `${tanggal} ${jam}`;
}

function resolveLineLantai(line) {
    if (!line) return 1;
    const normalized = String(line).trim().toUpperCase();
    if (lineLnt1.includes(normalized)) return 1;
    if (lineLnt2.includes(normalized)) return 2;
    return 1;
}

function completeRequestById(id) {
    let dataSelesai = null;
    const indexTroli = antreanTroli.findIndex(item => item.id === id);
    if (indexTroli !== -1) dataSelesai = antreanTroli.splice(indexTroli, 1)[0];

    const indexFG = antreanFG.findIndex(item => item.id === id);
    if (!dataSelesai && indexFG !== -1) dataSelesai = antreanFG.splice(indexFG, 1)[0];

    if (!dataSelesai) return null;

    dataSelesai.status = 'COMPLETED';
    dataSelesai.waktuSelesai = getFormattedTimestamp(); 
    historyLog.push(dataSelesai);
    
    io.emit('ANTREAN_SELESAI_SYNC', id);
    broadcastDataAwal();
    io.emit('HISTORY_UPDATE', historyLog);
    return dataSelesai;
}

// API Login
expressApp.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const userKey = String(username).toLowerCase().trim();
    const userRecord = MASTER_USER_DB[userKey];
    
    if (userRecord && userRecord.password === password) {
        return res.json({
            success: true,
            data: { username: userKey, line: userRecord.line, lantai: userRecord.lantai, role: userRecord.role }
        });
    }
    return res.status(401).json({ success: false, message: "Username/Password salah!" });
});

// PEMBERSIH GLOBAL RAM SERVER
expressApp.post('/api/request/reset-all', (req, res) => {
    antreanTroli = [];
    antreanFG = [];
    historyLog = [];
    
    io.emit('FORCE_RESET_SCREEN'); 
    broadcastDataAwal();
    io.emit('HISTORY_UPDATE', historyLog);
    
    console.log("🧹 POKAYOKE: Seluruh database antrean aktif dan log riwayat telah dibersihkan!");
    return res.json({ success: true, message: "Seluruh antrean di server bersih total!" });
});

// API Request Baru (Operator Minta)
expressApp.post('/api/request/baru', (req, res) => {
    const { line, lantai, jenisMedia, status } = req.body;
    const normalizedLine = String(line || '').trim().toUpperCase();
    const normalizedMedia = jenisMedia || 'TROLI_KECIL';
    
    const waktuMintaStr = getFormattedTimestamp(); 
    
    // 🛠️ FIX JAM CARD: Gunakan Date.now() real-time server agar hitungan timer di frontend akurat
    const epochSekarang = Date.now();

    const dataBaru = {
        id: Math.random().toString(36).substr(2, 9),
        line: normalizedLine,
        lantai: typeof lantai === 'number' ? lantai : resolveLineLantai(line),
        jenisMedia: normalizedMedia,
        waktu: waktuMintaStr,        
        waktuEpoch: epochSekarang,    // Kunci utama agar timer card berjalan pas dari 00:00
        waktuRelease: '-',            
        waktuSelesai: '-',            
        status: status || (normalizedMedia === 'FG_FULL' ? 'WAIT_QC' : 'WAIT_KFG')
    };
    
    if (normalizedMedia === 'FG_FULL') {
        antreanFG.push(dataBaru);
    } else {
        antreanTroli.push(dataBaru);
    }
    
    io.emit('ANTREAN_BARU_MASUK', dataBaru);
    broadcastDataAwal();
    
    return res.status(201).json({ success: true, data: dataBaru });
});

expressApp.get('/api/request/baru', (req, res) => {
    return res.json({ success: true, data: { troli: antreanTroli, fg: antreanFG } });
});

expressApp.get('/api/request/status', (req, res) => {
    return res.json({ success: true, data: { troli: antreanTroli, fg: antreanFG } });
});

// API Kirim Troli ke Lift
expressApp.post('/api/request/kirim-troli', (req, res) => {
    const { id } = req.body;
    const index = antreanTroli.findIndex(item => item.id === id);
    if (index !== -1) {
        antreanTroli[index].status = 'DELIVERED';
        broadcastDataAwal();
        return res.json({ success: true });
    }
    return res.status(404).json({ success: false });
});

// API QC Release
expressApp.post('/api/request/qc-release', (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });
    
    const idx = antreanFG.findIndex(item => item.id === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Task not found' });

    antreanFG[idx].status = 'READY_KFG';
    antreanFG[idx].waktuRelease = getFormattedTimestamp(); 
    // Perbarui juga waktuReleaseEpoch agar timer FG Full berjalan tepat setelah dirilis QC
    antreanFG[idx].waktuReleaseEpoch = Date.now(); 

    io.emit('ANTREAN_BARU_MASUK', antreanFG[idx]);
    broadcastDataAwal();
    console.log(`QC release processed for id ${id} at ${antreanFG[idx].waktuRelease}`);
    return res.json({ success: true, data: antreanFG[idx] });
});

// API Selesai Eksekusi
expressApp.post('/api/request/selesai', (req, res) => {
    const { id } = req.body;
    const completed = completeRequestById(id);
    if (completed) {
        return res.json({ success: true });
    }
    return res.status(404).json({ success: false, message: 'Task not found' });
});

function broadcastDataAwal() {
    io.emit('DATA_ANTREAN_UPDATE', { troli: antreanTroli, fg: antreanFG });
}

io.on('connection', (socket) => {
    socket.emit('DATA_ANTREAN_UPDATE', { troli: antreanTroli, fg: antreanFG });
    socket.emit('HISTORY_UPDATE', historyLog);

    socket.on('GANTI_SHIFT', (data) => {
        currentShift = data.shift;
        io.emit('GANTI_SHIFT', data);
    });

    socket.on('KFG_SELESAI_TARIK', ({ id }) => {
        if (!id) return;
        const completed = completeRequestById(id);
        if (completed) {
            socket.emit('KFG_SELESAI_ACK', { id, success: true });
        } else {
            socket.emit('KFG_SELESAI_ACK', { id, success: false });
        }
    });
});

expressApp.get('/api/current-shift', (req, res) => {
    res.json({ shift: currentShift });
});

const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`ERROR: Port ${PORT} sudah digunakan.`);
    } else {
        console.error('Server error:', err);
    }
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 DHS ENGINE V2.6 ONLINE - PRODUCTION GO-LIVE READY`);
    console.log(`📡 Listening on port ${PORT}`);
    console.log(`=======================================================`);
});