const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

const topDeclarations = `
let activeStoreCode = localStorage.getItem('apotek_active_store') || null;

// TUGAS QW-1: SENTRALISASI PENYIMPANAN LOCAL STORAGE (ANTI-CRASH & DRY)
function saveApotekDB(key, data) {
    if (activeStoreCode) {
        key = key + '_' + activeStoreCode;
    }
`;
appJs = appJs.replace(/\/\/ TUGAS QW-1: SENTRALISASI PENYIMPANAN LOCAL STORAGE \(ANTI-CRASH & DRY\)\nfunction saveApotekDB\(key, data\) {/, topDeclarations);


const dataLoadingBlockRegex = /\/\/ Memuat data dari Memori Perangkat \(Local Storage\)\ntry {[\s\S]*?\} catch\(e\) { console\.error\("Gagal memuat memori", e\); }\n/m;
const dataLoadingReplacement = `
function loadApotekData() {
    // Memuat data dari Memori Perangkat (Local Storage)
    try {
        let storeSuffix = activeStoreCode ? '_' + activeStoreCode : '';
        let parsedNotif = JSON.parse(localStorage.getItem('apotek_notifikasi' + storeSuffix));
        if (Array.isArray(parsedNotif)) notifikasiHistori = parsedNotif;

        let parsedMaster = JSON.parse(localStorage.getItem('apotek_masterItems' + storeSuffix));
        if (Array.isArray(parsedMaster) && parsedMaster.length > 0) masterItems = parsedMaster;

        let parsedEtalase = JSON.parse(localStorage.getItem('apotek_etalaseItems' + storeSuffix));
        if (Array.isArray(parsedEtalase)) etalaseItems = parsedEtalase;

        let parsedCashier = JSON.parse(localStorage.getItem('apotek_cashierHistory' + storeSuffix));
        if (Array.isArray(parsedCashier)) cashierHistory = parsedCashier;

        let parsedSiklus = JSON.parse(localStorage.getItem('apotek_siklusAktif' + storeSuffix));
        if (parsedSiklus) siklusAktif = parsedSiklus;

        let parsedPengeluaran = JSON.parse(localStorage.getItem('apotek_pengeluaranHistory' + storeSuffix));
        if (Array.isArray(parsedPengeluaran)) pengeluaranHistory = parsedPengeluaran;

        let parsedAntrean = JSON.parse(localStorage.getItem('apotek_antreanKulakan' + storeSuffix));
        if (Array.isArray(parsedAntrean)) antreanKulakan = parsedAntrean;

        let parsedCatatan = JSON.parse(localStorage.getItem('apotek_bukuCatatan' + storeSuffix));
        if (Array.isArray(parsedCatatan)) bukuCatatan = parsedCatatan;

        let parsedPenyusutan = JSON.parse(localStorage.getItem('apotek_penyusutan' + storeSuffix));
        if (Array.isArray(parsedPenyusutan)) historiPenyusutan = parsedPenyusutan;

        if (!siklusAktif.tanggalStart) siklusAktif.tanggalStart = getTanggalLokal();

        // [MODIFIKASI TAHAP 1] - SENSOR IMUNITAS (MIGRASI DATA KE kulakan)
        // Mengubah data tunggal menjadi bersarang (Nested) secara otomatis tanpa merusak aplikasi
        masterItems.forEach(obat => {
            if (!obat.kulakan_keuangan) {
                obat.kulakan_keuangan = [
                    {
                        idkulakan: "F-MIGRASI-" + obat.idBatch,
                        tanggalNota: "Data Sistem Lama",
                        tanggalTerima: obat.tanggalTambah || getTanggalLokal(),
                        supplier: "-",
                        noFaktur: "-",
                        qtyMasuk: obat.stokTerkini || 0,
                        qtyAsli: obat.stokAwal || 0,
                        modalBeli: obat.modal || 0,
                        modalAsli: obat.modalAsli || obat.modal || 0
                    }
                ];
                // Hapus jejak lama secara opsional atau biarkan saja (Untuk optimasi RAM lebih baik biarkan)
            }
        });
    } catch(e) { console.error("Gagal memuat memori", e); }
}

`;

appJs = appJs.replace(dataLoadingBlockRegex, dataLoadingReplacement);

// Remove the inline migration block since it's now in loadApotekData
const migrationBlockRegex = /\/\/ \[MODIFIKASI TAHAP 1\] \- SENSOR IMUNITAS \(MIGRASI DATA KE kulakan\)[\s\S]*?            } \n        }\);/m;
appJs = appJs.replace(migrationBlockRegex, '');
// Note: due to exact whitespace matching, I might need to replace more safely. I'll just use a robust regex.

fs.writeFileSync('app2.js', appJs);
