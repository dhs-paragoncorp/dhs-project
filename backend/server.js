const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const webpush = require('web-push');

// 1. Inisialisasi 'app'
const expressApp = express();

// 2. Folder static
expressApp.use(express.static(path.join(__dirname, '../')));

expressApp.use(cors());
expressApp.use(express.json());

// ==================== [HEALTH CHECK ROUTE UNTUK UPTIMEROBOT] ====================
expressApp.get('/', (req, res) => {
    return res.status(200).send('DHS Engine Server is Alive and Running!');
});

expressApp.get('/api/push/public-key', (req, res) => {
    if (!pushConfigured) {
        return res.status(503).json({ success: false, message: 'Konfigurasi Web Push belum tersedia di server.' });
    }
    return res.json({ success: true, publicKey: vapidPublicKey });
});

expressApp.post('/api/push/subscribe', (req, res) => {
    if (!pushConfigured) {
        return res.status(503).json({ success: false, message: 'Konfigurasi Web Push belum tersedia di server.' });
    }

    const subscription = req.body?.subscription;
    if (!isValidPushSubscription(subscription)) {
        return res.status(400).json({ success: false, message: 'Subscription Web Push tidak valid atau tidak didukung.' });
    }

    const subscriptions = pushSubscriptions.filter(item => item.endpoint !== subscription.endpoint);
    if (subscriptions.length >= MAX_PUSH_SUBSCRIPTIONS) {
        return res.status(429).json({ success: false, message: 'Batas perangkat Web Push sudah tercapai.' });
    }
    subscriptions.push(subscription);
    try {
        persistPushSubscriptions(subscriptions);
        pushSubscriptions = subscriptions;
    } catch (error) {
        console.error('Gagal menyimpan subscription Web Push:', error.message);
        return res.status(500).json({ success: false, message: 'Subscription Web Push gagal disimpan.' });
    }

    getWaitingQcTasks().forEach(task => {
        void sendQcPushNotification(task, [subscription]);
    });
    return res.status(201).json({ success: true });
});

expressApp.post('/api/push/operator-subscribe', (req, res) => {
    if (!pushConfigured) {
        return res.status(503).json({ success: false, message: 'Konfigurasi Web Push belum tersedia di server.' });
    }

    const subscription = req.body?.subscription;
    const line = String(req.body?.line || '').trim().toUpperCase();
    const username = String(req.body?.username || '').trim().toLowerCase();
    const knownLines = new Set([...lineLnt1, ...lineLnt2]);
    const userRecord = MASTER_USER_DB[username];
    if (!isValidPushSubscription(subscription) || !knownLines.has(line) ||
        !userRecord || userRecord.role !== 'OPERATOR' ||
        String(userRecord.line || '').trim().toUpperCase() !== line) {
        return res.status(400).json({ success: false, message: 'Subscription atau data akun Operator tidak valid.' });
    }

    const operatorSubscription = {
        ...subscription,
        pushRole: 'OPERATOR',
        pushLine: line,
        pushUsername: username
    };
    const subscriptions = pushSubscriptions.filter(item => item.endpoint !== subscription.endpoint);
    if (subscriptions.length >= MAX_PUSH_SUBSCRIPTIONS) {
        return res.status(429).json({ success: false, message: 'Batas perangkat Web Push sudah tercapai.' });
    }
    subscriptions.push(operatorSubscription);
    try {
        persistPushSubscriptions(subscriptions);
        pushSubscriptions = subscriptions;
    } catch (error) {
        console.error('Gagal menyimpan subscription Web Push Operator:', error.message);
        return res.status(500).json({ success: false, message: 'Subscription Web Push Operator gagal disimpan.' });
    }
    return res.status(201).json({ success: true });
});

expressApp.delete('/api/push/subscribe', (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') {
        return res.status(400).json({ success: false, message: 'Endpoint subscription wajib diisi.' });
    }

    const subscriptions = pushSubscriptions.filter(item => item.endpoint !== endpoint);
    try {
        persistPushSubscriptions(subscriptions);
        pushSubscriptions = subscriptions;
    } catch (error) {
        console.error('Gagal menghapus subscription Web Push:', error.message);
        return res.status(500).json({ success: false, message: 'Subscription Web Push gagal dihapus.' });
    }
    return res.json({ success: true });
});

