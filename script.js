// =============================================================
// SCRIPT.JS — E-SURAT FTCB v5.0
// Database: Google Sheets via Google Apps Script
// Data lokal (IndexedDB) digunakan sebagai cache
// =============================================================

// ─── GAS URL (isi setelah deploy Google Apps Script) ─────────
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxtyohUjzIrW3VhJlC5at7dj4C7kuD-OB825OdU4J5pgOe4B696i0cB0AIWZIi9oD_hFQ/exec'; // Dikosongkan agar saat diupload bersih dari data uji coba

// ─── Seed Data Pengguna ───────────────────────────────────────
let USERS = [
    { username: 'dekan', password: '123', role: 'dekan', name: 'Dr. Dekan FTCB', email: 'dekan@ftcb.ac.id', status: 'Aktif', tglDaftar: '09-04-2022 10:13:09', loginTerakhir: '-' },
    { username: 'kepalasek', password: '123', role: 'kepalasek', name: 'Kepala Sekretariat', email: 'kepalasek@ftcb.ac.id', status: 'Aktif', tglDaftar: '09-04-2022 10:13:09', loginTerakhir: '-' }
];

// ─── Seed Data Bagian ─────────────────────────────────────────
let MASTER_BAGIAN = [];

// ─── Variabel Global ──────────────────────────────────────────
let db = { suratMasuk: [], suratKeluar: [], spk: [] };
let currentUser = null;
let currentTab = 'dashboard';
let currentLaporanType = 'semua';
let selectedSPKId = null;
let myChart = null;

// ─── Konversi File ke Base64 ──────────────────────────────────
function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// ─── LocalStorage Security Wrappers (Mencegah crash pada file:// protocol) ───
function safeGetItem(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.warn('Gagal membaca dari storage:', e);
        return null;
    }
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn('Gagal menulis ke storage:', e);
        return false;
    }
}

function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (e) {
        console.warn('Gagal menghapus dari storage:', e);
        return false;
    }
}

// ─── Penyimpanan Sederhana & Aman via LocalStorage ─────────────────
function saveLocalDB() {
    safeSetItem('esurat_db', JSON.stringify(db));
}

function saveUsersDB() {
    safeSetItem('esurat_users_db', JSON.stringify(USERS));
    syncToGoogleSheets('users', USERS);
}

function saveBagianDB() {
    safeSetItem('esurat_bagian_db', JSON.stringify(MASTER_BAGIAN));
    syncToGoogleSheets('bagian', MASTER_BAGIAN);
}

// Aliases agar kompatibel dengan pemanggilan fungsi lama
function saveSuratDB() {
    saveLocalDB();
}

function syncToGoogleSheets(type, data) {
    if (!GAS_URL) {
        console.log("GAS_URL kosong, melewati sinkronisasi ke Google Sheets.");
        return;
    }

    // Gunakan form-urlencoded agar 100% didukung oleh Google Apps Script dan lolos dari blokir CORS
    const formData = new URLSearchParams();
    formData.append('type', type);
    formData.append('data', JSON.stringify(data));
    if (arguments.length > 2) {
        formData.append('action', arguments[2]);
    }

    fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
    })
        .then(() => console.log("Google Sheets Sync: Permintaan POST (form) terkirim!"))
        .catch(error => console.error("Error Google Sheets Sync:", error));
}

// Fungsi untuk load data master dari local storage
function loadMasterData() {
    try {
        const storedUsers = safeGetItem('esurat_users_db');
        if (storedUsers) USERS = JSON.parse(storedUsers);
        const storedBagian = safeGetItem('esurat_bagian_db');
        if (storedBagian) MASTER_BAGIAN = JSON.parse(storedBagian);
    } catch (e) {
        console.error('Gagal memuat master data lokal:', e);
    }
}

function initDB() {
    // 0. Auto-clear data lokal jika GAS_URL dikosongkan (untuk persiapan upload/bersih-bersih)
    if (GAS_URL === '' && !localStorage.getItem('esurat_cleared_v5')) {
        localStorage.removeItem('esurat_db');
        localStorage.setItem('esurat_cleared_v5', 'true');
        console.log("Data lokal dibersihkan otomatis karena GAS_URL kosong.");
    }

    // 1. Muat data lokal dulu agar UI bisa langsung dirender tanpa menunggu server
    try {
        const storedDb = safeGetItem('esurat_db');
        if (storedDb) db = JSON.parse(storedDb);
    } catch (e) {
        console.error('Gagal menginisialisasi data lokal:', e);
    }
    loadMasterData();

    // 2. Fetch data terbaru dari Google Sheets secara background
    if (GAS_URL) {
        const fetchUrl = GAS_URL + '?t=' + new Date().getTime();
        return fetch(fetchUrl)
            .then(response => response.json())
            .then(res => {
                if (res.status === 'success' && res.data) {
                    db = {
                        suratMasuk: res.data.suratMasuk || [],
                        suratKeluar: res.data.suratKeluar || [],
                        spk: res.data.spk || []
                    };
                    if (res.data.users && res.data.users.length > 0) USERS = res.data.users;
                    if (res.data.bagian && res.data.bagian.length > 0) MASTER_BAGIAN = res.data.bagian;

                    saveLocalDB(); // Update cache lokal
                    safeSetItem('esurat_users_db', JSON.stringify(USERS));
                    safeSetItem('esurat_bagian_db', JSON.stringify(MASTER_BAGIAN));

                    // Segarkan UI jika pengguna sudah berada di dashboard
                    if (!document.getElementById('dashboard-screen').classList.contains('hidden')) {
                        updateStats();
                        if (currentTab) switchTab(currentTab);
                    }
                } else {
                    throw new Error("Gagal parsing data dari Sheets");
                }
            })
            .catch(err => {
                console.error("Gagal fetch background Google Sheets:", err);
            });
    } else {
        loadMasterData();
        hideLoading();
        return Promise.resolve();
    }
}

// --- LOADING OVERLAY ---
function showLoading(msg) {
    let el = document.getElementById('gas-loading-overlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'gas-loading-overlay';
        el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;';
        el.innerHTML = `<div style="background:rgba(15,23,42,0.9);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px 40px;text-align:center;color:white;">
            <i class="fas fa-circle-notch fa-spin text-3xl text-cyan-400 mb-4 block"></i>
            <p class="text-sm font-medium" id="gas-loading-msg">${msg || 'Memuat data...'}</p>
        </div>`;
        document.body.appendChild(el);
    } else {
        document.getElementById('gas-loading-msg').innerText = msg || 'Memuat data...';
        el.style.display = 'flex';
    }
}

function hideLoading() {
    const el = document.getElementById('gas-loading-overlay');
    if (el) el.style.display = 'none';
}



