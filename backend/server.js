const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ==================== [DATABASE MASTER USER PABRIKAN] ====================
// Seluruh Line Produksi Resmi ParagonCorp Terdaftar Otomatis (Lantai 1 & Lantai 2)
// Password seragam menggunakan "kemas" sesuai kultur packaging line
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

// API Login
app.post('/api/auth/login', (req, res) => {
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
app.post('/api/request/reset-all', (req, res) => {
    antreanTroli = [];
    antreanFG = [];
    historyLog = [];
    
    io.emit('FORCE_RESET_SCREEN'); 
    broadcastDataAwal();
    io.emit('HISTORY_UPDATE', historyLog);
    
    console.log("🧹 POKAYOKE: Seluruh database antrean aktif dan log riwayat telah dibersihkan!");
    return res.json({ success: true, message: "Seluruh antrean di server bersih total!" });
});

// API Request Baru
app.post('/api/request/baru', (req, res) => {
    const { line, lantai, jenisMedia } = req.body;
    
    const dataBaru = {
        id: Math.random().toString(36).substr(2, 9),
        line: line,
        lantai: lantai,
        jenisMedia: jenisMedia,
        waktu: new Date().toLocaleTimeString('id-ID') + ' WIB',
        waktuEpoch: Date.now(),
        status: 'WAITING'
    };
    
    if (jenisMedia === 'FG_FULL') {
        antreanFG.push(dataBaru);
    } else {
        antreanTroli.push(dataBaru);
    }
    
    io.emit('ANTREAN_BARU_MASUK', dataBaru);
    broadcastDataAwal();
    
    return res.status(201).json({ success: true, data: dataBaru });
});

// API Kirim Troli ke Lift
app.post('/api/request/kirim-troli', (req, res) => {
    const { id } = req.body;
    const index = antreanTroli.findIndex(item => item.id === id);
    if (index !== -1) {
        antreanTroli[index].status = 'DELIVERED';
        broadcastDataAwal();
        return res.json({ success: true });
    }
    return res.status(404).json({ success: false });
});

// API Selesai Eksekusi
app.post('/api/request/selesai', (req, res) => {
    const { id } = req.body;
    let dataSelesai = null;
    
    let indexTroli = antreanTroli.findIndex(item => item.id === id);
    if (indexTroli !== -1) dataSelesai = antreanTroli.splice(indexTroli, 1)[0];
    
    let indexFG = antreanFG.findIndex(item => item.id === id);
    if (!dataSelesai && indexFG !== -1) dataSelesai = antreanFG.splice(indexFG, 1)[0];
    
    if (dataSelesai) {
        dataSelesai.status = 'COMPLETED';
        dataSelesai.waktuSelesai = new Date().toLocaleTimeString('id-ID') + ' WIB';
        historyLog.push(dataSelesai);
        
        io.emit('ANTREAN_SELESAI_SYNC', id); 
        broadcastDataAwal();
        io.emit('HISTORY_UPDATE', historyLog);
        return res.json({ success: true });
    }
    return res.status(404).json({ success: false });
});

function broadcastDataAwal() {
    io.emit('DATA_ANTREAN_UPDATE', { troli: antreanTroli, fg: antreanFG });
}

io.on('connection', (socket) => {
    socket.emit('DATA_ANTREAN_UPDATE', { troli: antreanTroli, fg: antreanFG });
    socket.emit('HISTORY_UPDATE', historyLog);
});

// Jalankan server di port 3000
server.listen(3000, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 DHS ENGINE V2.6 ONLINE - PRODUCTION GO-LIVE READY`);
    console.log(`🏢 ALL STATIONS ACTIVATED: ${Object.keys(MASTER_USER_DB).length - 3} PACKAGING LINES LINKED`);
    console.log(`=======================================================`);
});