const server = http.createServer(expressApp);

// 🛠️ FIX SOCKET DISCONNECT: Konfigurasi pingInterval & pingTimeout yang lebih longgar
const io = new Server(server, { 
    cors: { origin: "*" },
    pingInterval: 25000, 
    pingTimeout: 60000   
});

// ==================== [DATABASE MASTER USER AMAN (DARI ENV)] ====================
let MASTER_USER_DB = {};

if (process.env.USERS_JSON) {
    try {
        MASTER_USER_DB = JSON.parse(process.env.USERS_JSON);
    } catch (err) {
        console.error("Gagal membaca USERS_JSON dari Environment Variable:", err);
    }
} else {
    console.warn("PERINGATAN: USERS_JSON belum diatur di Render Environment Variables!");
}

let antreanTroli = []; 
let antreanFG = [];    
let historyLog = [];   
let currentShift = 'SHIFT 1';
let historySheetsReadStatus = 'loading';
const QC_WAITING_STATUSES = new Set(['WAIT_QC', 'WAITING', 'WAIT_KFG']);
const QC_PUSH_REPEAT_DELAY = 10 * 60 * 1000;
const MAX_PUSH_SUBSCRIPTIONS = 100;
const qcPushNextAt = new Map();
const publicRoot = path.resolve(__dirname, '../');
const pushSubscriptionsPath = process.env.PUSH_SUBSCRIPTIONS_FILE
    ? path.resolve(process.env.PUSH_SUBSCRIPTIONS_FILE)
    : path.join(os.homedir(), '.dhs-project', 'push-subscriptions.json');
const vapidKeysPath = process.env.PUSH_VAPID_FILE
    ? path.resolve(process.env.PUSH_VAPID_FILE)
    : path.join(os.homedir(), '.dhs-project', 'vapid-keys.json');
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
let pushConfigured = false;
let pushSubscriptions = [];

function isValidPushSubscription(subscription) {
    if (!subscription || typeof subscription.endpoint !== 'string' ||
        subscription.endpoint.length > 2048 ||
        typeof subscription.keys?.p256dh !== 'string' ||
        subscription.keys.p256dh.length > 256 ||
        typeof subscription.keys?.auth !== 'string') {
        return false;
    }
    if (subscription.keys.auth.length > 256) return false;

    try {
        const endpoint = new URL(subscription.endpoint);
        const host = endpoint.hostname.toLowerCase();
        const supportedHost = host === 'fcm.googleapis.com' ||
            host === 'fcmregistrations.googleapis.com' ||
            host === 'web.push.apple.com' ||
            host === 'notify.windows.com' ||
            host === 'push.services.mozilla.com' ||
            host.endsWith('.push.services.mozilla.com') ||
            host.endsWith('.notify.windows.com');
        return endpoint.protocol === 'https:' && !endpoint.port &&
            !endpoint.username && !endpoint.password && supportedHost;
    } catch (error) {
        return false;
    }
}