// --- AUTHENTICATION LOGIC ---
function togglePassword() {
    const input = document.getElementById('password');
    const icon = document.getElementById('eye-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function handleEnter(e) {
    if (e.key === 'Enter') login();
}

function login() {
    const userVal = document.getElementById('username').value.trim().toLowerCase();
    const passVal = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    const found = USERS.find(u => u.username === userVal && String(u.password) === passVal);

    if (found) {
        // Catat waktu login terakhir
        const now = new Date();
        found.loginTerakhir = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ` +
            `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        currentUser = found;
        safeSetItem('esurat_user', JSON.stringify(found));
        errorEl.classList.add('hidden');

        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
        document.getElementById('user-display-name').innerText = currentUser.name;
        document.getElementById('user-display-role').innerText = currentUser.role;
        document.getElementById('header-user-welcome').innerText = currentUser.name;
        document.getElementById('user-avatar').innerText = currentUser.name.charAt(0);
        setupRoleUI();
        initDB();
        updateStats();
        switchTab('dashboard');
    } else {
        errorEl.classList.remove('hidden');
    }
}

function logout() {
    currentUser = null;
    safeRemoveItem('esurat_user');
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

function checkAuth() {
    try {
        const stored = safeGetItem('esurat_user');
        if (stored) {
            const savedUser = JSON.parse(stored);
            const freshUser = USERS.find(u => u.username === savedUser.username);
            currentUser = freshUser || savedUser;

            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            document.getElementById('user-display-name').innerText = currentUser.name;
            document.getElementById('user-display-role').innerText = currentUser.role;
            document.getElementById('header-user-welcome').innerText = currentUser.name;
            document.getElementById('user-avatar').innerText = currentUser.name.charAt(0);
            setupRoleUI();
            initDB();
            updateStats();
            switchTab(currentTab);
        } else {
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('dashboard-screen').classList.add('hidden');
        }
    } catch (e) {
        console.error('Error saat checkAuth:', e);
        safeRemoveItem('esurat_user');
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('dashboard-screen').classList.add('hidden');
    }
}

function setupRoleUI() {
    if (!currentUser) return;
    const masterDataMenu = document.getElementById('sidebar-master-data');
    if (masterDataMenu) {
        if (currentUser.role === 'kepalasek' || currentUser.role === 'dekan') {
            masterDataMenu.classList.remove('hidden');
        } else {
            masterDataMenu.classList.add('hidden');
        }
    }
}


function togglePelaporanMenu() {
    const menu = document.getElementById('menu-pelaporan');
    const icon = document.getElementById('icon-pelaporan');

    if (menu && icon) {
        if (menu.classList.contains('hidden')) {
            menu.classList.remove('hidden');
            menu.classList.add('flex');
            icon.classList.add('rotate-180');
        } else {
            menu.classList.add('hidden');
            menu.classList.remove('flex');
            icon.classList.remove('rotate-180');
        }
    }
}

function toggleMasterMenu() {
    const menu = document.getElementById('menu-master-data');
    const icon = document.getElementById('icon-master-data');

    if (menu && icon) {
        if (menu.classList.contains('hidden')) {
            menu.classList.remove('hidden');
            menu.classList.add('flex');
            icon.classList.add('rotate-180');
        } else {
            menu.classList.add('hidden');
            menu.classList.remove('flex');
            icon.classList.remove('rotate-180');
        }
    }
}

// --- DASHBOARD TAB ROUTING ---
function switchTab(tabId, subTabId = null) {
    currentTab = tabId;
    const tabs = ['dashboard', 'surat-masuk', 'surat-keluar', 'spk', 'pelaporan'];

    // Manage active state of sidebar buttons
    tabs.forEach(t => {
        const btn = document.getElementById(`btn-${t}`);
        if (btn) {
            if (t === tabId) {
                btn.classList.add('text-white', 'bg-white/10');
                btn.classList.remove('text-gray-400');
            } else {
                btn.classList.remove('text-white', 'bg-white/10');
                btn.classList.add('text-gray-400');
            }
        }
    });

    // Handle submenu active states for pelaporan
    ['masuk', 'keluar', 'spt'].forEach(t => {
        const btn = document.getElementById(`btn-pel-${t}`);
        if (btn) {
            if (tabId === 'pelaporan' && subTabId === t) {
                btn.classList.add('text-white', 'bg-white/10');
                btn.classList.remove('text-gray-400');
            } else {
                btn.classList.remove('text-white', 'bg-white/10');
                btn.classList.add('text-gray-400');
            }
        }
    });

    // Handle submenu active states for master data
    ['user', 'bagian'].forEach(t => {
        const btn = document.getElementById(`btn-master-${t}`);
        if (btn) {
            if (tabId === `master-${t}`) {
                btn.classList.add('text-white', 'bg-white/10');
                btn.classList.remove('text-gray-400');
            } else {
                btn.classList.remove('text-white', 'bg-white/10');
                btn.classList.add('text-gray-400');
            }
        }
    });

    // Update Titles and Actions
    const activeTitle = document.getElementById('active-tab-title');
    const activeDesc = document.getElementById('active-tab-desc');
    const addActionBtn = document.getElementById('btn-add-action');
    const addActionText = document.getElementById('btn-add-text');

    const viewDashboard = document.getElementById('view-dashboard');
    const viewTable = document.getElementById('view-table');

    if (tabId === 'dashboard') {
        viewDashboard.classList.remove('hidden');
        viewTable.classList.add('hidden');
        activeTitle.innerText = 'Dashboard Utama';
        activeDesc.innerText = 'Ringkasan data E-SURAT FTCB';
        addActionBtn.classList.add('hidden');

        // Show/hide dashboard search based on role
        const allowedRoles = ['dekan', 'kepalasek'];
        const dashboardSearchSec = document.getElementById('dashboard-search-section');
        const dbSearchInput = document.getElementById('dashboard-search-input');
        const dbSearchResults = document.getElementById('dashboard-search-results');

        if (dbSearchInput) dbSearchInput.value = '';
        if (dbSearchResults) {
            dbSearchResults.innerHTML = '';
            dbSearchResults.classList.add('hidden');
        }

        if (dashboardSearchSec) {
            if (currentUser && allowedRoles.includes(currentUser.role)) {
                dashboardSearchSec.classList.remove('hidden');
            } else {
                dashboardSearchSec.classList.add('hidden');
            }
        }

        // Always re-sync stats and chart when entering dashboard
        updateStats();
        updateChart();
    } else {
        viewDashboard.classList.add('hidden');
        viewTable.classList.remove('hidden');
    }

    if (tabId === 'surat-masuk') {
        activeTitle.innerText = 'Surat Masuk';
        activeDesc.innerText = 'Daftar arsip surat masuk FTCB';
        addActionText.innerText = 'Tambah Surat Masuk';
        // Only allow kepalasek to add letters, dekan is read-only
        if (currentUser.role === 'dekan') {
            addActionBtn.classList.add('hidden');
        } else {
            addActionBtn.classList.remove('hidden');
        }
    } else if (tabId === 'surat-keluar') {
        activeTitle.innerText = 'Surat Keluar';
        activeDesc.innerText = 'Daftar arsip surat keluar FTCB';
        addActionText.innerText = 'Tambah Surat Keluar';
        if (currentUser.role === 'dekan') {
            addActionBtn.classList.add('hidden');
        } else {
            addActionBtn.classList.remove('hidden');
        }
    } else if (tabId === 'spk') {
        activeTitle.innerText = 'Perintah Tugas (SPT)';
        activeDesc.innerText = 'Penugasan dan Persetujuan Perintah Tugas';
        addActionText.innerText = 'Tambah SPT';
        // Dekan & Kepala can create SPT
        addActionBtn.classList.remove('hidden');
    } else if (tabId === 'pelaporan') {
        viewDashboard.classList.add('hidden');
        viewTable.classList.add('hidden');
        hideMasterDataViews();
        const viewPelaporan = document.getElementById('view-pelaporan');
        if (viewPelaporan) viewPelaporan.classList.remove('hidden');
        activeTitle.innerText = 'Pelaporan';
        activeDesc.innerText = 'Laporan rekapitulasi surat berdasarkan rentang tanggal';
        addActionBtn.classList.add('hidden');

        // Update jenis laporan berdasarkan submenu
        if (subTabId) {
            currentLaporanType = subTabId;
            generateLaporan();
        } else {
            currentLaporanType = 'semua';
        }

        return; // Skip renderTable()
    } else if (tabId === 'master-user') {
        viewDashboard.classList.add('hidden');
        viewTable.classList.add('hidden');
        if (document.getElementById('view-pelaporan')) document.getElementById('view-pelaporan').classList.add('hidden');
        if (document.getElementById('view-master-bagian')) document.getElementById('view-master-bagian').classList.add('hidden');
        const viewUser = document.getElementById('view-master-user');
        if (viewUser) viewUser.classList.remove('hidden');

        activeTitle.innerText = 'Master Data - User';
        activeDesc.innerText = 'Kelola data pengguna aplikasi';
        addActionBtn.classList.add('hidden');
        renderMasterUser();
        return;
    } else if (tabId === 'master-bagian') {
        viewDashboard.classList.add('hidden');
        viewTable.classList.add('hidden');
        if (document.getElementById('view-pelaporan')) document.getElementById('view-pelaporan').classList.add('hidden');
        if (document.getElementById('view-master-user')) document.getElementById('view-master-user').classList.add('hidden');
        const viewBagian = document.getElementById('view-master-bagian');
        if (viewBagian) viewBagian.classList.remove('hidden');

        activeTitle.innerText = 'Master Data - Bagian';
        activeDesc.innerText = 'Kelola data instansi dan bagian';
        addActionBtn.classList.add('hidden');
        renderMasterBagian();
        return;
    }

    // Hide pelaporan and master data views when switching to other core tabs
    const viewPelaporan = document.getElementById('view-pelaporan');
    if (viewPelaporan) viewPelaporan.classList.add('hidden');
    hideMasterDataViews();

    renderTable();
}

function hideMasterDataViews() {
    if (document.getElementById('view-master-user')) document.getElementById('view-master-user').classList.add('hidden');
    if (document.getElementById('view-master-bagian')) document.getElementById('view-master-bagian').classList.add('hidden');
}



function renderMasterUser() {
    const tbody = document.getElementById('table-master-user-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    USERS.forEach((user, index) => {
        let statusBadge = user.status === 'Aktif'
            ? '<span class="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-md"><i class="fas fa-check"></i> Aktif</span>'
            : '<span class="text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-md"><i class="fas fa-times"></i> Nonaktif</span>';

        const row = `
        <tr class="hover:bg-white/5 transition-colors border-b border-white/5">
            <td class="py-3 px-4 text-gray-400 text-xs">${index + 1}</td>
            <td class="py-3 px-4 font-semibold text-white text-xs">${user.username}</td>
            <td class="py-3 px-4 text-gray-300 text-xs">${user.name}</td>
            <td class="py-3 px-4 text-gray-300 text-xs">${user.email || '-'}</td>
            <td class="py-3 px-4 text-gray-300 text-xs capitalize">${user.role}</td>
            <td class="py-3 px-4 text-xs">${statusBadge}</td>
            <td class="py-3 px-4 text-gray-400 text-xs">${user.tglDaftar || '-'}</td>
            <td class="py-3 px-4 text-gray-400 text-xs">${user.loginTerakhir || '-'}</td>
            <td class="py-3 px-4 text-xs">
                <div class="flex gap-1">
                    <button onclick="openModalAddUser('${user.username}')" class="bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteUser('${user.username}')" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Hapus"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

function renderMasterBagian() {
    const tbody = document.getElementById('table-master-bagian-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    MASTER_BAGIAN.forEach((bagian, index) => {
        const row = `
        <tr class="hover:bg-white/5 transition-colors border-b border-white/5">
            <td class="py-3 px-4 text-gray-400 text-xs">${index + 1}</td>
            <td class="py-3 px-4 font-semibold text-white text-xs">${bagian.nama}</td>
            <td class="py-3 px-4 text-xs text-center">
                <div class="flex gap-1 justify-center">
                    <button onclick="openModalAddBagian(${index})" class="bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteBagian(${index})" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Hapus"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

// Helper: mengembalikan daftar SPK yang terlihat sesuai role user aktif
function getVisibleSpk() {
    return db.spk;
}

function updateStats() {
    const visibleSpk = getVisibleSpk();
    const totalSuratMasuk = db.suratMasuk.length;
    const totalSuratKeluar = db.suratKeluar.length;
    const totalSpk = visibleSpk.length;
    const totalRekap = totalSuratMasuk + totalSuratKeluar + totalSpk;

    document.getElementById('stat-surat-masuk').innerText = totalSuratMasuk;
    document.getElementById('stat-surat-keluar').innerText = totalSuratKeluar;
    document.getElementById('stat-spk').innerText = totalSpk;
    document.getElementById('stat-rekapitulasi').innerText = totalRekap;

    if (currentTab === 'dashboard') {
        updateChart();
    }
}

function updateChart() {
    try {
        const oldCanvas = document.getElementById('rekapChart');
        if (!oldCanvas) return;

        const container = oldCanvas.parentElement;
        if (!container) return;

        if (typeof Chart === 'undefined') {
            console.warn('[E-SURAT] Chart.js tidak dimuat. Mengabaikan rendering grafik.');
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
                    <i class="fas fa-chart-line text-3xl mb-2"></i>
                    Grafik tidak tersedia (offline)
                </div>
            `;
            return;
        }

        // Hapus instance chart lama jika ada
        if (myChart) {
            myChart.destroy();
            myChart = null;
        }

        // Recreate canvas untuk membersihkan cache rendering Chart.js di DOM
        container.innerHTML = '<canvas id="rekapChart"></canvas>';
        const ctx = document.getElementById('rekapChart');

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
        const suratMasukData = new Array(12).fill(0);
        const suratKeluarData = new Array(12).fill(0);
        const spkData = new Array(12).fill(0);

        const parseMonth = (dateStr) => {
            if (!dateStr) return -1;

            // Coba parsing standar dulu
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                return d.getMonth();
            }

            const nums = dateStr.match(/\d+/g);
            if (!nums || nums.length < 3) return -1;

            const yearIdx = nums.findIndex(n => n.length === 4);
            if (yearIdx === -1) return -1;

            let month;
            if (yearIdx === 2) {
                const val1 = parseInt(nums[0], 10); // DD atau MM
                const val2 = parseInt(nums[1], 10); // MM atau DD

                if (val1 > 12) {
                    month = val2;
                } else if (val2 > 12) {
                    month = val1;
                } else {
                    // Keduanya <= 12, deteksi dinamis format locale sistem user
                    const testDate = new Date(2020, 11, 31); // 31 Des 2020
                    const testStr = testDate.toLocaleString();
                    const testNums = testStr.match(/\d+/g);
                    if (testNums && testNums.length >= 2 && parseInt(testNums[0], 10) === 12) {
                        month = val1; // Format US (MM/DD/YYYY)
                    } else {
                        month = val2; // Format ID/UK (DD/MM/YYYY)
                    }
                }
            } else if (yearIdx === 0) {
                month = parseInt(nums[1], 10); // Format YYYY-MM-DD
            } else {
                return -1;
            }

            return month - 1;
        };

        db.suratMasuk.forEach(s => {
            const m = parseMonth(s.tanggal);
            if (m >= 0 && m < 12) suratMasukData[m]++;
        });

        db.suratKeluar.forEach(s => {
            const m = parseMonth(s.tanggal);
            if (m >= 0 && m < 12) suratKeluarData[m]++;
        });

        const spkListForChart = getVisibleSpk();

        spkListForChart.forEach(s => {
            const m = parseMonth(s.tanggal);
            if (m >= 0 && m < 12) spkData[m]++;
        });

        Chart.defaults.color = '#9ca3af';
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';

        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    {
                        label: 'Surat Masuk',
                        data: suratMasukData,
                        borderColor: '#eab308',
                        backgroundColor: 'rgba(234, 179, 8, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Surat Keluar',
                        data: suratKeluarData,
                        borderColor: '#22c55e',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Perintah Tugas',
                        data: spkData,
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Error saat updateChart:', e);
    }
}

// --- DATA RENDERING ---
function renderTable() {
    const tableHead = document.getElementById('table-head');
    const tableBody = document.getElementById('table-body');
    const searchVal = document.getElementById('search-input').value.toLowerCase();

    tableBody.innerHTML = '';

    if (currentTab === 'surat-masuk') {
        tableHead.innerHTML = `
            <tr>
                <th class="py-3 px-4">No. Surat</th>
                <th class="py-3 px-4">Tanggal</th>
                <th class="py-3 px-4">Pengirim</th>
                <th class="py-3 px-4">Perihal</th>
                <th class="py-3 px-4">File</th>
                <th class="py-3 px-4">Uploader</th>
                <th class="py-3 px-4 text-center">Aksi</th>
            </tr>
        `;

        const filtered = db.suratMasuk.filter(s =>
            s.nomor.toLowerCase().includes(searchVal) ||
            s.pihak.toLowerCase().includes(searchVal) ||
            s.perihal.toLowerCase().includes(searchVal)
        );

        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-500">Tidak ada surat masuk ditemukan.</td></tr>`;
            return;
        }

        filtered.forEach(s => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-white/5 transition-colors';
            const canDelete = currentUser.role === 'kepalasek' || currentUser.role === 'dekan';
            row.innerHTML = `
                <td class="py-4 px-4 font-semibold text-white">${s.nomor}</td>
                <td class="py-4 px-4 text-gray-400">${s.tanggal}</td>
                <td class="py-4 px-4 text-gray-300">${s.pihak}</td>
                <td class="py-4 px-4 text-gray-300">${s.perihal}</td>
                <td class="py-4 px-4">
                    ${s.fileData
                    ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="text-cyan-400 hover:underline cursor-pointer"><i class="fas fa-paperclip mr-1"></i> ${s.file}</a>`
                    : `<span class="text-gray-500"><i class="fas fa-paperclip mr-1"></i> ${s.file || 'Tidak ada file'}</span>`
                }
                </td>
                <td class="py-4 px-4 text-gray-400">${s.uploader}</td>
                <td class="py-4 px-4 text-center space-x-1">
                    <button onclick="viewSuratDetail('suratMasuk', ${s.id})" class="text-cyan-400 hover:text-cyan-300 font-semibold text-xs border border-cyan-500/30 hover:border-cyan-400 px-3 py-1.5 rounded-lg bg-cyan-500/5 transition-all">Detail</button>
                    ${canDelete ? `<button onclick="deleteSurat(${s.id}, 'suratMasuk')" class="text-red-400 hover:text-red-300 font-semibold text-xs border border-red-500/30 hover:border-red-400 px-3 py-1.5 rounded-lg bg-red-500/5 transition-all">Hapus</button>` : ''}
                </td>
            `;
            tableBody.appendChild(row);
        });

    } else if (currentTab === 'surat-keluar') {
        tableHead.innerHTML = `
            <tr>
                <th class="py-3 px-4">No. Surat</th>
                <th class="py-3 px-4">Tanggal</th>
                <th class="py-3 px-4">Penerima</th>
                <th class="py-3 px-4">Perihal</th>
                <th class="py-3 px-4">File</th>
                <th class="py-3 px-4">Uploader</th>
                <th class="py-3 px-4 text-center">Aksi</th>
            </tr>
        `;

        const filtered = db.suratKeluar.filter(s =>
            s.nomor.toLowerCase().includes(searchVal) ||
            s.pihak.toLowerCase().includes(searchVal) ||
            s.perihal.toLowerCase().includes(searchVal)
        );

        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-500">Tidak ada surat keluar ditemukan.</td></tr>`;
            return;
        }

        filtered.forEach(s => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-white/5 transition-colors';
            const canDelete = currentUser.role === 'kepalasek' || currentUser.role === 'dekan';
            row.innerHTML = `
                <td class="py-4 px-4 font-semibold text-white">${s.nomor}</td>
                <td class="py-4 px-4 text-gray-400">${s.tanggal}</td>
                <td class="py-4 px-4 text-gray-300">${s.pihak}</td>
                <td class="py-4 px-4 text-gray-300">${s.perihal}</td>
                <td class="py-4 px-4">
                    ${s.fileData
                    ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="text-cyan-400 hover:underline cursor-pointer"><i class="fas fa-paperclip mr-1"></i> ${s.file}</a>`
                    : `<span class="text-gray-500"><i class="fas fa-paperclip mr-1"></i> ${s.file || 'Tidak ada file'}</span>`
                }
                </td>
                <td class="py-4 px-4 text-gray-400">${s.uploader}</td>
                <td class="py-4 px-4 text-center space-x-1">
                    <button onclick="viewSuratDetail('suratKeluar', ${s.id})" class="text-cyan-400 hover:text-cyan-300 font-semibold text-xs border border-cyan-500/30 hover:border-cyan-400 px-3 py-1.5 rounded-lg bg-cyan-500/5 transition-all">Detail</button>
                    ${canDelete ? `<button onclick="deleteSurat(${s.id}, 'suratKeluar')" class="text-red-400 hover:text-red-300 font-semibold text-xs border border-red-500/30 hover:border-red-400 px-3 py-1.5 rounded-lg bg-red-500/5 transition-all">Hapus</button>` : ''}
                </td>
            `;
            tableBody.appendChild(row);
        });

    } else if (currentTab === 'spk') {
        tableHead.innerHTML = `
            <tr>
                <th class="py-3 px-4">No. SPT</th>
                <th class="py-3 px-4">Tanggal</th>
                <th class="py-3 px-4">Ditugaskan Kepada</th>
                <th class="py-3 px-4">Deskripsi Perihal</th>
                <th class="py-3 px-4">File</th>
                <th class="py-3 px-4">Uploader</th>
                <th class="py-3 px-4">Status</th>
                <th class="py-3 px-4 text-center">Aksi</th>
            </tr>
        `;

        // Filter SPK berdasarkan role:
        // - dekan, kepalasek: semua SPK
        let spkList = db.spk;

        const filtered = spkList.filter(s =>
            (s.nomor || '').toLowerCase().includes(searchVal) ||
            (s.assignTo || '').toLowerCase().includes(searchVal) ||
            (s.perihal || '').toLowerCase().includes(searchVal)
        );

        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-500">Tidak ada perintah tugas ditemukan.</td></tr>`;
            return;
        }

        filtered.forEach(s => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-white/5 transition-colors';



            let statusBadge = '<span class="text-xs font-semibold text-orange-400 bg-orange-400/10 px-2 py-1 rounded-lg">Menunggu</span>';
            if (s.status === 'Diproses') {
                statusBadge = '<span class="text-xs font-semibold text-blue-400 bg-blue-400/10 px-2 py-1 rounded-lg">Diproses</span>';
            } else if (s.status === 'Selesai') {
                statusBadge = '<span class="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-1 rounded-lg">Selesai</span>';
            } else if (s.status === 'Ditolak') {
                statusBadge = '<span class="text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-1 rounded-lg"><i class="fas fa-times-circle mr-1"></i>Ditolak</span>';
            }

            const fileCellSPT = s.fileData
                ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="text-cyan-400 hover:underline cursor-pointer text-xs"><i class="fas fa-paperclip mr-1"></i>${s.file}</a>`
                : `<span class="text-gray-500 text-xs"><i class="fas fa-paperclip mr-1"></i>${s.file || 'Tidak ada file'}</span>`;

            const canDeleteSPT = currentUser.role === 'dekan' || currentUser.role === 'kepalasek';

            row.innerHTML = `
                <td class="py-4 px-4 font-semibold text-white">${s.nomor}</td>
                <td class="py-4 px-4 text-gray-400">${s.tanggal}</td>
                <td class="py-4 px-4 text-gray-300">${s.assignTo}</td>
                <td class="py-4 px-4 text-gray-300">${s.perihal}</td>
                <td class="py-4 px-4">${fileCellSPT}</td>
                <td class="py-4 px-4">
                    <span class="text-sm text-gray-400 font-medium">${s.uploader}</span>
                </td>
                <td class="py-4 px-4">${statusBadge}</td>
                <td class="py-4 px-4 text-center">
                    <button onclick="viewSPKDetail(${s.id})" class="text-cyan-400 hover:text-cyan-300 font-semibold text-xs border border-cyan-500/30 hover:border-cyan-400 px-3 py-1.5 rounded-lg bg-cyan-500/5 transition-all">Detail</button>
                    ${canDeleteSPT ? `<button onclick="deleteSurat(${s.id}, 'spk')" class="text-red-400 hover:text-red-300 font-semibold text-xs border border-red-500/30 hover:border-red-400 px-3 py-1.5 rounded-lg bg-red-500/5 transition-all ml-1">Hapus</button>` : ''}
                </td>
            `;
            tableBody.appendChild(row);
        });
    }
}

function searchData() {
    renderTable();
}

function searchDataDashboard() {
    const searchVal = document.getElementById('dashboard-search-input').value.toLowerCase().trim();
    const resultsContainer = document.getElementById('dashboard-search-results');

    if (!searchVal) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
        return;
    }

    resultsContainer.classList.remove('hidden');
    resultsContainer.innerHTML = '';

    // Filter data
    const matchedSuratMasuk = db.suratMasuk.filter(s =>
        s.nomor.toLowerCase().includes(searchVal) ||
        s.pihak.toLowerCase().includes(searchVal) ||
        s.perihal.toLowerCase().includes(searchVal)
    );

    const matchedSuratKeluar = db.suratKeluar.filter(s =>
        s.nomor.toLowerCase().includes(searchVal) ||
        s.pihak.toLowerCase().includes(searchVal) ||
        s.perihal.toLowerCase().includes(searchVal)
    );

    const spkListForSearch = getVisibleSpk();

    const matchedSPK = spkListForSearch.filter(s =>
        (s.nomor || '').toLowerCase().includes(searchVal) ||
        (s.assignTo || '').toLowerCase().includes(searchVal) ||
        (s.perihal || '').toLowerCase().includes(searchVal)
    );

    const totalResults = matchedSuratMasuk.length + matchedSuratKeluar.length + matchedSPK.length;

    if (totalResults === 0) {
        resultsContainer.innerHTML = `
            <div class="text-center py-6 text-gray-500 text-sm">
                <i class="fas fa-search-minus text-2xl mb-2 block"></i>
                Tidak ada data ditemukan untuk kata kunci "${searchVal}".
            </div>
        `;
        return;
    }

    // Render Surat Masuk Results
    if (matchedSuratMasuk.length > 0) {
        const section = document.createElement('div');
        section.className = 'space-y-2';
        section.innerHTML = `
            <h4 class="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <i class="fas fa-envelope-open"></i> Surat Masuk (${matchedSuratMasuk.length})
            </h4>
            <div class="grid grid-cols-1 gap-3">
                ` + matchedSuratMasuk.map(s => `
                    <div class="glass-panel p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                        <div class="space-y-1">
                            <div class="font-semibold text-white">${s.nomor}</div>
                            <div class="text-xs text-gray-400">Pengirim: <span class="text-gray-300">${s.pihak}</span> • Tanggal: <span class="text-gray-300">${s.tanggal}</span></div>
                            <div class="text-gray-300 text-xs mt-1 italic">"${s.perihal}"</div>
                        </div>
                        <div>
                            ${s.fileData
                ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-500/20 hover:border-cyan-500/50 bg-cyan-500/5 px-3 py-1.5 rounded-lg transition-all cursor-pointer">
                                    <i class="fas fa-paperclip"></i> Lihat File
                                </a>`
                : `<span class="inline-flex items-center gap-1.5 text-xs text-gray-500 border border-white/5 bg-white/5 px-3 py-1.5 rounded-lg">
                                    <i class="fas fa-paperclip"></i> Tidak ada file
                                </span>`
            }
                        </div>
                    </div>
                `).join('') + `
            </div>
        `;
        resultsContainer.appendChild(section);
    }

    // Render Surat Keluar Results
    if (matchedSuratKeluar.length > 0) {
        const section = document.createElement('div');
        section.className = 'space-y-2';
        section.innerHTML = `
            <h4 class="text-xs font-bold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
                <i class="fas fa-paper-plane"></i> Surat Keluar (${matchedSuratKeluar.length})
            </h4>
            <div class="grid grid-cols-1 gap-3">
                ` + matchedSuratKeluar.map(s => `
                    <div class="glass-panel p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                        <div class="space-y-1">
                            <div class="font-semibold text-white">${s.nomor}</div>
                            <div class="text-xs text-gray-400">Penerima: <span class="text-gray-300">${s.pihak}</span> • Tanggal: <span class="text-gray-300">${s.tanggal}</span></div>
                            <div class="text-gray-300 text-xs mt-1 italic">"${s.perihal}"</div>
                        </div>
                        <div>
                            ${s.fileData
                ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="inline-flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 border border-yellow-500/20 hover:border-yellow-500/50 bg-yellow-500/5 px-3 py-1.5 rounded-lg transition-all cursor-pointer">
                                    <i class="fas fa-paperclip"></i> Lihat File
                                </a>`
                : `<span class="inline-flex items-center gap-1.5 text-xs text-gray-500 border border-white/5 bg-white/5 px-3 py-1.5 rounded-lg">
                                    <i class="fas fa-paperclip"></i> Tidak ada file
                                </span>`
            }
                        </div>
                    </div>
                `).join('') + `
            </div>
        `;
        resultsContainer.appendChild(section);
    }

    // Render SPK Results
    if (matchedSPK.length > 0) {
        const section = document.createElement('div');
        section.className = 'space-y-2';
        section.innerHTML = `
            <h4 class="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                <i class="fas fa-tasks"></i> Perintah Tugas (SPT) (${matchedSPK.length})
            </h4>
            <div class="grid grid-cols-1 gap-3">
                ` + matchedSPK.map(s => {
            let statusBadge = '<span class="text-xs font-semibold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-md">Menunggu</span>';
            if (s.status === 'Diproses') {
                statusBadge = '<span class="text-xs font-semibold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-md">Diproses</span>';
            } else if (s.status === 'Selesai') {
                statusBadge = '<span class="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-md">Selesai</span>';
            }
            return `
                        <div class="glass-panel p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                            <div class="space-y-1 flex-1">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="font-semibold text-white">${s.nomor}</span>
                                    ${statusBadge}
                                </div>
                                <div class="text-xs text-gray-400">Ditugaskan ke: <span class="text-gray-300">${s.assignTo}</span> • Tanggal: <span class="text-gray-300">${s.tanggal}</span></div>
                                <div class="text-gray-300 text-xs mt-1 italic">"${s.perihal}"</div>
                            </div>
                            <div>
                                <button onclick="viewSPKDetail(${s.id})" class="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 border border-purple-500/20 hover:border-purple-500/50 bg-purple-500/5 px-3 py-1.5 rounded-lg transition-all">
                                    <i class="fas fa-info-circle"></i> Detail
                                </button>
                            </div>
                        </div>
                    `;
        }).join('') + `
            </div>
        `;
        resultsContainer.appendChild(section);
    }
}

// --- DETAIL SURAT MASUK / SURAT KELUAR ---
function viewSuratDetail(type, id) {
    const list = type === 'suratMasuk' ? db.suratMasuk : db.suratKeluar;
    const s = list.find(x => x.id == id);
    if (!s) return;

    const jenis = type === 'suratMasuk' ? 'Surat Masuk' : 'Surat Keluar';
    const pihakLabel = type === 'suratMasuk' ? 'Pengirim' : 'Penerima';
    const fileHtml = s.fileData
        ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 bg-cyan-500/5 px-4 py-2 rounded-xl transition-all"><i class="fas fa-download"></i> Unduh / Buka ${s.file}</a>`
        : (s.fileData === '' && s.file ? `<span class="text-gray-500 text-sm"><i class="fas fa-paperclip mr-1"></i>${s.file} (file tidak tersedia di sesi ini)</span>` : `<span class="text-gray-500 text-sm">Tidak ada file lampiran</span>`);

    // Buat atau reuse modal detail surat
    let modal = document.getElementById('modal-surat-detail');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-surat-detail';
        modal.className = 'hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="glass-panel rounded-3xl p-8 max-w-lg w-full relative max-h-[90vh] overflow-y-auto">
            <button onclick="document.getElementById('modal-surat-detail').classList.add('hidden')"
                class="absolute top-6 right-6 text-gray-400 hover:text-white transition-colors text-xl">
                <i class="fas fa-times"></i>
            </button>
            <div class="flex items-center gap-3 mb-6">
                <div class="w-10 h-10 rounded-full flex items-center justify-center ${type === 'suratMasuk' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-yellow-500/20 text-yellow-400'}">
                    <i class="fas ${type === 'suratMasuk' ? 'fa-envelope-open-text' : 'fa-paper-plane'}"></i>
                </div>
                <h2 class="text-xl font-bold text-white">Detail ${jenis}</h2>
            </div>
            <div class="space-y-4">
                <div class="glass-panel rounded-xl p-4 space-y-3">
                    <div class="flex justify-between items-start">
                        <span class="text-xs text-gray-500 uppercase tracking-wider">Nomor Surat</span>
                        <span class="text-sm font-semibold text-white text-right">${s.nomor}</span>
                    </div>
                    <div class="flex justify-between items-start">
                        <span class="text-xs text-gray-500 uppercase tracking-wider">${pihakLabel}</span>
                        <span class="text-sm text-gray-300 text-right">${s.pihak}</span>
                    </div>
                    <div class="flex justify-between items-start">
                        <span class="text-xs text-gray-500 uppercase tracking-wider">Perihal</span>
                        <span class="text-sm text-gray-300 text-right max-w-xs">${s.perihal}</span>
                    </div>
                    <div class="flex justify-between items-start">
                        <span class="text-xs text-gray-500 uppercase tracking-wider">Tanggal</span>
                        <span class="text-sm text-gray-300">${s.tanggal}</span>
                    </div>
                    <div class="flex justify-between items-start">
                        <span class="text-xs text-gray-500 uppercase tracking-wider">Diunggah Oleh</span>
                        <span class="text-sm text-gray-300">${s.uploader}</span>
                    </div>
                </div>
                <div>
                    <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">File Lampiran</p>
                    ${fileHtml}
                </div>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');
}

// --- MODALS ACTIONS ---
function populatePihakDropdown() {
    const select = document.getElementById('surat-pihak');
    if (!select) return;
    // Simpan nilai saat ini jika ada
    const currentVal = select.value;
    // Reset, sisakan hanya placeholder
    select.innerHTML = '<option value="" disabled selected>Pilih Instansi/Unit</option>';
    // Isi dari MASTER_BAGIAN secara dinamis
    MASTER_BAGIAN.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.nama;
        opt.textContent = b.nama;
        select.appendChild(opt);
    });
    // Kembalikan nilai sebelumnya jika masih ada
    if (currentVal) select.value = currentVal;
}

function openCreateModal() {
    if (currentTab === 'surat-masuk') {
        document.getElementById('modal-surat-title').innerText = 'Tambah Surat Masuk';
        document.getElementById('lbl-pengirim-penerima').innerText = 'Pengirim';
        populatePihakDropdown();
        document.getElementById('modal-surat').classList.remove('hidden');
        document.getElementById('surat-tanggal').value = getTodayDateTime();
    } else if (currentTab === 'surat-keluar') {
        document.getElementById('modal-surat-title').innerText = 'Tambah Surat Keluar';
        document.getElementById('lbl-pengirim-penerima').innerText = 'Penerima';
        populatePihakDropdown();
        document.getElementById('modal-surat').classList.remove('hidden');
        document.getElementById('surat-tanggal').value = getTodayDateTime();
    } else if (currentTab === 'spk') {
        const assignSelect = document.getElementById('spk-assign');
        assignSelect.innerHTML = '';
        if (currentUser.role === 'dekan') {
            assignSelect.innerHTML = '<option value="Kepala Sekretariat">Kepala Sekretariat</option>';
            assignSelect.value = 'Kepala Sekretariat';
        } else if (currentUser.role === 'kepalasek') {
            assignSelect.innerHTML = '<option value="Kepala Sekretariat">Kerjakan Sendiri</option>';
            assignSelect.value = 'Kepala Sekretariat';
        }

        const kaprodiContainer = document.getElementById('spk-kaprodi-select-container');
        if (kaprodiContainer) kaprodiContainer.classList.add('hidden');

        document.getElementById('modal-spk').classList.remove('hidden');
        document.getElementById('spk-tanggal').value = getTodayDateTime();
    }
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

async function saveSurat() {
    const nomor = document.getElementById('surat-nomor').value.trim();
    const pihak = document.getElementById('surat-pihak').value.trim();
    const perihal = document.getElementById('surat-perihal').value.trim();
    const tanggal = document.getElementById('surat-tanggal').value;
    const fileEl = document.getElementById('surat-file');

    if (!nomor || !pihak || !perihal) {
        alert('Harap isi semua kolom!');
        return;
    }

    let filename = '';
    let fileData = '';
    const fileObj = fileEl.files[0];
    if (fileObj) {
        filename = fileObj.name;
        try { fileData = await getBase64(fileObj); } catch (e) { console.error(e); }
    }

    const type = currentTab === 'surat-masuk' ? 'suratMasuk' : 'suratKeluar';
    const newItem = { id: Date.now(), nomor, pihak, perihal, tanggal, file: filename, fileData, uploader: currentUser.name };
    const gasItem = { id: newItem.id, nomor, pihak, perihal, tanggal, file: filename, fileData: '', uploader: currentUser.name };

    showLoading('Menyimpan surat...');
    try {
        if (type === 'suratMasuk') db.suratMasuk.push(newItem);
        else db.suratKeluar.push(newItem);
        await saveSuratDB();
        syncToGoogleSheets(type, gasItem);
        updateStats();
        renderTable();
        closeModal('modal-surat');
        document.getElementById('surat-nomor').value = '';
        document.getElementById('surat-pihak').value = '';
        document.getElementById('surat-perihal').value = '';
        fileEl.value = '';
    } catch (e) {
        alert('Gagal menyimpan.');
        console.error(e);
    } finally {
        hideLoading();
    }
}

async function deleteSurat(id, type) {
    if (!confirm('Apakah Anda yakin ingin menghapus surat ini?')) return;

    showLoading('Menghapus data...');
    try {
        if (type === 'suratMasuk') db.suratMasuk = db.suratMasuk.filter(s => s.id != id);
        else if (type === 'suratKeluar') db.suratKeluar = db.suratKeluar.filter(s => s.id != id);
        else if (type === 'spk') db.spk = db.spk.filter(s => s.id != id);
        await saveSuratDB();
        syncToGoogleSheets(type, { id: id }, 'delete'); // Beritahu Spreadsheet untuk menghapus baris ini
        updateStats();
        updateChart();
        renderTable();
    } catch (e) {
        alert('Gagal menghapus.');
    } finally {
        hideLoading();
    }
}

async function saveSPK() {
    const nomor = document.getElementById('spk-nomor').value.trim();
    const perihal = document.getElementById('spk-perihal').value.trim();
    const assignTo = document.getElementById('spk-assign').value;
    const tanggal = document.getElementById('spk-tanggal').value;
    const fileEl = document.getElementById('spk-file');

    if (!nomor || !perihal || !tanggal || !assignTo) {
        alert('Harap isi semua kolom!');
        return;
    }

    let filename = '';
    let fileData = '';
    const fileObj = fileEl ? fileEl.files[0] : null;
    if (fileObj) {
        filename = fileObj.name;
        try { fileData = await getBase64(fileObj); } catch (e) { console.error(e); }
    }

    let uploaderName = currentUser.name;
    const newItem = {
        id: Date.now(),
        nomor,
        perihal,
        assignTo,
        assignedFrom: currentUser.name,
        tanggal,
        status: 'Menunggu',
        uploader: uploaderName,
        uploaderRole: currentUser.role,
        file: filename,
        fileData: fileData
    };

    const gasItem = {
        id: newItem.id,
        nomor,
        perihal,
        assignTo,
        assignedFrom: currentUser.name,
        tanggal,
        status: 'Menunggu',
        uploader: uploaderName,
        uploaderRole: currentUser.role,
        file: filename,
        fileData: '' // Jangan kirim base64 file yang besar ke Spreadsheet
    };

    showLoading('Menyimpan SPT...');
    try {
        db.spk.push(newItem);
        await saveSuratDB();
        syncToGoogleSheets('spk', gasItem);
        updateStats();
        renderTable();
        closeModal('modal-spk');
        document.getElementById('spk-nomor').value = '';
        document.getElementById('spk-perihal').value = '';
        if (fileEl) fileEl.value = '';
    } catch (e) {
        console.error('Error saat menyimpan SPK:', e);
        alert('Gagal menyimpan SPK: ' + e.message);
    } finally {
        hideLoading();
    }
}

// --- SPK DETAILS & APPROVAL ---
function viewSPKDetail(id) {
    selectedSPKId = id;
    const item = db.spk.find(s => s.id === id);
    if (!item) return;

    // Show/hide detail rows based on role
    const rowAssignedFrom = document.getElementById('row-detail-assigned-from');
    const rowUploader = document.getElementById('row-detail-uploader');
    const rowStatus = document.getElementById('row-detail-status');
    const rowApprovalStates = document.getElementById('row-detail-approval-states');

    if (currentUser.role === 'kepalasek') {
        if (rowAssignedFrom) rowAssignedFrom.classList.remove('hidden');
        if (rowUploader) rowUploader.classList.add('hidden');
        if (rowStatus) rowStatus.classList.remove('hidden');
        if (rowApprovalStates) rowApprovalStates.classList.add('hidden');
    } else {
        if (rowAssignedFrom) rowAssignedFrom.classList.remove('hidden');
        if (rowUploader) rowUploader.classList.remove('hidden');
        if (rowStatus) rowStatus.classList.remove('hidden');
        if (rowApprovalStates) rowApprovalStates.classList.remove('hidden');
    }

    document.getElementById('detail-spk-nomor').innerText = item.nomor;
    document.getElementById('detail-spk-tanggal').innerText = item.tanggal;
    document.getElementById('detail-spk-assign').innerText = item.assignTo;
    document.getElementById('detail-spk-assigned-from').innerText = item.assignedFrom || item.uploader || 'Sistem';

    document.getElementById('detail-spk-uploader').innerText = item.uploader;

    document.getElementById('detail-spk-perihal').innerText = item.perihal;

    const statusEl = document.getElementById('detail-spk-status');
    if (statusEl) {
        statusEl.innerText = item.status;
        if (item.status === 'Menunggu') {
            statusEl.className = 'font-semibold text-orange-400';
        } else if (item.status === 'Diproses') {
            statusEl.className = 'font-semibold text-blue-400';
        } else if (item.status === 'Selesai') {
            statusEl.className = 'font-semibold text-green-400';
        } else if (item.status === 'Ditolak') {
            statusEl.className = 'font-semibold text-red-400';
        }
    }

    // Badges dihapus

    const filesContainer = document.getElementById('detail-spk-files-container');
    const filesList = document.getElementById('detail-spk-files-list');

    if (filesContainer && filesList) {
        filesList.innerHTML = '';
        let hasFiles = false;

        if (item.fileData) {
            hasFiles = true;
            filesList.innerHTML += `
                <a href="${item.fileData}" target="_blank" download="${item.file || 'lampiran_spt'}" class="text-cyan-400 hover:underline font-medium flex items-center bg-white/5 p-2 rounded-lg border border-white/5 hover:bg-white/10 transition-all text-xs">
                    <i class="fas fa-paperclip mr-2"></i> Lampiran Awal SPT: ${item.file || 'File'}
                </a>
            `;
        }

        if (item.tambahanData) {
            hasFiles = true;
            filesList.innerHTML += `
                <a href="${item.tambahanData}" target="_blank" download="${item.tambahanName || 'lampiran_tambahan'}" class="text-purple-400 hover:underline font-medium flex items-center bg-white/5 p-2 rounded-lg border border-white/5 hover:bg-white/10 transition-all text-xs">
                    <i class="fas fa-folder-open mr-2"></i> Tambahan dari Kepala Sek: ${item.tambahanName || 'File'}
                </a>
            `;
        }

        if (item.evidenceData) {
            hasFiles = true;
            filesList.innerHTML += `
                <a href="${item.evidenceData}" target="_blank" download="${item.evidenceName || 'bukti_selesai'}" class="text-green-400 hover:underline font-medium flex items-center bg-white/5 p-2 rounded-lg border border-white/5 hover:bg-white/10 transition-all text-xs">
                    <i class="fas fa-check-double mr-2"></i> Bukti Selesai: ${item.evidenceName || 'File'}
                </a>
            `;
        }

        if (hasFiles) {
            filesContainer.classList.remove('hidden');
        } else {
            filesContainer.classList.add('hidden');
        }
    }

    // Build Actions panel
    const actionsSec = document.getElementById('section-spk-actions');
    actionsSec.innerHTML = '';

    if (currentUser.role === 'kepalasek') {
        let delegateBtnHtml = '';
        if (item.assignTo === 'Kepala Sekretariat' && item.assignedFrom === 'Kepala Sekretariat') {
            delegateBtnHtml = `
                <div class="flex-1 text-xs text-purple-400 bg-purple-400/10 border border-purple-500/20 p-2.5 rounded-xl text-center font-medium"><i class="fas fa-check mr-1.5"></i> Dikerjakan Kepala Sek</div>
            `;
        } else {
            delegateBtnHtml = `
                <button onclick="delegateToSelf()" class="flex-1 py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-purple-600/10"><i class="fas fa-user-check mr-2"></i>Kerjakan Sendiri</button>
            `;
        }

        let workSectionHtml = '';
        if (item.assignTo === 'Kepala Sekretariat') {
            if (item.status === 'Menunggu') {
                workSectionHtml = `
                    <div class="mt-4 pt-4 border-t border-white/5">
                        <button onclick="acceptSPKStaff()" class="w-full py-2.5 px-4 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-blue-500/10 mb-2"><i class="fas fa-play mr-2"></i>Mulai Proses Tugas Ini</button>
                    </div>
                `;
            } else if (item.status === 'Diproses') {
                workSectionHtml = `
                    <div class="mt-4 pt-4 border-t border-white/5 space-y-3">
                        <div class="text-xs text-blue-400 bg-blue-400/10 border border-blue-500/20 p-2.5 rounded-xl text-center font-medium"><i class="fas fa-cog fa-spin mr-2"></i>Status Pekerjaan: Sedang Diproses</div>
                        <div class="space-y-2">
                            <label class="block text-xs font-medium text-gray-400">Upload File Hasil Fix (Bukti Selesai):</label>
                            <div class="flex gap-2">
                                <input type="file" id="spk-upload-evidence-kepala" class="glass-input flex-1 px-3 py-1.5 rounded-xl text-xs">
                                <button onclick="uploadSPKAttachment('evidenceData', 'spk-upload-evidence-kepala')" class="bg-green-500 hover:bg-green-400 text-white text-xs font-semibold py-2 px-3 rounded-xl transition-all">Selesaikan</button>
                            </div>
                        </div>
                    </div>
                `;
            } else if (item.status === 'Selesai') {
                workSectionHtml = `
                    <div class="mt-4 pt-4 border-t border-white/5 text-xs text-green-400 bg-green-400/10 border border-green-500/20 p-2.5 rounded-xl text-center font-medium"><i class="fas fa-check-double mr-1.5"></i> Tugas telah selesai Anda kerjakan</div>
                `;
            }
        }

        actionsSec.innerHTML = `
            <div class="flex gap-3 mb-4">
                ${delegateBtnHtml}
            </div>
            <div class="space-y-2 border-t border-white/5 pt-4">
                <label class="block text-xs font-medium text-gray-400">Upload Lampiran Tambahan (Dari Kepala Sek):</label>
                <div class="flex gap-2">
                    <input type="file" id="spk-upload-attachment" class="glass-input flex-1 px-3 py-1.5 rounded-xl text-xs">
                    <button onclick="uploadSPKAttachment('tambahanData', 'spk-upload-attachment')" class="bg-cyan-500 hover:bg-cyan-400 text-white text-xs font-semibold py-2 px-3 rounded-xl transition-all">Upload</button>
                </div>
            </div>
            ${workSectionHtml}
        `;
    }

    document.getElementById('modal-spk-detail').classList.remove('hidden');
}



async function uploadSPKAttachment(field, inputId) {
    const fileEl = document.getElementById(inputId);
    if (!fileEl || !fileEl.files || fileEl.files.length === 0) { alert('Harap pilih file terlebih dahulu!'); return; }

    const item = db.spk.find(s => s.id === selectedSPKId);
    if (!item) return;

    const file = fileEl.files[0];
    showLoading('Mengupload file...');
    try {
        const fileData = await getBase64(file);
        if (field === 'fileData') {
            item.file = file.name; item.fileData = fileData;
        } else if (field === 'tambahanData') {
            item.tambahanName = file.name; item.tambahanData = fileData;
        } else if (field === 'evidenceData') {
            item.evidenceName = file.name; item.evidenceData = fileData; item.status = 'Selesai';
        }
        syncToGoogleSheets('spk', item);
        saveLocalDB();
        renderTable();
        viewSPKDetail(selectedSPKId);
        alert('File berhasil diupload dan disimpan lokal!');
    } catch (e) {
        console.error(e); alert('Gagal mengupload file.');
    } finally { hideLoading(); }
}

async function delegateSPK(selectId) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    const item = db.spk.find(s => s.id === selectedSPKId);
    if (!item) return;
    const delegateTo = selectEl.value;
    item.assignTo = delegateTo; item.assignedFrom = currentUser.name;
    item.status = 'Menunggu';
    showLoading('Mendelegasikan SPK...');
    try {
        syncToGoogleSheets('spk', item);
        saveLocalDB();
        renderTable(); viewSPKDetail(selectedSPKId);
        alert(`SPK berhasil didelegasikan kepada ${delegateTo}!`);
    } catch (e) { alert('Gagal mendelegasikan.'); }
    finally { hideLoading(); }
}

async function delegateToSelf() {
    const item = db.spk.find(s => s.id === selectedSPKId);
    if (!item) return;
    item.assignTo = 'Kepala Sekretariat'; item.assignedFrom = currentUser.name;
    item.status = 'Menunggu';
    showLoading('Mengambil alih tugas...');
    try {
        syncToGoogleSheets('spk', item);
        saveLocalDB();
        renderTable(); viewSPKDetail(selectedSPKId);
        alert('SPK berhasil Didelegasikan untuk Anda kerjakan sendiri!');
    } catch (e) { alert('Gagal memproses.'); }
    finally { hideLoading(); }
}

async function acceptSPKStaff() {
    const item = db.spk.find(s => s.id === selectedSPKId);
    if (!item) return;
    item.status = 'Diproses';
    showLoading('Memperbarui status...');
    try {
        syncToGoogleSheets('spk', item);
        saveLocalDB();
        renderTable(); viewSPKDetail(selectedSPKId);
    } catch (e) { alert('Gagal memperbarui status.'); }
    finally { hideLoading(); }
}

async function completeSPKStaff() {
    const item = db.spk.find(s => s.id === selectedSPKId);
    if (!item) return;
    item.status = 'Selesai';
    showLoading('Memperbarui status...');
    try {
        syncToGoogleSheets('spk', item);
        saveLocalDB();
        renderTable(); viewSPKDetail(selectedSPKId);
    } catch (e) { alert('Gagal memperbarui status.'); }
    finally { hideLoading(); }
}

// --- UTILS ---
function getTodayDate() {
    const d = new Date();
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

function getTodayDateTime() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    return `${day}-${month}-${year} / ${hours}.${minutes} wib`;
}

function toggleMobileSidebar() {
    const sidebar = document.querySelector('aside');
    sidebar.classList.toggle('hidden');
}

// Check session on load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});

// ============================================================
// --- FITUR PELAPORAN ---
// ============================================================

function handleLaporanEnter(event) {
    if (event.key === 'Enter') generateLaporan();
}

function setLaporanQuick(type) {
    const today = new Date();
    let dari, sampai;

    if (type === 'bulan-ini') {
        dari = new Date(today.getFullYear(), today.getMonth(), 1);
        sampai = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (type === 'bulan-lalu') {
        dari = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        sampai = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (type === '3-bulan') {
        dari = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        sampai = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (type === 'tahun-ini') {
        dari = new Date(today.getFullYear(), 0, 1);
        sampai = new Date(today.getFullYear(), 11, 31);
    } else if (type === 'semua') {
        document.getElementById('laporan-dari').value = '';
        document.getElementById('laporan-sampai').value = '';
        generateLaporan();
        return;
    }

    document.getElementById('laporan-dari').value = formatDateISO(dari);
    document.getElementById('laporan-sampai').value = formatDateISO(sampai);
    generateLaporan();
}

function formatDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseTanggalToDate(tanggalStr) {
    if (!tanggalStr) return null;
    // Coba parse langsung
    let d = new Date(tanggalStr);
    if (!isNaN(d.getTime())) return d;

    // Coba format DD/MM/YYYY atau DD-MM-YYYY
    const nums = tanggalStr.match(/\d+/g);
    if (!nums || nums.length < 3) return null;
    const yearIdx = nums.findIndex(n => n.length === 4);
    if (yearIdx === -1) return null;

    let day, month, year;
    if (yearIdx === 2) {
        // DD/MM/YYYY or MM/DD/YYYY
        // Deteksi: jika nilai pertama > 12, maka DD/MM/YYYY
        if (parseInt(nums[0]) > 12) {
            day = parseInt(nums[0]); month = parseInt(nums[1]); year = parseInt(nums[2]);
        } else if (parseInt(nums[1]) > 12) {
            month = parseInt(nums[0]); day = parseInt(nums[1]); year = parseInt(nums[2]);
        } else {
            // Default ke DD/MM/YYYY (format Indonesia)
            day = parseInt(nums[0]); month = parseInt(nums[1]); year = parseInt(nums[2]);
        }
    } else if (yearIdx === 0) {
        year = parseInt(nums[0]); month = parseInt(nums[1]); day = parseInt(nums[2]);
    } else {
        return null;
    }

    d = new Date(year, month - 1, day);
    return isNaN(d.getTime()) ? null : d;
}

function resetLaporan() {
    document.getElementById('laporan-dari').value = '';
    document.getElementById('laporan-sampai').value = '';
    currentLaporanType = 'semua';
    const resultsEl = document.getElementById('laporan-results');
    resultsEl.innerHTML = `
        <div class="glass-panel p-10 rounded-2xl border border-white/5 text-center text-gray-500">
            <i class="fas fa-file-search text-4xl mb-4 block opacity-40"></i>
            <p class="text-sm">Pilih rentang tanggal dan klik <span class="text-purple-400 font-semibold">Generate Laporan</span> untuk menampilkan laporan.</p>
        </div>
    `;
}

function onLaporanJenisChange() {
    // Jika hasil sudah ditampilkan, langsung update tanpa reset filter
    const resultsEl = document.getElementById('laporan-results');
    if (resultsEl && !resultsEl.querySelector('.glass-panel.p-10')) {
        generateLaporan();
    }
}

function generateLaporan() {
    const dariStr = document.getElementById('laporan-dari').value;
    const sampaiStr = document.getElementById('laporan-sampai').value;
    const jenis = currentLaporanType; // 'semua' | 'masuk' | 'keluar' | 'spt'
    const resultsEl = document.getElementById('laporan-results');

    // Parse filter dates
    let dariDate = dariStr ? new Date(dariStr + 'T00:00:00') : null;
    let sampaiDate = sampaiStr ? new Date(sampaiStr + 'T23:59:59') : null;

    const inRange = (tanggalStr) => {
        const d = parseTanggalToDate(tanggalStr);
        if (!d) return false;
        if (dariDate && d < dariDate) return false;
        if (sampaiDate && d > sampaiDate) return false;
        return true;
    };

    // Filter data berdasarkan tanggal
    let filteredSM = db.suratMasuk.filter(s => inRange(s.tanggal));
    let filteredSK = db.suratKeluar.filter(s => inRange(s.tanggal));
    let filteredSPT = getVisibleSpk().filter(s => inRange(s.tanggal));

    const totalSM = filteredSM.length;
    const totalSK = filteredSK.length;
    const totalSPT = filteredSPT.length;

    // Hitung total sesuai jenis yang dipilih
    let totalTampil = 0;
    if (jenis === 'semua') totalTampil = totalSM + totalSK + totalSPT;
    else if (jenis === 'masuk') totalTampil = totalSM;
    else if (jenis === 'keluar') totalTampil = totalSK;
    else if (jenis === 'spt') totalTampil = totalSPT;

    // Label rentang
    let rangeLabel = 'Semua Data';
    if (dariStr && sampaiStr) rangeLabel = `${dariStr} s/d ${sampaiStr}`;
    else if (dariStr) rangeLabel = `Mulai ${dariStr}`;
    else if (sampaiStr) rangeLabel = `Sampai ${sampaiStr}`;

    // Label jenis
    const jenisLabel = {
        semua: '📋 Semua Jenis Surat',
        masuk: '📥 Surat Masuk',
        keluar: '📤 Surat Keluar',
        spt: '📌 Surat Perintah Tugas'
    }[jenis] || 'Semua';

    resultsEl.innerHTML = '';

    // ---- HEADER INFO + SUMMARY CARDS ----
    // Bangun kartu hanya yang relevan
    let summaryCards = '';
    if (jenis === 'semua' || jenis === 'masuk') {
        summaryCards += `
            <div class="glass-panel p-5 rounded-2xl border border-white/5 flex items-center justify-between ${jenis === 'masuk' ? 'border-cyan-500/30 shadow-lg shadow-cyan-500/5' : ''
            }">
                <div>
                    <p class="text-xs text-gray-400 uppercase tracking-wider">Surat Masuk</p>
                    <h3 class="text-3xl font-bold text-cyan-400 mt-1">${totalSM}</h3>
                </div>
                <div class="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 text-xl">
                    <i class="fas fa-envelope-open"></i>
                </div>
            </div>`;
    }
    if (jenis === 'semua' || jenis === 'keluar') {
        summaryCards += `
            <div class="glass-panel p-5 rounded-2xl border border-white/5 flex items-center justify-between ${jenis === 'keluar' ? 'border-yellow-500/30 shadow-lg shadow-yellow-500/5' : ''
            }">
                <div>
                    <p class="text-xs text-gray-400 uppercase tracking-wider">Surat Keluar</p>
                    <h3 class="text-3xl font-bold text-yellow-400 mt-1">${totalSK}</h3>
                </div>
                <div class="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-yellow-400 text-xl">
                    <i class="fas fa-paper-plane"></i>
                </div>
            </div>`;
    }
    if (jenis === 'semua' || jenis === 'spt') {
        summaryCards += `
            <div class="glass-panel p-5 rounded-2xl border border-white/5 flex items-center justify-between ${jenis === 'spt' ? 'border-green-500/30 shadow-lg shadow-green-500/5' : ''
            }">
                <div>
                    <p class="text-xs text-gray-400 uppercase tracking-wider">Perintah Tugas (SPT)</p>
                    <h3 class="text-3xl font-bold text-green-400 mt-1">${totalSPT}</h3>
                </div>
                <div class="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-400 text-xl">
                    <i class="fas fa-tasks"></i>
                </div>
            </div>`;
    }

    const gridCols = jenis === 'semua' ? 'md:grid-cols-3' : 'md:grid-cols-1 max-w-xs';

    resultsEl.innerHTML += `
        <div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <h4 class="text-sm font-bold text-white flex items-center gap-2">
                    <i class="fas fa-calendar-check text-purple-400"></i>
                    Rentang: <span class="text-purple-300">${rangeLabel}</span>
                </h4>
                <div class="flex items-center gap-2">
                    <span class="text-xs px-2.5 py-1 rounded-full bg-purple-400/10 text-purple-300 font-medium">${jenisLabel}</span>
                    <span class="text-xs text-gray-500">${totalTampil} dokumen</span>
                </div>
            </div>
            <div class="grid grid-cols-1 ${gridCols} gap-4">${summaryCards}</div>
        </div>
    `;

    // ---- TABEL SURAT MASUK ----
    if (jenis === 'semua' || jenis === 'masuk') {
        const smTableRows = filteredSM.length > 0
            ? filteredSM.map((s, i) => `
                <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 px-4 text-gray-400 text-xs">${i + 1}</td>
                    <td class="py-3 px-4 font-semibold text-white text-xs">${s.nomor}</td>
                    <td class="py-3 px-4 text-gray-400 text-xs">${s.tanggal}</td>
                    <td class="py-3 px-4 text-gray-300 text-xs">${s.pihak}</td>
                    <td class="py-3 px-4 text-gray-300 text-xs">${s.perihal}</td>
                    <td class="py-3 px-4 text-xs">
                        ${s.fileData
                    ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="text-cyan-400 hover:underline"><i class="fas fa-paperclip mr-1"></i>${s.file}</a>`
                    : `<span class="text-gray-500">${s.file || '-'}</span>`}
                    </td>
                    <td class="py-3 px-4 text-gray-400 text-xs">${s.uploader}</td>
                </tr>`).join('')
            : `<tr><td colspan="7" class="py-6 text-center text-gray-500 text-sm">Tidak ada surat masuk pada rentang ini.</td></tr>`;

        resultsEl.innerHTML += `
            <div class="glass-panel rounded-2xl overflow-hidden border border-white/5">
                <div class="p-5 border-b border-white/5 flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 text-sm"><i class="fas fa-envelope-open"></i></div>
                    <h4 class="font-bold text-white">Surat Masuk <span class="ml-2 text-xs font-normal text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded-full">${totalSM} surat</span></h4>
                </div>
                <div class="overflow-x-auto">
                    <table class="spreadsheet-table text-sm text-left w-full">
                        <thead class="text-xs uppercase text-gray-400 border-b border-white/5">
                            <tr>
                                <th class="py-3 px-4">#</th>
                                <th class="py-3 px-4">No. Surat</th>
                                <th class="py-3 px-4">Tanggal</th>
                                <th class="py-3 px-4">Pengirim</th>
                                <th class="py-3 px-4">Perihal</th>
                                <th class="py-3 px-4">File</th>
                                <th class="py-3 px-4">Uploader</th>
                            </tr>
                        </thead>
                        <tbody>${smTableRows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ---- TABEL SURAT KELUAR ----
    if (jenis === 'semua' || jenis === 'keluar') {
        const skTableRows = filteredSK.length > 0
            ? filteredSK.map((s, i) => `
                <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 px-4 text-gray-400 text-xs">${i + 1}</td>
                    <td class="py-3 px-4 font-semibold text-white text-xs">${s.nomor}</td>
                    <td class="py-3 px-4 text-gray-400 text-xs">${s.tanggal}</td>
                    <td class="py-3 px-4 text-gray-300 text-xs">${s.pihak}</td>
                    <td class="py-3 px-4 text-gray-300 text-xs">${s.perihal}</td>
                    <td class="py-3 px-4 text-xs">
                        ${s.fileData
                    ? `<a href="${s.fileData}" target="_blank" download="${s.file}" class="text-yellow-400 hover:underline"><i class="fas fa-paperclip mr-1"></i>${s.file}</a>`
                    : `<span class="text-gray-500">${s.file || '-'}</span>`}
                    </td>
                    <td class="py-3 px-4 text-gray-400 text-xs">${s.uploader}</td>
                </tr>`).join('')
            : `<tr><td colspan="7" class="py-6 text-center text-gray-500 text-sm">Tidak ada surat keluar pada rentang ini.</td></tr>`;

        resultsEl.innerHTML += `
            <div class="glass-panel rounded-2xl overflow-hidden border border-white/5">
                <div class="p-5 border-b border-white/5 flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-400 text-sm"><i class="fas fa-paper-plane"></i></div>
                    <h4 class="font-bold text-white">Surat Keluar <span class="ml-2 text-xs font-normal text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">${totalSK} surat</span></h4>
                </div>
                <div class="overflow-x-auto">
                    <table class="spreadsheet-table text-sm text-left w-full">
                        <thead class="text-xs uppercase text-gray-400 border-b border-white/5">
                            <tr>
                                <th class="py-3 px-4">#</th>
                                <th class="py-3 px-4">No. Surat</th>
                                <th class="py-3 px-4">Tanggal</th>
                                <th class="py-3 px-4">Penerima</th>
                                <th class="py-3 px-4">Perihal</th>
                                <th class="py-3 px-4">File</th>
                                <th class="py-3 px-4">Uploader</th>
                            </tr>
                        </thead>
                        <tbody>${skTableRows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ---- TABEL SURAT PERINTAH TUGAS ----
    if (jenis === 'semua' || jenis === 'spt') {
        const sptTableRows = filteredSPT.length > 0
            ? filteredSPT.map((s, i) => {
                let statusBadge = '<span class="text-xs font-semibold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-md">Menunggu</span>';
                if (s.status === 'Diproses') statusBadge = '<span class="text-xs font-semibold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-md">Diproses</span>';
                else if (s.status === 'Selesai') statusBadge = '<span class="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-md">Selesai</span>';
                else if (s.status === 'Ditolak') statusBadge = '<span class="text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-md">Ditolak</span>';

                return `
                <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 px-4 text-gray-400 text-xs">${i + 1}</td>
                    <td class="py-3 px-4 font-semibold text-white text-xs">${s.nomor}</td>
                    <td class="py-3 px-4 text-gray-400 text-xs">${s.tanggal}</td>
                    <td class="py-3 px-4 text-gray-300 text-xs">${s.assignTo}</td>
                    <td class="py-3 px-4 text-gray-300 text-xs">${s.perihal}</td>
                    <td class="py-3 px-4 text-center">${statusBadge}</td>
                    <td class="py-3 px-4 text-gray-400 text-xs">${s.uploader}</td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="7" class="py-6 text-center text-gray-500 text-sm">Tidak ada surat perintah tugas pada rentang ini.</td></tr>`;

        resultsEl.innerHTML += `
            <div class="glass-panel rounded-2xl overflow-hidden border border-white/5">
                <div class="p-5 border-b border-white/5 flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400 text-sm"><i class="fas fa-tasks"></i></div>
                    <h4 class="font-bold text-white">Surat Perintah Tugas (SPT) <span class="ml-2 text-xs font-normal text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">${totalSPT} surat</span></h4>
                </div>
                <div class="overflow-x-auto">
                    <table class="spreadsheet-table text-sm text-left w-full">
                        <thead class="text-xs uppercase text-gray-400 border-b border-white/5">
                            <tr>
                                <th class="py-3 px-4">#</th>
                                <th class="py-3 px-4">No. SPT</th>
                                <th class="py-3 px-4">Tanggal</th>
                                <th class="py-3 px-4">Ditugaskan Kepada</th>
                                <th class="py-3 px-4">Perihal</th>
                                <th class="py-3 px-4 text-center">Status</th>
                                <th class="py-3 px-4">Uploader</th>
                            </tr>
                        </thead>
                        <tbody>${sptTableRows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    if (totalTampil === 0) {
        resultsEl.innerHTML += `
            <div class="glass-panel p-8 rounded-2xl border border-white/5 text-center text-gray-500">
                <i class="fas fa-inbox text-3xl mb-3 block opacity-40"></i>
                <p class="text-sm">Tidak ada data <strong class="text-gray-400">${jenisLabel}</strong> yang ditemukan pada rentang tanggal tersebut.</p>
            </div>
        `;
    }
}

// ============================================================
// --- MASTER DATA FUNCTIONS (MODALS & FILTERS) ---
// ============================================================

let editingUsername = null;

// --- MASTER USER ---
function filterMasterUser(keyword) {
    const tbody = document.getElementById('table-master-user-body');
    if (!tbody) return;
    const lowerKeyword = keyword.toLowerCase();

    tbody.innerHTML = '';
    const filteredUsers = USERS.filter(u =>
        u.username.toLowerCase().includes(lowerKeyword) ||
        u.name.toLowerCase().includes(lowerKeyword) ||
        (u.email && u.email.toLowerCase().includes(lowerKeyword)) ||
        u.role.toLowerCase().includes(lowerKeyword)
    );

    filteredUsers.forEach((user, index) => {
        let statusBadge = user.status === 'Aktif'
            ? '<span class="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-md"><i class="fas fa-check"></i> Aktif</span>'
            : '<span class="text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-md"><i class="fas fa-times"></i> Nonaktif</span>';

        let displayTgl = user.tglDaftar || '-';
        if (displayTgl !== '-' && displayTgl.includes(' ')) {
            const parts = displayTgl.split(' ');
            if (parts.length === 2) {
                const datePart = parts[0];
                const timeParts = parts[1].split(':');
                if (timeParts.length >= 2) {
                    displayTgl = `${datePart} / ${timeParts[0]}.${timeParts[1]} wib`;
                }
            }
        }

        const row = `
        <tr class="hover:bg-white/5 transition-colors border-b border-white/5">
            <td class="py-3 px-4 text-gray-400 text-xs">${index + 1}</td>
            <td class="py-3 px-4 font-semibold text-white text-xs">${user.username}</td>
            <td class="py-3 px-4 text-gray-300 text-xs">${user.name}</td>
            <td class="py-3 px-4 text-gray-300 text-xs">${user.email || '-'}</td>
            <td class="py-3 px-4 text-gray-300 text-xs capitalize">${user.role}</td>
            <td class="py-3 px-4 text-xs">${statusBadge}</td>
            <td class="py-3 px-4 text-gray-400 text-xs">${displayTgl}</td>
            <td class="py-3 px-4 text-xs">
                <div class="flex gap-1">
                    <button onclick="openModalAddUser('${user.username}')" class="bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteUser('${user.username}')" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Hapus"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

function openModalAddUser(username = null) {
    document.getElementById('form-add-user').reset();
    const modalTitle = document.querySelector('#modal-add-user h2');
    const modalDesc = document.querySelector('#modal-add-user p');
    const usernameInput = document.getElementById('add-username');

    if (username) {
        // Mode Edit
        editingUsername = username;
        modalTitle.innerHTML = '<i class="fas fa-edit text-cyan-400 mr-2"></i>Edit Pengguna';
        modalDesc.innerText = 'Perbarui data akun pengguna.';
        usernameInput.disabled = true;
        usernameInput.classList.add('opacity-50');

        // Isi form dengan data yang ada
        const u = USERS.find(user => user.username === username);
        if (u) {
            document.getElementById('add-username').value = u.username;
            document.getElementById('add-user-name').value = u.name;
            document.getElementById('add-user-role').value = u.role;
            document.getElementById('add-email').value = u.email || '';
            document.getElementById('add-password').value = u.password;
        }
    } else {
        // Mode Tambah Baru
        editingUsername = null;
        modalTitle.innerHTML = '<i class="fas fa-user-plus text-cyan-400 mr-2"></i>Tambah Pengguna Baru';
        modalDesc.innerText = 'Tambahkan kredensial dan role untuk akses e-surat.';
        usernameInput.disabled = false;
        usernameInput.classList.remove('opacity-50');
    }

    document.getElementById('modal-add-user').classList.remove('hidden');
}

function closeModalAddUser() {
    document.getElementById('modal-add-user').classList.add('hidden');
    editingUsername = null;
}

async function saveUser() {
    const username = document.getElementById('add-username').value.trim();
    const name = document.getElementById('add-user-name').value.trim();
    const email = document.getElementById('add-email').value.trim();
    const role = document.getElementById('add-user-role').value;
    const password = document.getElementById('add-password').value;

    if (!username || !name || !email || !role || !password) {
        alert("Mohon lengkapi semua isian formulir!");
        return;
    }

    if (editingUsername) {
        // Aksi Edit / Update
        const u = USERS.find(user => user.username === editingUsername);
        if (u) {
            u.name = name;
            u.email = email;
            u.role = role;
            u.password = password;
            await saveUsersDB();
            alert("Data pengguna berhasil diperbarui!");
        }
    } else {
        // Aksi Tambah Baru
        const existing = USERS.find(u => u.username === username);
        if (existing) {
            alert("Username ini sudah digunakan!");
            return;
        }

        // Buat format tanggal terdaftar: DD-MM-YYYY HH:mm:ss
        const now = new Date();
        const tglDaftar = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        USERS.push({
            username: username,
            name: name,
            email: email,
            role: role,
            password: password,
            status: 'Aktif',
            tglDaftar: tglDaftar,
            loginTerakhir: '-'
        });

        await saveUsersDB();
        alert("Berhasil menambahkan pengguna baru!");
    }

    closeModalAddUser();

    // Reset pencarian
    const searchInput = document.querySelector('#view-master-user input[type="text"]');
    if (searchInput) searchInput.value = '';

    renderMasterUser();
}

async function deleteUser(username) {
    if (username === currentUser.username) {
        alert("Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif!");
        return;
    }
    if (confirm(`Apakah Anda yakin ingin menghapus user '${username}'?`)) {
        USERS = USERS.filter(u => u.username !== username);
        await saveUsersDB();
        alert("User berhasil dihapus!");
        renderMasterUser();
    }
}

// --- MASTER BAGIAN ---
let editingBagianIndex = null;

function filterMasterBagian(keyword) {
    const tbody = document.getElementById('table-master-bagian-body');
    if (!tbody) return;
    const lowerKeyword = keyword.toLowerCase();

    tbody.innerHTML = '';
    const filteredBagian = MASTER_BAGIAN.filter(b =>
        b.nama.toLowerCase().includes(lowerKeyword)
    );

    filteredBagian.forEach((bagian, index) => {
        const originalIndex = MASTER_BAGIAN.findIndex(b => b.nama === bagian.nama);
        const row = `
        <tr class="hover:bg-white/5 transition-colors border-b border-white/5">
            <td class="py-3 px-4 text-gray-400 text-xs">${index + 1}</td>
            <td class="py-3 px-4 font-semibold text-white text-xs">${bagian.nama}</td>
            <td class="py-3 px-4 text-xs text-center">
                <div class="flex gap-1 justify-center">
                    <button onclick="openModalAddBagian(${originalIndex})" class="bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteBagian(${originalIndex})" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 w-8 h-8 rounded-lg flex items-center justify-center transition-colors" title="Hapus"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

function openModalAddBagian(index = null) {
    document.getElementById('form-add-bagian').reset();
    const modalTitle = document.querySelector('#modal-add-bagian h2');
    const modalDesc = document.querySelector('#modal-add-bagian p');

    if (index !== null) {
        editingBagianIndex = index;
        modalTitle.innerHTML = '<i class="fas fa-edit text-green-400 mr-2"></i>Edit Bagian';
        modalDesc.innerText = 'Perbarui nama instansi/divisi.';
        document.getElementById('add-bagian-name').value = MASTER_BAGIAN[index].nama;
    } else {
        editingBagianIndex = null;
        modalTitle.innerHTML = '<i class="fas fa-plus text-green-400 mr-2"></i>Tambah Bagian Baru';
        modalDesc.innerText = 'Tambahkan instansi atau divisi baru.';
    }

    document.getElementById('modal-add-bagian').classList.remove('hidden');
}

function closeModalAddBagian() {
    document.getElementById('modal-add-bagian').classList.add('hidden');
    editingBagianIndex = null;
}

async function saveBagian() {
    const namaBagian = document.getElementById('add-bagian-name').value.trim();

    if (!namaBagian) {
        alert("Nama bagian tidak boleh kosong!");
        return;
    }

    if (editingBagianIndex !== null) {
        MASTER_BAGIAN[editingBagianIndex].nama = namaBagian;
        await saveBagianDB();
        alert("Nama bagian berhasil diperbarui!");
    } else {
        MASTER_BAGIAN.push({ nama: namaBagian });
        await saveBagianDB();
        alert("Berhasil menambahkan bagian baru!");
    }

    closeModalAddBagian();

    // Reset pencarian
    const searchInput = document.querySelector('#view-master-bagian input[type="text"]');
    if (searchInput) searchInput.value = '';

    renderMasterBagian();
}

async function deleteBagian(index) {
    if (confirm(`Apakah Anda yakin ingin menghapus bagian '${MASTER_BAGIAN[index].nama}'?`)) {
        MASTER_BAGIAN.splice(index, 1);
        await saveBagianDB();
        alert("Bagian berhasil dihapus!");
        renderMasterBagian();
    }
}

// =============================================================
// ENTRY POINT
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadMasterData();
    checkAuth();
});