function isInsidePublicRoot(filePath) {
    const relativePath = path.relative(publicRoot, path.resolve(filePath));
    return relativePath === '' ||
        (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

if (isInsidePublicRoot(pushSubscriptionsPath) || isInsidePublicRoot(vapidKeysPath)) {
    throw new Error('File Web Push harus disimpan di luar folder frontend yang disajikan secara publik.');
}

if (fs.existsSync(pushSubscriptionsPath)) {
    const savedSubscriptions = JSON.parse(fs.readFileSync(pushSubscriptionsPath, 'utf8'));
    if (!Array.isArray(savedSubscriptions) || savedSubscriptions.some(subscription => !isValidPushSubscription(subscription))) {
        throw new Error(`Data subscription Web Push tidak valid: ${pushSubscriptionsPath}`);
    }
    pushSubscriptions = savedSubscriptions;
}

if (!vapidPublicKey && !vapidPrivateKey) {
    try {
        if (fs.existsSync(vapidKeysPath)) {
            const savedKeys = JSON.parse(fs.readFileSync(vapidKeysPath, 'utf8'));
            if (!savedKeys || typeof savedKeys.publicKey !== 'string' || typeof savedKeys.privateKey !== 'string') {
                throw new Error(`Data VAPID tidak valid: ${vapidKeysPath}`);
            }
            vapidPublicKey = savedKeys.publicKey;
            vapidPrivateKey = savedKeys.privateKey;
        } else {
            const generatedKeys = webpush.generateVAPIDKeys();
            vapidPublicKey = generatedKeys.publicKey;
            vapidPrivateKey = generatedKeys.privateKey;
            fs.mkdirSync(path.dirname(vapidKeysPath), { recursive: true });
            fs.writeFileSync(vapidKeysPath, JSON.stringify(generatedKeys, null, 2), {
                encoding: 'utf8',
                mode: 0o600
            });
            console.log(`Kunci VAPID Web Push dibuat dan disimpan di ${vapidKeysPath}.`);
        }
    } catch (error) {
        console.error('Gagal memuat atau membuat kunci VAPID Web Push:', error.message);
    }
}

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
    try {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        pushConfigured = true;
    } catch (error) {
        console.error('Konfigurasi VAPID Web Push tidak valid:', error.message);
    }
} else {
    console.error('Web Push belum aktif. Periksa VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, dan VAPID_SUBJECT.');
}

function persistPushSubscriptions(subscriptions) {
    fs.mkdirSync(path.dirname(pushSubscriptionsPath), { recursive: true });
    fs.writeFileSync(pushSubscriptionsPath, JSON.stringify(subscriptions, null, 2), {
        encoding: 'utf8',
        mode: 0o600
    });
}

function getWaitingQcTasks() {
    return antreanFG.filter(task => task.jenisMedia === 'FG_FULL' && QC_WAITING_STATUSES.has(task.status));
}

async function sendQcPushNotification(task, subscriptions = pushSubscriptions) {
    if (!pushConfigured || subscriptions.length === 0) return;

    const payload = JSON.stringify({
        title: 'FG Full menunggu QC Release',
        body: `${task.line} • Lantai ${task.lantai || '-'} • Belum di-release`,
        taskId: task.id,
        url: 'data-center.html'
    });
    const results = await Promise.allSettled(subscriptions.map(subscription =>
        webpush.sendNotification(subscription, payload, { TTL: 60, urgency: 'high' })
    ));
    const expiredEndpoints = [];

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const statusCode = result.reason?.statusCode;
            console.error(`Gagal mengirim Web Push untuk task ${task.id}:`, result.reason?.message || result.reason);
            if (statusCode === 404 || statusCode === 410) {
                expiredEndpoints.push(subscriptions[index].endpoint);
            }
        }
    });

    if (expiredEndpoints.length) {
        const remainingSubscriptions = pushSubscriptions.filter(subscription =>
            !expiredEndpoints.includes(subscription.endpoint)
        );
        try {
            persistPushSubscriptions(remainingSubscriptions);
            pushSubscriptions = remainingSubscriptions;
        } catch (error) {
            console.error('Gagal menghapus subscription Web Push yang kedaluwarsa:', error.message);
        }
    }
}

async function sendOperatorPushNotification(task) {
    if (!pushConfigured) return;
    const subscriptions = pushSubscriptions.filter(subscription =>
        subscription.pushRole === 'OPERATOR' &&
        subscription.pushLine === task.line
    );
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
        title: 'Troli sudah dikirim ke lift',
        body: `${task.jenisMedia === 'TROLI_KECIL' ? 'Pallet kayu' : 'Troli besar'} untuk ${task.line} sudah di lift. Silakan konfirmasi penerimaan.`,
        taskId: task.id,
        tag: `dhs-operator-${task.id}`,
        url: 'operator.html'
    });
    const results = await Promise.allSettled(subscriptions.map(subscription =>
        webpush.sendNotification(subscription, payload, { TTL: 60, urgency: 'high' })
    ));
    const expiredEndpoints = [];

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const statusCode = result.reason?.statusCode;
            console.error(`Gagal mengirim Web Push Operator untuk task ${task.id}:`, result.reason?.message || result.reason);
            if (statusCode === 404 || statusCode === 410) {
                expiredEndpoints.push(subscriptions[index].endpoint);
            }
        }
    });

    if (expiredEndpoints.length) {
        const remainingSubscriptions = pushSubscriptions.filter(subscription =>
            !expiredEndpoints.includes(subscription.endpoint)
        );
        try {
            persistPushSubscriptions(remainingSubscriptions);
            pushSubscriptions = remainingSubscriptions;
        } catch (error) {
            console.error('Gagal menghapus subscription Operator yang kedaluwarsa:', error.message);
        }
    }
}

setInterval(() => {
    const now = Date.now();
    const waitingTasks = getWaitingQcTasks();
    const waitingIds = new Set(waitingTasks.map(task => task.id));

    qcPushNextAt.forEach((nextAt, id) => {
        if (!waitingIds.has(id)) qcPushNextAt.delete(id);
    });

    waitingTasks.forEach(task => {
        const nextAt = qcPushNextAt.get(task.id);
        if (!nextAt) {
            qcPushNextAt.set(task.id, now + QC_PUSH_REPEAT_DELAY);
        } else if (now >= nextAt) {
            qcPushNextAt.set(task.id, now + QC_PUSH_REPEAT_DELAY);
            void sendQcPushNotification(task);
        }
    });
}, 30 * 1000);

const GOOGLE_SHEETS_WEB_APP_URL = process.env.GOOGLE_SHEETS_WEB_APP_URL ||
    'https://script.google.com/macros/s/AKfycbxoxixwY5QUu5BkYWGNSqfG7AkJSWRNkGzXyy68kuuLkKdCO_dPrh0x9DQXu6Wydxmdlg/exec';

const lineLnt1 = ['STP 01','LIP 16','BTP 03','LIP 09','VSN 05','VMN 06','BRP 04','VMN 05','VSN 03','BRP 02','VAM 03','BRP 01','VMN 07'];
const lineLnt2 = ['EMP 16','LIP 11','BTP 04','LIP 10','JRP 02','FOP 03','BTP 01','BTP 02','LIP 18','VAM 02','SBP 01','VMN 04','LIP 09','LIP 06','LIP 08','ALP 03','LIP 12','VSN 04','SPP 01','LIP 14','VMN 02'];

// Helper untuk format Tanggal dan Jam Lengkap (WIB Lokal)
function getFormattedTimestamp() {
    const now = new Date();
    const tanggal = now.toLocaleDateString('id-ID'); // Format: DD/MM/YYYY
    const jam = now.toLocaleTimeString('id-ID');    // Format: HH:MM:SS WIB
    return `${tanggal} ${jam}`;
}

function resolveLineLantai(line) {
    if (!line) return 1;
    const normalized = String(line).trim().toUpperCase();
    if (lineLnt1.includes(normalized)) return 1;
    if (lineLnt2.includes(normalized)) return 2;
    return 1;
}

// ==================== [SINKRONISASI HISTORY DENGAN GOOGLE SHEETS] ====================
function mergeHistoryRows(sheetRows) {
    const mergedRows = [...sheetRows];
    const rowIndexes = new Map(mergedRows.map((row, index) => [row.id, index]));

    historyLog.forEach(row => {
        const existingIndex = rowIndexes.get(row.id);
        if (existingIndex === undefined) {
            rowIndexes.set(row.id, mergedRows.length);
            mergedRows.push(row);
        } else {
            mergedRows[existingIndex] = row;
        }
    });

    return mergedRows;
}

async function loadHistoryFromGoogleSheets() {
    try {
        const response = await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
            throw new Error(`Google Sheets returned HTTP ${response.status}`);
        }

        const payload = await response.json();
        const sheetRows = Array.isArray(payload)
            ? payload
            : payload && (payload.data || payload.history || payload.rows);
        if (!Array.isArray(sheetRows) || sheetRows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || !row.id)) {
            throw new Error('Google Sheets GET must return an array of history objects containing id');
        }

        historyLog = mergeHistoryRows(sheetRows);
        historySheetsReadStatus = 'connected';
        io.emit('HISTORY_UPDATE', historyLog);
        console.log(`History Google Sheets dimuat: ${sheetRows.length} data.`);
        return true;
    } catch (error) {
        historySheetsReadStatus = 'error';
        console.error('Gagal memuat history dari Google Sheets:', error.message);
        return false;
    }
}

async function saveHistoryToGoogleSheets(dataSelesai) {
    try {
        const response = await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataSelesai),
            signal: AbortSignal.timeout(15000)
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(`Google Sheets returned HTTP ${response.status}: ${responseText}`);
        }

        if (responseText) {
            try {
                const payload = JSON.parse(responseText);
                if (!payload || (payload.success !== true && payload.status !== 'success')) {
                    throw new Error((payload && payload.message) || 'Google Sheets did not confirm saving the history row');
                }
            } catch (error) {
                if (error instanceof SyntaxError) {
                    console.warn('Google Sheets menerima request tetapi mengirim respons non-JSON.');
                } else {
                    throw error;
                }
            }
        }
        console.log(`History ${dataSelesai.id} berhasil dikirim ke Google Sheets.`);
    } catch (error) {
        console.error('Gagal menyimpan history ke Google Sheets:', error.message);
    }
}

const historyLoadPromise = loadHistoryFromGoogleSheets();

function completeRequestById(id) {
    let dataSelesai = null;
    const indexTroli = antreanTroli.findIndex(item => item.id === id);
    if (indexTroli !== -1) dataSelesai = antreanTroli.splice(indexTroli, 1)[0];

    const indexFG = antreanFG.findIndex(item => item.id === id);
    if (!dataSelesai && indexFG !== -1) dataSelesai = antreanFG.splice(indexFG, 1)[0];

    if (!dataSelesai) return null;

    qcPushNextAt.delete(id);
    dataSelesai.status = 'COMPLETED';
    dataSelesai.waktuSelesai = getFormattedTimestamp(); 
    historyLog.push(dataSelesai);
    
    saveHistoryToGoogleSheets(dataSelesai);

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

// Reset hanya membersihkan antrean aktif; history bersifat permanen.
expressApp.post('/api/request/reset-all', (req, res) => {
    antreanTroli = [];
    antreanFG = [];
    qcPushNextAt.clear();
    
    io.emit('FORCE_RESET_SCREEN'); 
    broadcastDataAwal();
    io.emit('HISTORY_UPDATE', historyLog);
    
    console.log("🧹 POKAYOKE: Antrean aktif dibersihkan; history tetap dipertahankan.");
    return res.json({ success: true, message: "Antrean aktif dibersihkan. History tetap tersimpan." });
});

// API Request Baru (Operator Minta)
expressApp.post('/api/request/baru', (req, res) => {
    const { line, lantai, jenisMedia, status } = req.body;
    const normalizedLine = String(line || '').trim().toUpperCase();
    const normalizedMedia = jenisMedia || 'TROLI_KECIL';
    
    const waktuMintaStr = getFormattedTimestamp(); 
    const epochSekarang = Date.now();

    const dataBaru = {
        id: Math.random().toString(36).substr(2, 9),
        line: normalizedLine,
        lantai: typeof lantai === 'number' ? lantai : resolveLineLantai(line),
        jenisMedia: normalizedMedia,
        waktu: waktuMintaStr,        
        waktuEpoch: epochSekarang,    
        waktuRelease: '-',            
        waktuSelesai: '-',            
        status: status || (normalizedMedia === 'FG_FULL' ? 'WAIT_QC' : 'WAIT_KFG')
    };
    
    if (normalizedMedia === 'FG_FULL') {
        antreanFG.push(dataBaru);
        if (QC_WAITING_STATUSES.has(dataBaru.status)) {
            qcPushNextAt.set(dataBaru.id, Date.now() + QC_PUSH_REPEAT_DELAY);
            void sendQcPushNotification(dataBaru);
        }
    } else {
        antreanTroli.push(dataBaru);
    }
    
    io.emit('ANTREAN_BARU_MASUK', dataBaru);
    broadcastDataAwal();
    
    return res.status(201).json({ success: true, data: dataBaru });
});

expressApp.post('/api/request/bb-empty', (req, res) => {
    if (antreanTroli.some(task => task.jenisMedia === 'BB_TROLI_KOSONG')) {
        return res.status(409).json({ success: false, message: 'Permintaan ambil troli BB kosong masih aktif.' });
    }

    const task = {
        id: Math.random().toString(36).substr(2, 9),
        line: '',
        lantai: null,
        jenisMedia: 'BB_TROLI_KOSONG',
        dibuatOleh: String(req.body?.username || '').trim(),
        waktu: getFormattedTimestamp(),
        waktuEpoch: Date.now(),
        waktuRelease: '-',
        waktuSelesai: '-',
        status: 'WAIT_BB'
    };
    antreanTroli.push(task);
    io.emit('ANTREAN_BARU_MASUK', task);
    broadcastDataAwal();
    return res.status(201).json({ success: true, data: task });
});

expressApp.post('/api/request/bb-empty/receive', (req, res) => {
    const { id } = req.body || {};
    const task = antreanTroli.find(item => item.id === id && item.jenisMedia === 'BB_TROLI_KOSONG');
    if (!task) return res.status(404).json({ success: false, message: 'Permintaan troli BB kosong tidak ditemukan.' });
    if (task.status !== 'WAIT_BB') {
        return res.status(409).json({ success: false, message: 'Permintaan ambil troli BB tidak dapat diproses.' });
    }

    const completed = completeRequestById(id);
    return res.json({ success: true, data: completed });
});

expressApp.post('/api/request/bb-empty/cancel', (req, res) => {
    const { id } = req.body || {};
    const index = antreanTroli.findIndex(item =>
        item.id === id && item.jenisMedia === 'BB_TROLI_KOSONG' && item.status === 'WAIT_BB'
    );
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Permintaan belum dikirim tidak ditemukan atau sudah diproses.' });
    }

    const [cancelledTask] = antreanTroli.splice(index, 1);
    cancelledTask.status = 'CANCELLED';
    cancelledTask.waktuSelesai = getFormattedTimestamp();
    historyLog.push(cancelledTask);
    saveHistoryToGoogleSheets(cancelledTask);
    broadcastDataAwal();
    io.emit('HISTORY_UPDATE', historyLog);
    return res.json({ success: true, data: cancelledTask });
});

expressApp.get('/api/request/baru', (req, res) => {
    return res.json({ success: true, data: { troli: antreanTroli, fg: antreanFG } });
});

expressApp.get('/api/request/status', (req, res) => {
    return res.json({ success: true, data: { troli: antreanTroli, fg: antreanFG } });
});

expressApp.get('/api/history', (req, res) => {
    return historyLoadPromise.then(() => res.json({
        success: true,
        data: historyLog,
        googleSheets: historySheetsReadStatus
    }));
});

// API Kirim Troli ke Lift
expressApp.post('/api/request/kirim-troli', (req, res) => {
    const { id } = req.body;
    const index = antreanTroli.findIndex(item => item.id === id);
    if (index !== -1) {
        antreanTroli[index].status = 'DELIVERED';
        const task = antreanTroli[index];
        if (task.jenisMedia === 'TROLI_BESAR' || task.jenisMedia === 'TROLI_KECIL') {
            void sendOperatorPushNotification(task);
        }
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
    qcPushNextAt.delete(id);
    antreanFG[idx].waktuRelease = getFormattedTimestamp(); 
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
    historyLoadPromise.then(() => socket.emit('HISTORY_UPDATE', historyLog));

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