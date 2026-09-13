// ==========================================
// 1. CORE ENGINE: MEMORI & DATA MANAJEMEN
// ==========================================
const rupiah = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

function getTanggalLokal(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Variabel State Utama (Database Virtual)
let masterItems = [];
let etalaseItems = [];
let cashierHistory = [];
let profilApotek = { nama: "TOKO OBAT ARSYILA", alamat: "Desa Bahari Dua, Buton Selatan", telepon: "081234567890" };

// Variabel Global Baru untuk Keranjang Cicilan Piutang (Pembelah Sel)
let seleksiPiutangEceran = [];
let siklusAktif = { modalAwal: 0, qtyAwal: 0, modalTambahan: 0, qtyTambahan: 0, uangMasuk: 0, tanggalStart: getTanggalLokal() };
let notifikasiHistori = []; // DATABASE NOTIFIKASI TAMBAHAN
let modeEditKeranjangIndex = null; // SAKLAR CERDAS EDIT DI PENAMPUNGAN
let pengeluaranHistory = []; // MESIN BARU: DATABASE KAS KELUAR & BIAYA
let antreanKulakan = []; // PENAMPUNGAN FAKTUR KULAKAN SEMENTARA
let bukuCatatan = []; // DATABASE CATATAN DEFECTA (LOST SALES)
// --- DATABASE KHUSUS PENYUSUTAN (BARANG RUSAK/HILANG/EXPIRED) ---
let historiPenyusutan = [];
let penyusutanObatTerpilih = null; // Variabel penyimpan sementara di modal
let activeStoreCode = localStorage.getItem('apotek_active_store') || null;
let offlineQueue = [];

// TUGAS QW-1: SENTRALISASI PENYIMPANAN LOCAL STORAGE (ANTI-CRASH & DRY)
function saveApotekDB(key, data) {
    if (activeStoreCode) {
        key = key + "_" + activeStoreCode;
    }
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error("Gagal menyimpan data:", e);
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            alert('⚠️ BENCANA MEMORI PENUH!\n\nProses dibatalkan dan sistem akan dimuat ulang (Rollback) untuk mencegah kerusakan data.\n\nSegera ke menu RIWAYAT lalu hapus/bersihkan arsip lama!');
            // [PERTAHANAN 1] ROLLBACK: Buang RAM cacat, muat ulang data suci dari Local Storage
            setTimeout(() => window.location.reload(), 1500);
        }
    }
}

// TUGAS QW-2: SENTRALISASI HAPTIC FEEDBACK (VIBRASI)
function triggerHaptic(pattern = 100) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// MESIN ROLLING BALANCE (SALDO BERJALAN UANG FISIK LACI)
function hitungSaldoLaciFisik() {
    let lTunai = 0, lPelunasanTunai = 0, totalKeluar = 0;
    cashierHistory.forEach(t => {
        if (!t.isPelunasan && t.metode === 'Tunai') { lTunai += (t.total || 0); }
        else if (t.isPelunasan && (t.metodeBayar === 'Tunai' || t.metode === 'Tunai')) { lPelunasanTunai += (t.total || 0); }
    });
    pengeluaranHistory.forEach(p => {
        // Fallback: Jika data lama tidak punya sumberDana, anggap potong laci tunai
        if (!p.sumberDana || p.sumberDana === 'Tunai') totalKeluar += (p.nominal || 0);
    });
    return (lTunai + lPelunasanTunai) - totalKeluar;
}

// MESIN ROLLING BALANCE (SALDO BERJALAN UANG BANK / QRIS)
function hitungSaldoQRIS() {
    let lQRIS = 0, totalKeluarBank = 0;
    cashierHistory.forEach(t => {
        if (!t.isPelunasan && t.metode === 'QRIS') { lQRIS += (t.total || 0); }
        else if (t.isPelunasan && (t.metodeBayar === 'QRIS' || t.metodeBayar === 'qris' || t.metode === 'QRIS')) { lQRIS += (t.total || 0); }
    });
    pengeluaranHistory.forEach(p => {
        if (p.sumberDana === 'QRIS') totalKeluarBank += (p.nominal || 0);
    });
    return lQRIS - totalKeluarBank;
}

// HELPER: SINGLE SOURCE OF TRUTH FORMATTING
function formatNamaItemMaster(dnaInduk, fallbackNama, fallbackVarian, fallbackKategori, ukuranTeks = 'text-sm') {
    let namaAsli = fallbackNama || '';
    let varian = fallbackVarian || '';
    let kategori = fallbackKategori || 'Tanpa Kategori';

    if (dnaInduk) {
        let master = masterItems.find(m => m.dnaInduk === dnaInduk);
        if (!master) master = etalaseItems.find(e => e.dnaInduk === dnaInduk);
        if (master) {
            namaAsli = master.nama || namaAsli;
            varian = master.varian || varian;
            kategori = master.kategori || kategori;
        }
    }

    let subTeks = varian ? `<span class="text-[9px] text-slate-400 font-medium ml-1.5 border-l border-slate-300 pl-1.5">${varian}</span>` : '';
    let htmlNama = `<div class="font-black text-slate-800 ${ukuranTeks} leading-tight flex items-center flex-wrap">${namaAsli} ${subTeks}</div>`;
    let htmlKategori = `<span class="text-[9px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-bold uppercase tracking-widest border border-slate-200 inline-block">${kategori}</span>`;

    return {
        namaUtama: namaAsli,
        varianHtml: subTeks,
        namaHtml: htmlNama,
        kategoriHtml: htmlKategori,
        namaLengkapTxt: namaAsli + (varian ? ` ${varian}` : ''),
        kategoriTxt: kategori
    };
}

// ==========================================
// MESIN SENTRAL: SATPAM SIKLUS BUKU BESAR (FASE 2)
// ==========================================
function catatMutasiSiklus(jenis, nominalRp, jumlahQty = 0) {
    // 1. AUTO-RESET STATUS (Berlaku hanya jika ada Kulakan/Stok Masuk)
    if (jenis === 'KULAKAN_TAMBAH' && jumlahQty > 0) {
        if (siklusAktif.isLikuidasi) {
            siklusAktif.isLikuidasi = false; siklusAktif.isLanjutanDefisit = false;
            siklusAktif.hutangAwal = 0; siklusAktif.modalAwal = 0; siklusAktif.qtyAwal = 0;
            siklusAktif.uangMasuk = 0; siklusAktif.modalTambahan = 0; siklusAktif.qtyTambahan = 0;
        } else if (siklusAktif.isLanjutanDefisit) {
            siklusAktif.isLanjutanDefisit = false;
        }
    }

    // 2. LOGIKA MUTASI BUKU BESAR (SISTEM 1 PINTU)
    switch(jenis) {
        case 'OMZET_MASUK':
            siklusAktif.uangMasuk = (siklusAktif.uangMasuk || 0) + nominalRp;
            break;
        case 'OMZET_BATAL':
            siklusAktif.uangMasuk = (siklusAktif.uangMasuk || 0) - nominalRp;
            if (siklusAktif.uangMasuk < 0) siklusAktif.uangMasuk = 0;
            break;
        case 'KULAKAN_TAMBAH':
            // Cerdas: Pisahkan antara Modal Awal (buka toko pertama kali) atau Modal Tambahan
            if (!siklusAktif.waktuStart && (siklusAktif.qtyAwal || 0) === 0 && (siklusAktif.qtyTambahan || 0) === 0) {
                siklusAktif.modalAwal = (siklusAktif.modalAwal || 0) + nominalRp;
                siklusAktif.qtyAwal = (siklusAktif.qtyAwal || 0) + jumlahQty;
            } else {
                siklusAktif.modalTambahan = (siklusAktif.modalTambahan || 0) + nominalRp;
                siklusAktif.qtyTambahan = (siklusAktif.qtyTambahan || 0) + jumlahQty;
            }
            break;
        case 'KULAKAN_BATAL':
            siklusAktif.modalTambahan = (siklusAktif.modalTambahan || 0) - nominalRp;
            siklusAktif.qtyTambahan = (siklusAktif.qtyTambahan || 0) - jumlahQty;

            // LOMPATAN CERDAS: Jika stok yg dihapus ternyata berasal dari Modal Awal
            if (siklusAktif.modalTambahan < 0) {
                siklusAktif.modalAwal = (siklusAktif.modalAwal || 0) + siklusAktif.modalTambahan;
                siklusAktif.modalTambahan = 0;
            }
            if (siklusAktif.qtyTambahan < 0) {
                siklusAktif.qtyAwal = (siklusAktif.qtyAwal || 0) + siklusAktif.qtyTambahan;
                siklusAktif.qtyTambahan = 0;
            }

            // Jaring Pengaman Akhir
            if (siklusAktif.modalAwal < 0) siklusAktif.modalAwal = 0;
            if (siklusAktif.qtyAwal < 0) siklusAktif.qtyAwal = 0;
            break;
        case 'PENYUSUTAN_TAMBAH':
            siklusAktif.modalDihapus = (siklusAktif.modalDihapus || 0) + nominalRp;
            siklusAktif.qtyDihapus = (siklusAktif.qtyDihapus || 0) + jumlahQty;
            break;
    }
}

// ==========================================
// MESIN SENTRAL: PEMOTONG STOK & HPP (FASE 3)
// ==========================================
function potongStokPenjualanFIFO(dnaInduk, qtyDipotong, namaObat) {
    let bEtalase = etalaseItems.find(e => e.dnaInduk === dnaInduk);
    let totalModalItemIni = 0;
    let sisaQtyDipotong = qtyDipotong;

    if (bEtalase) {
        bEtalase.stok -= qtyDipotong;
        if (bEtalase.antreanFIFO && bEtalase.antreanFIFO.length > 0) {
            for (let i = 0; i < bEtalase.antreanFIFO.length; i++) {
                let batch = bEtalase.antreanFIFO[i];
                if (batch.stok > 0) {
                    let ambil = Math.min(sisaQtyDipotong, batch.stok);
                    if (batch.totalModal !== undefined) batch.totalModal -= Math.round((ambil / batch.stok) * (batch.totalModal || 0));
                    batch.stok -= ambil;
                    sisaQtyDipotong -= ambil;
                    if (sisaQtyDipotong <= 0) break;
                }
            }
            bEtalase.antreanFIFO = bEtalase.antreanFIFO.filter(b => b.stok > 0);
        }

        let sisaPotongkulakan = qtyDipotong;
        let masterObatTerkait = masterItems.filter(m => m.dnaInduk === dnaInduk);
        masterObatTerkait.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));

        for (let m of masterObatTerkait) {
            if (sisaPotongkulakan <= 0) break;
            if (m.kulakan_keuangan) {
                for (let f of m.kulakan_keuangan) {
                    if (sisaPotongkulakan <= 0) break;
                    let stokTersediaDikulakan = (f.sisaEtalase || 0) + (f.sisaGudang || 0);
                    if (stokTersediaDikulakan > 0) {
                        let ambilkulakan = Math.min(sisaPotongkulakan, stokTersediaDikulakan);
                        totalModalItemIni += (ambilkulakan * f.hpp);
                        if (f.sisaEtalase >= ambilkulakan) {
                            f.sisaEtalase -= ambilkulakan;
                        } else {
                            let sisaYgGudang = ambilkulakan - (f.sisaEtalase || 0);
                            f.sisaEtalase = 0;
                            f.sisaGudang -= sisaYgGudang;
                        }
                        sisaPotongkulakan -= ambilkulakan;
                    }
                }
            }
        }
        if (sisaPotongkulakan > 0 && masterObatTerkait.length > 0) {
            let modalKonservatif = Math.max(...masterObatTerkait.map(m => m.modal || 0));
            totalModalItemIni += (sisaPotongkulakan * modalKonservatif);
            kirimNotifikasiMobile('⚠️ Audit HPP', `Data Etalase [${namaObat}] tdk sinkron. HPP dihitung konservatif Rp ${modalKonservatif.toLocaleString('id-ID')}.`, 'batal', (sisaPotongkulakan * modalKonservatif));
        }
    }
    return totalModalItemIni;
}

function transferStokKeEtalase(dnaInduk, qtyDipindah, namaObat, kategoriObat, jualObat, varianObat) {
    let batchesGudang = masterItems.filter(i => i.dnaInduk === dnaInduk && i.stok > 0);
    batchesGudang.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));

    let barangEtalase = etalaseItems.find(e => e.dnaInduk === dnaInduk);
    if(!barangEtalase) {
        barangEtalase = { dnaInduk: dnaInduk, nama: namaObat, kategori: kategoriObat, jual: jualObat, varian: varianObat, stok: 0, antreanFIFO: [] };
        etalaseItems.push(barangEtalase);
    }

    let sisaYgHarusDipindah = qtyDipindah;
    for (let i = 0; i < batchesGudang.length; i++) {
        let batch = batchesGudang[i];
        if (sisaYgHarusDipindah <= 0) break;

        let jumlahDiambil = Math.min(batch.stok, sisaYgHarusDipindah);
        let modalSisa = batch.totalModal !== undefined ? batch.totalModal : (batch.modal * batch.stok);
        let nilaiModalDipindah = Math.round((jumlahDiambil / batch.stok) * modalSisa);

        if (batch.totalModal !== undefined) batch.totalModal -= nilaiModalDipindah;
        batch.stok -= jumlahDiambil;

        let sisaPindahkulakan = jumlahDiambil;
        if (batch.kulakan_keuangan) {
            for (let f of batch.kulakan_keuangan) {
                if (sisaPindahkulakan <= 0) break;
                if (f.sisaGudang > 0) {
                    let ambilDrkulakan = Math.min(sisaPindahkulakan, f.sisaGudang);
                    f.sisaGudang -= ambilDrkulakan;
                    f.sisaEtalase = (f.sisaEtalase || 0) + ambilDrkulakan;
                    sisaPindahkulakan -= ambilDrkulakan;
                }
            }
        }
        sisaYgHarusDipindah -= jumlahDiambil;
        barangEtalase.stok += jumlahDiambil;

        if(!barangEtalase.antreanFIFO) barangEtalase.antreanFIFO = [];
        let batchSamaDiEtalase = barangEtalase.antreanFIFO.find(b => b.idBatch === batch.idBatch);
        if(batchSamaDiEtalase) {
            batchSamaDiEtalase.stok += jumlahDiambil;
            if (batchSamaDiEtalase.totalModal !== undefined) batchSamaDiEtalase.totalModal += nilaiModalDipindah;
        } else {
            barangEtalase.antreanFIFO.push({ idBatch: batch.idBatch, modal: batch.modal, stok: jumlahDiambil, expired: batch.expired, totalModal: nilaiModalDipindah });
        }
    }
    barangEtalase.antreanFIFO.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));
}

// ==========================================
// MESIN SENTRAL: RETUR & PEMULIHAN STOK (FASE 4)
// ==========================================
function pulihkanStokBatal(itemRetur) {
    let qtyDiRetur = itemRetur.qty;
    let sisaYgHarusDikembalikan = qtyDiRetur;
    let modalReturKembali = itemRetur.hppSatuan || (itemRetur.jual * 0.8);

    // --- [PERBAIKAN PILAR 1] PENCIPTAAN ZOMBIE YANG LEGAL (0 GUDANG) ---
    let indukAda = masterItems.some(m => m.dnaInduk === itemRetur.dnaInduk);
    if (!indukAda && itemRetur.dnaInduk !== 'DNA-RETUR-OLD') {
        let idBatchBaru = 'R-ZOMBIE-' + Date.now() + Math.floor(Math.random()*100);
        itemRetur.nama = itemRetur.nama + ' 🔄';

        masterItems.unshift({
            idBatch: idBatchBaru, dnaInduk: itemRetur.dnaInduk, barcode: '', qrcode: '',
            nama: itemRetur.nama, varian: itemRetur.varian, kategori: itemRetur.kategori || 'Obat',
            modal: modalReturKembali, jual: itemRetur.jual,
            stok: 0, expired: '', totalModal: 0,
            kulakan_keuangan: [{
                idkulakan: "F-ZOMBIE-" + Date.now(), tanggalNota: getTanggalLokal(),
                hpp: modalReturKembali, stokAwal: qtyDiRetur, sisaGudang: 0, sisaEtalase: qtyDiRetur,
                modalKeluar: (itemRetur.hppTotalModal !== undefined ? itemRetur.hppTotalModal : Math.round(qtyDiRetur * modalReturKembali)),
                riwayatAsal: { isGrosir: false, satuanEcer: "Pcs", qtyBeli: qtyDiRetur, isiPerBox: 1 }
            }]
        });
        sisaYgHarusDikembalikan = 0;
    }

    // 1. KEMBALIKAN KE ETALASE FISIK
    let bEtalase = etalaseItems.find(i => i.dnaInduk === itemRetur.dnaInduk);
    if (bEtalase) {
        bEtalase.stok += qtyDiRetur;
        if(!bEtalase.antreanFIFO) bEtalase.antreanFIFO = [];
    } else {
        bEtalase = { dnaInduk: itemRetur.dnaInduk || 'DNA-RETUR-' + Date.now(), nama: itemRetur.nama, varian: itemRetur.varian, kategori: itemRetur.kategori || 'Obat', jual: itemRetur.jual, stok: qtyDiRetur, antreanFIFO: [] };
        etalaseItems.push(bEtalase);
    }

    // 2. RESTORASI KANTONG FIFO ETALASE
    if (sisaYgHarusDikembalikan > 0 && itemRetur.dnaInduk !== 'DNA-RETUR-OLD') {
        let masterObatTerkait = masterItems.filter(m => m.dnaInduk === itemRetur.dnaInduk);
        masterObatTerkait.sort((a, b) => new Date(b.expired || '2099-12-31') - new Date(a.expired || '2099-12-31'));

        for (let m of masterObatTerkait) {
            if (sisaYgHarusDikembalikan <= 0) break;

            if (m.kulakan_keuangan) {
                for (let i = m.kulakan_keuangan.length - 1; i >= 0; i--) {
                    let f = m.kulakan_keuangan[i];
                    if (sisaYgHarusDikembalikan <= 0) break;

                    let sisakulakanIni = (f.sisaGudang || 0) + (f.sisaEtalase || 0);
                    let stokAwalkulakan = f.stokAwal || sisakulakanIni;
                    let kapasitasKosong = stokAwalkulakan - sisakulakanIni;

                    if (kapasitasKosong > 0) {
                        let jumlahDikembalikan = Math.min(kapasitasKosong, sisaYgHarusDikembalikan);
                        f.sisaEtalase = (f.sisaEtalase || 0) + jumlahDikembalikan;

                        let totalModalProporsional = itemRetur.hppTotalModal !== undefined && itemRetur.qty > 0
                            ? Math.round((jumlahDikembalikan / itemRetur.qty) * itemRetur.hppTotalModal)
                            : (jumlahDikembalikan * modalReturKembali);

                        let batchSamaDiEtalase = bEtalase.antreanFIFO.find(x => x.idBatch === m.idBatch);

                        if (batchSamaDiEtalase) {
                            batchSamaDiEtalase.stok += jumlahDikembalikan;
                            if (batchSamaDiEtalase.totalModal !== undefined) batchSamaDiEtalase.totalModal += totalModalProporsional;
                        } else {
                            bEtalase.antreanFIFO.unshift({ idBatch: m.idBatch, modal: modalReturKembali, stok: jumlahDikembalikan, expired: m.expired || '', totalModal: totalModalProporsional });
                        }
                        sisaYgHarusDikembalikan -= jumlahDikembalikan;
                    }
                }
            }
        }
    }

    // 3. JIKA KANTONG FULL (Sabuk Pengaman / Pembangkit Zombie)
    if (sisaYgHarusDikembalikan > 0) {
         if (itemRetur.dnaInduk === 'DNA-RETUR-OLD') {
             catatMutasiSiklus('PENYUSUTAN_TAMBAH', (sisaYgHarusDikembalikan * modalReturKembali), sisaYgHarusDikembalikan);
         } else {
             let idBatchRetur = 'RETUR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
             let totalModalProporsionalSisa = itemRetur.hppTotalModal !== undefined && itemRetur.qty > 0
                 ? Math.round((sisaYgHarusDikembalikan / itemRetur.qty) * itemRetur.hppTotalModal)
                 : (sisaYgHarusDikembalikan * modalReturKembali);

             bEtalase.antreanFIFO.unshift({ idBatch: idBatchRetur, modal: modalReturKembali, stok: sisaYgHarusDikembalikan, expired: '', totalModal: totalModalProporsionalSisa });

             let indukObat = masterItems.find(m => m.dnaInduk === itemRetur.dnaInduk);
             if (indukObat) {
                 masterItems.unshift({
                     idBatch: idBatchRetur, dnaInduk: indukObat.dnaInduk, barcode: indukObat.barcode, qrcode: indukObat.qrcode,
                     nama: itemRetur.nama, varian: itemRetur.varian, kategori: itemRetur.kategori || 'Obat',
                     modal: modalReturKembali, jual: itemRetur.jual,
                     stok: 0, expired: '', totalModal: 0,
                     kulakan_keuangan: [{
                         idkulakan: "F-RETUR-" + Date.now(), tanggalNota: getTanggalLokal(), hpp: modalReturKembali,
                         stokAwal: sisaYgHarusDikembalikan, sisaGudang: 0, sisaEtalase: sisaYgHarusDikembalikan,
                         modalKeluar: totalModalProporsionalSisa, riwayatAsal: { isGrosir: false, satuanEcer: "Pcs", qtyBeli: sisaYgHarusDikembalikan, isiPerBox: 1 }
                     }]
                 });
             }
         }
    }
}

// ==========================================
// MESIN SENTRAL: AKUNTANSI & NERACA (FASE 1)
// ==========================================
function kalkulasiAsetFisik() {
    let asetGudang = 0, qtyGudang = 0;
    masterItems.forEach(b => {
        if (b.nama !== '___SYSTEM_AUTH___' && b.kategori !== '⚠️ Barang Retur') {
            asetGudang += (b.totalModal !== undefined ? b.totalModal : (b.modal * b.stok));
            qtyGudang += (b.stok || 0);
        }
    });

    let asetEtalase = 0, qtyEtalase = 0;
    etalaseItems.forEach(b => {
        qtyEtalase += (b.stok || 0);
        if(b.antreanFIFO && b.antreanFIFO.length > 0) {
            b.antreanFIFO.forEach(f => {
                asetEtalase += (f.totalModal !== undefined ? f.totalModal : (f.modal * f.stok));
            });
        } else {
            let m = masterItems.find(x => x.dnaInduk === b.dnaInduk || x.nama === b.nama);
            asetEtalase += (m ? (m.modal || 0) : 0) * (b.stok || 0);
        }
    });

    return {
        qtyGudang, asetGudang,
        qtyEtalase, asetEtalase,
        totalQty: qtyGudang + qtyEtalase,
        totalAset: asetGudang + asetEtalase
    };
}


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

        let parsedQueue = JSON.parse(localStorage.getItem('arsyila_offline_queue' + storeSuffix));
        if (Array.isArray(parsedQueue)) offlineQueue = parsedQueue;

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
            }
        });

        // [AUTO-HEALER TAHAP 2] - PEMBASMI UANG SILUMAN QRIS (MIGRASI SEKALI JALAN)
        let healerKey = 'sudah_diperbaiki_qris_v1' + (activeStoreCode ? '_' + activeStoreCode : '');
        if (!localStorage.getItem(healerKey)) {
            let adaPerbaikan = false;
            cashierHistory.forEach(t => {
                if (t.isPelunasan && t.metode === 'Tunai' && t.metodeBayar && (t.metodeBayar.toUpperCase() === 'QRIS')) {
                    t.metode = 'QRIS';
                    adaPerbaikan = true;
                }
            });

            if (adaPerbaikan) {
                saveApotekDB('apotek_cashierHistory', cashierHistory);
            }
            // Tempelkan stiker hijau agar robot tidur selamanya setelah ini
            localStorage.setItem(healerKey, 'true');
        }
    } catch(e) { console.error("Gagal memuat memori", e); }

}



// ==========================================
// 2. NAVIGASI LAYAR (ROUTING)
// ==========================================
function bukaLayar(targetLayar) {
    // [AUTO-CLEANER] Tutup semua pop-up/dropdown yang melayang sebelum pindah layar
    let drpRiwayat = document.getElementById('panelFilterRiwayat');
    if(drpRiwayat && !drpRiwayat.classList.contains('hidden')) toggleDropdownFilterRiwayat();
    
    let drpLaporan = document.getElementById('panelFilterLaporan');
    if(drpLaporan && !drpLaporan.classList.contains('hidden')) toggleDropdownFilterLaporan();
    
    let drpPDF = document.getElementById('panelExportPDF');
    if(drpPDF && !drpPDF.classList.contains('hidden')) toggleDropdownExportPDF();

    // Sembunyikan semua layar
    document.querySelectorAll('.layar-app').forEach(layar => layar.classList.add('hidden'));
    // Tampilkan layar yang dituju
    const layarAktif = document.getElementById('layar-' + targetLayar);
    if(layarAktif) layarAktif.classList.remove('hidden');

    // Ubah warna ikon di navigasi bawah
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.dataset.target === targetLayar) {
             btn.classList.replace('text-slate-400', 'text-corporate-600');
         } else {
             btn.classList.replace('text-corporate-600', 'text-slate-400');
         }
    });

    // [PENYEMPURNAAN BARU] Sinkronisasi Warna Latar Belakang Celah Bawah
    const areaScroll = document.querySelector('.flex-1.overflow-y-auto');
    if (areaScroll) {
        if (targetLayar === 'laporan') {
            areaScroll.classList.add('bg-[#2e3136]'); // Ubah celah jadi gelap
        } else {
            areaScroll.classList.remove('bg-[#2e3136]'); // Kembalikan celah jadi terang
        }
    }

    // [PENYEMPURNAAN UX] Hapus isi kolom pencarian otomatis jika pindah layar secara manual
    if (targetLayar === 'piutang') { let s = document.getElementById('cariPiutangMobile'); if(s) s.value = ''; }
    if (targetLayar === 'gudang') { let s = document.getElementById('cariGudangMobile'); if(s) s.value = ''; }
    if (targetLayar === 'etalase') { let s = document.getElementById('cariEtalaseMobile'); if(s) s.value = ''; }

    // Jalankan fungsi render sesuai layar yang dibuka
    if (targetLayar === 'beranda') renderBerandaMobile();
    if (targetLayar === 'bukurusak') renderBukuRusakMobile();
    if (targetLayar === 'rekap') renderRekapMobile();
    if (targetLayar === 'gudang') renderGudangMobile(document.getElementById('cariGudangMobile').value);
    if (targetLayar === 'riwayat') renderRiwayatMobile();
    if (targetLayar === 'piutang') renderPiutangMobile();
    if (targetLayar === 'etalase') renderEtalaseMobile();
    if (targetLayar === 'laporan') renderLaporanMobile();
}


// ==========================================
// 3. MESIN RENDER: BERANDA (VERSI PENYEMPURNAAN TOTAL PIPA AIR)
// ==========================================
function renderBerandaMobile() {
    let tglHariIni = getTanggalLokal();
    let waktuMulai = siklusAktif.waktuStart || 0;

    let omzet = 0, laba = 0, hpp = 0, daftarTerlaris = {}, totalKasbonBelumLunas = 0;
    let totalItemTerjualHariIni = 0, totalPembeliHariIni = 0;
    let totalPelunasan = 0;
    let setPembeliUnikBeranda = new Set();

    cashierHistory.forEach(t => {
        if (t.tanggal === tglHariIni) {
            if (!t.isPelunasan) {
                omzet += t.total || 0; laba += t.laba || 0; hpp += ((t.total || 0) - (t.laba || 0));
                totalItemTerjualHariIni += (t.item || 0);

                let kunciPelacak = (t.metode === 'Debt') ? `DEBT_${t.tanggal}_${t.waktu}_${t.pelanggan}` : `TRX_${t.id}`;
                setPembeliUnikBeranda.add(kunciPelacak);
                totalPembeliHariIni = setPembeliUnikBeranda.size;

                if (t.detailKeranjang && t.detailKeranjang.length > 0) {
                    t.detailKeranjang.forEach(item => {
                        let idKunci = item.dnaInduk || item.nama;
                        if (daftarTerlaris[idKunci]) {
                            daftarTerlaris[idKunci].item += item.qty || 0;
                            daftarTerlaris[idKunci].omset += (item.jual * item.qty) || 0;
                        } else {
                            daftarTerlaris[idKunci] = { dnaInduk: item.dnaInduk, nama: item.nama, varian: item.varian, kategori: item.kategori, item: item.qty || 0, omset: (item.jual * item.qty) || 0 };
                        }
                    });
                } else {
                    if (daftarTerlaris[t.obat]) {
                        daftarTerlaris[t.obat].item += t.item || 0;
                        daftarTerlaris[t.obat].omset += t.total || 0;
                    } else {
                        daftarTerlaris[t.obat] = { dnaInduk: null, nama: t.obat, varian: '', kategori: '', item: t.item || 0, omset: t.total || 0 };
                    }
                }
            } else {
                totalPelunasan += t.total || 0;
            }
        }
        if (t.metode === 'Debt' && !t.statusLunas) totalKasbonBelumLunas++;
    });

    // Injeksi data ke 3 kartu utama atas
    if (document.getElementById('berandaOmzet')) document.getElementById('berandaOmzet').textContent = rupiah(Math.round(omzet));
    if (document.getElementById('berandaHPP')) document.getElementById('berandaHPP').textContent = '- ' + rupiah(Math.round(hpp));
    if (document.getElementById('berandaLaba')) document.getElementById('berandaLaba').textContent = rupiah(Math.round(laba));

    if(document.getElementById('berandaPelunasan')) {
        document.getElementById('berandaPelunasan').textContent = '+ ' + rupiah(totalPelunasan);
        document.getElementById('wadahPelunasan').classList.toggle('hidden', totalPelunasan === 0);
    }

    // ⚡ KALKULASI PRESISI BERDASARKAN KALKULATOR MASTER (GUDANG + ETALASE)
    let countKritis = 0, countExpired = 0;
    let totalSisaStok = 0;
    let tglSekarang = new Date(tglHariIni);

    let masterDataMap = KalkulatorMasterObat();
    let totalJenisObat = Object.keys(masterDataMap).length;

    Object.values(masterDataMap).forEach(item => {
        totalSisaStok += item.sisaFisikTotal;
        if (item.sisaFisikTotal <= 2) {
            countKritis++;
        }
        if (item.expTerdekat !== '2099-12-31' && item.sisaFisikTotal > 0) {
            let diffHari = Math.floor((new Date(item.expTerdekat) - tglSekarang) / (1000 * 60 * 60 * 24));
            if (diffHari <= 30) countExpired++; // Batas >= 0 dicabut agar barang expired tetap terhitung
        }
    });

let topQtyMurni = (siklusAktif.qtyAwal || 0) + (siklusAktif.qtyTambahan || 0);
    let tercapai = siklusAktif.uangMasuk || 0;
    let targetHutang = (siklusAktif.hutangAwal !== undefined ? siklusAktif.hutangAwal : (siklusAktif.modalAwal || 0)) + (siklusAktif.modalTambahan || 0);

    let terjualSiklusIni = 0;
    cashierHistory.forEach(t => {
        if (t.id >= waktuMulai && !t.isPelunasan) {
            terjualSiklusIni += (t.item || 0);
        }
    });

    // ======================================================================
    // LOGIKA PERGERAKAN PIPA AIR SIKLUS PENJUALAN MURNI
    // ======================================================================
    let badgeStok = document.getElementById('berandaStokModalSiklus');
    if (badgeStok) badgeStok.textContent = topQtyMurni;

    let labelTarget = document.getElementById('berandaTeksTarget');
    if (labelTarget) labelTarget.textContent = rupiah(targetHutang);

    let pipaAir = document.getElementById('berandaPipaAir');
    let teksOmzet = document.getElementById('berandaTeksOmzet');
    let teksStatus = document.getElementById('berandaTeksStatus');

    if (pipaAir && teksOmzet && teksStatus) {
        let qtyDihapus = siklusAktif.qtyDihapus || 0;
        let modalDihapus = siklusAktif.modalDihapus || 0;

        let soldPercent = topQtyMurni === 0 ? 0 : (terjualSiklusIni / topQtyMurni) * 100;
        let lossPercent = topQtyMurni === 0 ? 0 : (qtyDihapus / topQtyMurni) * 100;

        let totalPercent = Math.min(100, soldPercent + lossPercent);

        pipaAir.style.width = totalPercent + '%';
        pipaAir.className = "h-full transition-all duration-1000 ease-out animasi-air-hidup rounded-full shadow-[0_0_10px_rgba(245,158,11,0.4)]";

        if (lossPercent > 0) {
            let colorSold = tercapai >= targetHutang ? '#10b981' : '#f59e0b';
            let colorLoss = '#ef4444';

            let pSold = (soldPercent / totalPercent) * 100;

            pipaAir.style.background = `linear-gradient(to right, ${colorSold} ${pSold}%, ${colorLoss} ${pSold}%, ${colorLoss} 100%)`;
        } else {
            if (tercapai < targetHutang) {
                pipaAir.style.background = `linear-gradient(to right, #ef4444, #fb923c, #f59e0b)`;
            } else if (tercapai === targetHutang && targetHutang > 0) {
                pipaAir.style.background = `linear-gradient(to right, #f59e0b, #facc15, #fbbf24)`;
            } else {
                pipaAir.style.background = `linear-gradient(to right, #10b981, #2dd4bf, #34d399)`;
            }
        }

        teksOmzet.textContent = "Kas Masuk: " + rupiah(tercapai);
        teksOmzet.className = tercapai < targetHutang ? "text-[9px] font-black text-slate-800 tracking-wide uppercase" : "text-[9px] font-black text-white tracking-wide uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]";

        if (tercapai > targetHutang) {
            let surplus = tercapai - targetHutang;
            teksStatus.innerHTML = `<span class="text-emerald-600 font-black"><i class="fa-solid fa-crown"></i> Paripurna: Kas tembus target (+ Rp ${(Number(surplus) || 0).toLocaleString('id-ID')})</span>`;
        } else if (tercapai === targetHutang && targetHutang > 0 && modalDihapus === 0) {
            teksStatus.innerHTML = `<span class="text-amber-600 font-black"><i class="fa-solid fa-scale-balanced"></i> Sempurna: Kas masuk mencapai 100% Stok Modal.</span>`;
        } else if ((terjualSiklusIni + qtyDihapus) >= topQtyMurni && tercapai < targetHutang) {
            teksStatus.innerHTML = `<span class="text-blue-600 font-black">Siklus Selesai: Kas Rp ${(Number(tercapai) || 0).toLocaleString('id-ID')} (Susut: Rp ${(Number(modalDihapus) || 0).toLocaleString('id-ID')})</span>`;
        } else if ((terjualSiklusIni + qtyDihapus) < topQtyMurni && modalDihapus > 0) {
            teksStatus.innerHTML = `<span class="text-slate-600 font-bold">⚠️ Kas Rp ${(Number(tercapai) || 0).toLocaleString('id-ID')} | Susut: Rp ${(Number(modalDihapus) || 0).toLocaleString('id-ID')} | Sisa Target: Rp ${(Number(targetHutang - tercapai) || 0).toLocaleString('id-ID')}</span>`;
        } else if ((terjualSiklusIni + qtyDihapus) < topQtyMurni && modalDihapus === 0) {
            teksStatus.innerHTML = `<span class="text-slate-500 font-bold">Status: Kas masuk masih di bawah Stok Modal.</span>`;
        }
    }
    // ======================================================================
    // LOGIKA PERHITUNGAN HARI BERJALAN (AGE OF SHIFT)
    // ======================================================================
    let badgeHari = document.getElementById('berandaHariBerjalan');
    if (badgeHari && siklusAktif.tanggalStart) {
        let tglMulai = new Date(siklusAktif.tanggalStart);
        let tglSekarang = new Date(tglHariIni); // tglHariIni diambil dari getTanggalLokal() di atas

        // Hitung selisih hari
        let diffTime = tglSekarang - tglMulai;
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Ditambah 1 karena hari H adalah Hari ke-1

        // Jaring pengaman jika HP kasir mundur tanggalnya
        if (diffDays < 1) diffDays = 1;

        // Beri warna peringatan jika lebih dari 1 hari belum ditutup
        if (diffDays > 1) {
            badgeHari.innerHTML = `<span class="text-rose-600 font-black">HARI KE-${diffDays} (AKTIF)</span>`;
        } else {
            badgeHari.textContent = `HARI KE-${diffDays} BERJALAN`;
        }
    }
    // ======================================================================

    let arrTerlaris = Object.values(daftarTerlaris).sort((a, b) => b.item - a.item).slice(0, 3);
    const wadahTerlaris = document.getElementById('wadahObatTerlaris');

    if (wadahTerlaris) {
        if(arrTerlaris.length === 0) {
            wadahTerlaris.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs font-bold"><i class="fa-solid fa-box-open text-3xl mb-2 block opacity-50"></i><br>Belum ada penjualan di sesi ini</div>`;
        } else {
            wadahTerlaris.innerHTML = arrTerlaris.map((ob, idx) => {
                let styling = idx === 0 ? 'bg-amber-100 text-amber-600 border-amber-200' : (idx === 1 ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-orange-50 text-orange-600 border-orange-200');
                let infoFormat = formatNamaItemMaster(ob.dnaInduk, ob.nama, ob.varian, ob.kategori, 'text-xs truncate');
                return `<div class="flex items-center gap-2 p-2 hover:bg-slate-50 transition"><div class="w-6 h-6 rounded-full ${styling} flex items-center justify-center font-black text-xs shrink-0 border">${idx + 1}</div><div class="flex-1 overflow-hidden"><div class="mb-0.5">${infoFormat.namaHtml}</div><div class="flex items-center gap-1.5"><p class="text-[9px] text-slate-500">${ob.item} Terjual</p>${infoFormat.kategoriHtml}</div></div><div class="text-right shrink-0"><p class="font-bold text-corporate-700 text-xs">${rupiah(ob.omset)}</p></div></div>`;
            }).join('');
        }
    }

    if (document.getElementById('berandaKritis')) document.getElementById('berandaKritis').textContent = countKritis;
    if (document.getElementById('berandaKasbon')) document.getElementById('berandaKasbon').textContent = totalKasbonBelumLunas;
    if (document.getElementById('berandaKedaluwarsa')) document.getElementById('berandaKedaluwarsa').textContent = countExpired;
                if (document.getElementById('berandaSisaStok')) document.getElementById('berandaSisaStok').textContent = totalSisaStok;

                // KALKULASI MURNI HARI INI (KALENDER 00:00) UNTUK PANTUAN SISTEM
                let lakuMurniHariIni = 0;
                let pembeliMurniHariIni = new Set();
                cashierHistory.forEach(t => {
                    if (t.tanggal === tglHariIni && !t.isPelunasan) {
                        lakuMurniHariIni += (t.item || 0);
                        let kunciMurni = (t.metode === 'Debt') ? `DEBT_${t.tanggal}_${t.waktu}_${t.pelanggan}` : `TRX_${t.id}`;
                        pembeliMurniHariIni.add(kunciMurni);
                    }
                });

                if (document.getElementById('berandaObatTerjual')) document.getElementById('berandaObatTerjual').textContent = lakuMurniHariIni;
                if (document.getElementById('berandaPembeli')) document.getElementById('berandaPembeli').textContent = pembeliMurniHariIni.size;
                if (document.getElementById('berandaJenis')) document.getElementById('berandaJenis').textContent = totalJenisObat;

    if (document.getElementById('panelStokSisa')) document.getElementById('panelStokSisa').textContent = totalSisaStok;
    if (document.getElementById('panelStokTerjual')) document.getElementById('panelStokTerjual').textContent = terjualSiklusIni;

    let angkaStokModal = siklusAktif.isLikuidasi ? (siklusAktif.qtyTambahan || 0) : ((siklusAktif.qtyAwal || 0) + (siklusAktif.qtyTambahan || 0));
    if (document.getElementById('panelStokTotal')) document.getElementById('panelStokTotal').textContent = angkaStokModal;
    if (document.getElementById('panelStokRusak')) document.getElementById('panelStokRusak').textContent = (siklusAktif.qtyDihapus || 0);
    if (document.getElementById('panelPembeliSiklus')) document.getElementById('panelPembeliSiklus').textContent = totalPembeliHariIni;

    const scrollPantauan = document.getElementById('wadahPantauanSistem');
    if (scrollPantauan) { scrollPantauan.scrollLeft = 0; }
}

// ==========================================
// 4. MESIN RENDER: GUDANG & ETALASE (DIPERBARUI)
// ==========================================
function renderGudangMobile(filter = '') {
    const wadah = document.getElementById('daftarGudangMobile');
    const f = filter.toLowerCase().trim();

    // ⚡ KABEL BARU: PANGGIL POHON DATA DARI SATPAM ARSIP
    let pohonData = KalkulatorMasterObat();

    // FILTER: Hanya ambil barang yang memiliki Batch (Sah di Gudang) dan sesuai pencarian
    let dataTampil = Object.values(pohonData).filter(i => {
        if (i.kategori === '⚠️ Barang Retur' || i.kategori === 'Barang Dihapus' || i.kategori === 'Data Lama') return false;
        if (i.batches.length === 0) return false;

        return i.namaLengkap.toLowerCase().includes(f) || (i.kategori && i.kategori.toLowerCase().includes(f));
    });

    if (dataTampil.length === 0) {
        wadah.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm mt-4"><i class="fa-solid fa-box-open text-4xl text-slate-300 mb-3 block"></i><p class="text-sm font-bold text-slate-500">Tidak ada obat ditemukan.</p></div>`;
        return;
    }

    // RAKIT UI BERDASARKAN POHON DATA LEVEL 1 DAN LEVEL 2 (BATCH)
    wadah.innerHTML = dataTampil.map(g => {
        let batches = g.batches.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));

        let refBatch = batches[0];
        let namaAsli = refBatch.nama;
        let subTeks = refBatch.varian ? `<span class="text-[9px] text-slate-400 font-medium ml-1.5 border-l border-slate-300 pl-1.5">${refBatch.varian}</span>` : '';

        // AMBIL ANGKA MATANG DARI KALKULATOR MASTER
        let qtyTerjual = g.lakuShiftIni;
        let sisaFisik = g.sisaFisikTotal;
        let totalRusak = g.rusakExpTotal;

        // RUMUS STOK MODAL AWAL
        let qtyAwal = 0;
        if (siklusAktif.isLikuidasi) {
            let snap = (siklusAktif.snapshotStok && siklusAktif.snapshotStok[g.dnaInduk]) ? siklusAktif.snapshotStok[g.dnaInduk] : 0;
            qtyAwal = (sisaFisik + qtyTerjual + totalRusak) - snap;
            if (qtyAwal < 0) qtyAwal = 0;
        } else {
            qtyAwal = sisaFisik + qtyTerjual + totalRusak;
        }

        let batchHtml = batches.map((b, idx) => {
            let expTeks = b.expired ? b.expired : 'Tanpa Exp';
            let expColor = b.expired ? 'text-red-500 font-bold' : 'text-slate-400';
            return `
            <div class="flex items-center justify-between text-[10px] bg-slate-50/50 border border-slate-100 px-3 py-1.5 rounded-lg">
                <div class="text-slate-500 font-semibold"><span class="text-slate-400 mr-1 text-[9px]">BATCH ${idx+1}</span> <span class="text-slate-300 mx-1">|</span> Exp: <span class="${expColor}">${expTeks}</span></div>
                <div class="text-slate-600 font-bold flex gap-2">
                    <span>Sisa: <span class="text-emerald-600">${b.stok}</span></span>
                    <span class="text-slate-300">|</span>
                    <span>Beli: <span class="text-red-400">${rupiah(Math.round(b.modal))}</span></span>
                </div>
            </div>`;
        }).join('<div class="h-1"></div>');

        return `
        <div class="bg-white border border-slate-200 rounded-2xl p-4 mb-4 shadow-sm relative overflow-hidden group">
            <div class="flex justify-between items-start mb-3 border-b border-slate-100 pb-3">
                            <div class="flex-1 pr-2">
                <h3 class="font-black text-slate-800 text-lg leading-tight flex items-center gap-2">${namaAsli} ${subTeks}</h3>
                <div class="flex items-center gap-2 mt-1.5">
                    <span class="text-[9px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-bold uppercase tracking-widest border border-slate-200">${g.kategori || 'Tanpa Kategori'}</span>
                    <button onclick="bukaDetailObatMobile('${g.dnaInduk}')" class="text-[9px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-widest border border-blue-200 active:scale-95 transition shadow-sm"><i class="fa-solid fa-circle-info"></i> Cek Detail</button>
                </div>
            </div>
                <div class="text-right shrink-0">
                    <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Harga Jual</p>
                    <p class="font-black text-corporate-700 text-base leading-none">${rupiah(g.hargaJual)}</p>
                </div>
            </div>

                        <div class="flex items-center justify-between border-y border-slate-100 py-2.5 my-3">
                <div class="flex-1 text-center bg-slate-100 py-2 rounded-xl border border-slate-200 mr-1 shadow-inner">
                    <p class="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 flex items-center justify-center gap-1"><i class="fa-solid fa-boxes-stacked"></i> Stok Modal</p>
                    <p class="text-sm font-black text-slate-800 leading-none">${qtyAwal}</p>
                </div>
                <div class="flex-1 text-center border-r border-slate-100">
                    <p class="text-[8px] font-black text-amber-500 uppercase tracking-widest mb-1 flex items-center justify-center gap-1"><i class="fa-solid fa-cart-arrow-down"></i> Terjual</p>
                    <p class="text-sm font-black text-amber-600 leading-none drop-shadow-sm">${qtyTerjual}</p>
                </div>
                <div class="flex-1 text-center">
                    <p class="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1 flex items-center justify-center gap-1"><i class="fa-solid fa-check-circle"></i> Sisa Stok</p>
                    <p class="text-sm font-black text-emerald-600 leading-none drop-shadow-sm">${sisaFisik}</p>
                </div>
            </div>

            <div class="mb-4">
                ${batchHtml}
            </div>

            <div class="flex gap-2">
                <button onclick="bukaModalTransferMobile('${g.dnaInduk}')" class="flex-1 h-10 bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-500 hover:text-white text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm">
                    <i class="fa-solid fa-truck-fast text-sm"></i> Ke Etalase
                </button>
                <button onclick="bukaModalEditMobile('${batches[0].idBatch}')" class="w-12 h-10 bg-white text-corporate-600 hover:bg-corporate-50 border border-slate-200 rounded-xl flex items-center justify-center transition-all active:scale-95 shadow-sm">
                    <i class="fa-solid fa-pen"></i>
                </button>
                ${( (sisaFisik > 0 && qtyTerjual > 0) || (sisaFisik > 0 && batches.some(b => b.idBatch.includes('ZOMBIE') || b.idBatch.includes('RETUR') || b.isPernahBatal)) ) ?
                `<button onclick="alert('⚠️ AKSES DIBLOKIR!\\n\\nObat ini sedang beredar, memiliki transaksi, atau pernah dibatalkan/diretur.\\n\\nUntuk menjaga rekam jejak audit keuangan, silakan gunakan fitur PENYUSUTAN di menu atas Gudang jika Anda ingin mengurangi/membuang sisa stok fisiknya.')" class="w-12 h-10 bg-slate-50 text-slate-300 border border-slate-200 rounded-xl flex items-center justify-center transition-all shadow-sm">
                    <i class="fa-solid fa-trash-can-arrow-up"></i>
                </button>`
                :
                `<button onclick="bukaModalHapusCerdas('${g.dnaInduk}', '${namaAsli}')" class="w-12 h-10 bg-white text-red-500 hover:bg-red-50 border border-slate-200 rounded-xl flex items-center justify-center transition-all active:scale-95 shadow-sm">
                    <i class="fa-solid fa-trash"></i>
                </button>`}
            </div>
        </div>`;
    }).join('');
}

function renderEtalaseMobile() {
    // [PERTAHANAN 4] AUTO-HEALER: Sweeping Kantung FIFO Etalase Sebelum Dirender
    let adaPenyembuhan = false;
    etalaseItems.forEach(e => {
        let totalFIFO = e.antreanFIFO ? e.antreanFIFO.reduce((sum, x) => sum + x.stok, 0) : 0;
        if (e.stok > 0 && totalFIFO < e.stok) {
            let selisih = e.stok - totalFIFO;
            if (!e.antreanFIFO) e.antreanFIFO = [];
            let masterObat = masterItems.find(m => m.dnaInduk === e.dnaInduk || m.nama === e.nama);
            if (masterObat) {
                e.antreanFIFO.push({ idBatch: masterObat.idBatch, modal: masterObat.modal, stok: selisih, expired: masterObat.expired, totalModal: (selisih * masterObat.modal) });
                adaPenyembuhan = true;
            }
        }
    });
    if (adaPenyembuhan) saveApotekDB('apotek_etalaseItems', etalaseItems); // Simpan diam-diam tanpa alert

    const wadah = document.getElementById('daftarEtalaseMobile');
    const f = (document.getElementById('cariEtalaseMobile').value || '').toLowerCase().trim();

    let etalaseAktif = etalaseItems.filter(i => i.stok > 0 && (i.nama.toLowerCase().includes(f) || (i.kategori && i.kategori.toLowerCase().includes(f)) || (i.varian && i.varian.toLowerCase().includes(f))));
    if (etalaseAktif.length === 0) {
        wadah.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm mt-4"><i class="fa-solid fa-inbox text-4xl text-slate-300 mb-3 block"></i><p class="font-bold text-slate-600">Etalase kosong.</p><p class="text-[10px] text-slate-400 mt-1">Transfer obat dari Gudang ke sini.</p></div>`;
        return;
    }

    wadah.innerHTML = etalaseAktif.map(i => {
        let subTeks = i.varian ? `<span class="text-[9px] text-slate-400 font-medium ml-1.5 border-l border-slate-300 pl-1.5">${i.varian}</span>` : '';
        return `
        <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
            <div class="flex-1 pr-2 border-r border-slate-100">
                <h3 class="font-black text-slate-800 text-sm leading-tight flex items-center">${i.nama}${subTeks}</h3>
                <p class="text-[10px] text-corporate-500 font-bold uppercase tracking-widest mt-1.5">${i.kategori || 'Tanpa Kategori'}</p>
            </div>
            <div class="flex flex-col items-end shrink-0 pl-1">
                <p class="font-black text-corporate-700 text-base mb-1">${rupiah(i.jual)}</p>
                <div class="bg-emerald-50 text-emerald-600 border border-emerald-100 px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-inner">
                    <i class="fa-solid fa-boxes-stacked text-[9px]"></i><span class="font-black text-xs">${i.stok}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// 5. MESIN RIWAYAT CERDAS (SELEKSI, BINTANG & ARSIP)
// ==========================================
let riwayatTabAktifMobile = 'semua';
let modeSeleksiRiwayatAktif = false;
let itemTerpilihRiwayat = [];
let timerLongPressRiwayat;

function ubahTabRiwayat(tab) {
    riwayatTabAktifMobile = tab;
    batasTampilRiwayat = 50; // RESET LIMIT
    batalSeleksiRiwayat();
    renderRiwayatMobile();
}


function mulaiTekanRiwayat(id) {
    if(modeSeleksiRiwayatAktif) return;
    timerLongPressRiwayat = setTimeout(() => {
        triggerHaptic(100);
        aktifkanModeSeleksiRiwayat(id);
    }, 500);
}

function lepasTekanRiwayat() { clearTimeout(timerLongPressRiwayat); }

function klikItemRiwayat(id) {
    if(modeSeleksiRiwayatAktif) { togglePilihRiwayat(id); }
}

function aktifkanModeSeleksiRiwayat(idPertama) {
    modeSeleksiRiwayatAktif = true; itemTerpilihRiwayat = [idPertama];
    document.getElementById('headerNormalRiwayat').classList.add('hidden');
    document.getElementById('headerSeleksiRiwayat').classList.remove('hidden');
    renderRiwayatMobile();
}

function batalSeleksiRiwayat() {
    modeSeleksiRiwayatAktif = false; itemTerpilihRiwayat = [];
    document.getElementById('headerSeleksiRiwayat').classList.add('hidden');
    document.getElementById('headerNormalRiwayat').classList.remove('hidden');
    renderRiwayatMobile();
}

function togglePilihRiwayat(id) {
    let idx = itemTerpilihRiwayat.indexOf(id);
    if(idx !== -1) itemTerpilihRiwayat.splice(idx, 1);
    else itemTerpilihRiwayat.push(id);

    if(itemTerpilihRiwayat.length === 0) batalSeleksiRiwayat();
    else { document.getElementById('teksJumlahSeleksi').textContent = itemTerpilihRiwayat.length + " Dipilih"; renderRiwayatMobile(); }
}

// --- MESIN FILTER MULTI-TANGGAL RIWAYAT ---
let riwayatTglAwal = getTanggalLokal();
let riwayatTglAkhir = getTanggalLokal();
let riwayatLabelVisual = "Hari Ini";
let batasTampilRiwayat = 50; // KATUP OTOMATIS LOAD MORE

function muatLebihBanyakRiwayat() {
    batasTampilRiwayat += 50;
    renderRiwayatMobile();
}

function toggleDropdownFilterRiwayat() {
    const panel = document.getElementById('panelFilterRiwayat');
    const icon = document.getElementById('iconDropdownFilterRiwayat');
    const backdrop = document.getElementById('backdropFilterRiwayat');
    if(panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (backdrop) backdrop.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
        icon.style.transform = 'rotate(180deg)';
    } else {
        panel.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function setFilterRiwayat(tipe) {
    let tglSkrg = new Date();
    if (tipe === 'hari_ini') {
        riwayatTglAwal = getTanggalLokal(tglSkrg);
        riwayatTglAkhir = getTanggalLokal(tglSkrg);
        riwayatLabelVisual = "Hari Ini";
    } else if (tipe === '7_hari') {
        let tglLalu = new Date();
        tglLalu.setDate(tglLalu.getDate() - 6);
        riwayatTglAwal = getTanggalLokal(tglLalu);
        riwayatTglAkhir = getTanggalLokal(tglSkrg);
        riwayatLabelVisual = "7 Hari Terakhir";
    } else if (tipe === 'siklus') {
        riwayatTglAwal = siklusAktif.tanggalStart;
        riwayatTglAkhir = getTanggalLokal(tglSkrg);
        riwayatLabelVisual = "Siklus Saat Ini";
    } else if (tipe === 'arsip') {
        riwayatTglAwal = "2000-01-01";
        riwayatTglAkhir = "2099-12-31";
        riwayatLabelVisual = "Arsip Total";
    } else if (tipe === 'manual') {
        let awal = document.getElementById('filterRiwayatTglAwal').value;
        let akhir = document.getElementById('filterRiwayatTglAkhir').value;
        if(!awal || !akhir) return alert("⚠️ Pilih tanggal Dari dan Sampai terlebih dahulu!");
        if(awal > akhir) return alert("⚠️ Tanggal 'Dari' tidak boleh lebih besar dari 'Sampai'!");
        riwayatTglAwal = awal;
        riwayatTglAkhir = akhir;
        if(awal === akhir) {
            riwayatLabelVisual = formatTanggalPendek(awal);
        } else {
            riwayatLabelVisual = `${formatTanggalPendek(awal)} - ${formatTanggalPendek(akhir)}`;
        }
    }

  document.getElementById('teksFilterRiwayatUi').textContent = riwayatLabelVisual;
    toggleDropdownFilterRiwayat();
    batasTampilRiwayat = 50; // RESET LIMIT
    batalSeleksiRiwayat(); // Batalkan seleksi saat ganti tanggal agar tidak bug
    renderRiwayatMobile();
}

function pilihSemuaRiwayat() {
    let dataTampil = cashierHistory.filter(t => t.tanggal >= riwayatTglAwal && t.tanggal <= riwayatTglAkhir);
    if(riwayatTabAktifMobile === 'semua') dataTampil = dataTampil.filter(t => !t.isArsip);
    else if(riwayatTabAktifMobile === 'bintang') dataTampil = dataTampil.filter(t => t.isBintang && !t.isArsip);
    else if(riwayatTabAktifMobile === 'arsip') dataTampil = dataTampil.filter(t => t.isArsip);

    // --- SMART LIMIT: Hanya seleksi yang terlihat di layar HTML ---
    let isPencarianSatuHari = (riwayatTglAwal === riwayatTglAkhir);
    if (!isPencarianSatuHari && dataTampil.length > batasTampilRiwayat) {
        dataTampil = dataTampil.slice(0, batasTampilRiwayat);
    }

    itemTerpilihRiwayat = dataTampil.map(t => t.id);
    document.getElementById('teksJumlahSeleksi').textContent = itemTerpilihRiwayat.length + " Dipilih";
    renderRiwayatMobile();
}

function prosesHapusMasalRiwayat() {
    if(itemTerpilihRiwayat.length === 0) return;

    // 1. MESIN PEMILAH ARSIP CERDAS (3 JALUR)
    let idHangus = [];
    let idDilindungi = [];
    let idTerlaluBaru = [];

    // Set Batas Umur Aman: 30 Hari Kebelakang
    let tglBatas = new Date();
    tglBatas.setDate(tglBatas.getDate() - 30);
    let strTglBatas = getTanggalLokal(tglBatas);

    itemTerpilihRiwayat.forEach(idTarget => {
        let trx = cashierHistory.find(t => t.id === idTarget);
        if (!trx) return;

        // ATURAN BESI 1: Piutang & Pelunasan DITOLAK MUTLAK
        if (trx.metode === 'Debt' || trx.isPelunasan) {
            idDilindungi.push(idTarget);
        }
        // ATURAN BESI 2: Umur di bawah 30 Hari DITOLAK (Demi Laporan Bulanan)
        else if (trx.tanggal > strTglBatas) {
            idTerlaluBaru.push(idTarget);
        }
        // LOLOS SENSOR -> Siap Dihapus dan Diakumulasi uangnya
        else {
            idHangus.push(idTarget);
        }
    });

    // 2. CEK BLOKIR TOTAL
    if (idHangus.length === 0) {
        if (idTerlaluBaru.length > 0) {
            return alert(`🛡️ AKSES DITOLAK!\n\nTransaksi yang dipilih masih berumur di bawah 30 hari.\nSistem menguncinya agar Laporan Bulanan Anda tidak cacat/rusak.Gunakan fungsi ini hanya untuk membersihkan arsip struk lama.`);
        }
        return alert(`🛡️ AKSES DITOLAK!\n\nSeluruh transaksi yang dipilih adalah data Kasbon/Pelunasan. Sistem melindunginya secara mutlak.`);
    }

    // 3. PESAN KONFIRMASI CERDAS
    let pesanConfirm = `Pembersihan Arsip: ${idHangus.length} struk lama akan dihapus permanen.\n\nSistem akan merangkum uangnya menjadi "Saldo Awal" agar Laci Kasir tetap balance. Lanjutkan?`;

    if (idDilindungi.length > 0 || idTerlaluBaru.length > 0) {
        pesanConfirm = `Dari ${itemTerpilihRiwayat.length} pilihan, ada:\n- ${idDilindungi.length} data Piutang dilindungi.\n- ${idTerlaluBaru.length} data terlalu baru (<30 hari).\n\nLanjutkan menghapus dan merangkum ${idHangus.length} arsip lama yang lolos sensor?`;
    }

    tampilkanConfirmMobile(pesanConfirm, function() {

        // 4. MESIN AKUMULASI (Mencegah Saldo Laci Minus)
        let totalTunaiHangus = 0;
        let totalQRISHangus = 0;
        let totalLabaHangusTunai = 0;
        let totalLabaHangusQRIS = 0;

        idHangus.forEach(id => {
            let t = cashierHistory.find(x => x.id === id);
            if (t.metode === 'Tunai') { totalTunaiHangus += (t.total || 0); totalLabaHangusTunai += (t.laba || 0); }
            else if (t.metode === 'QRIS') { totalQRISHangus += (t.total || 0); totalLabaHangusQRIS += (t.laba || 0); }
        });

        // Buang riwayat yang hangus dari memori
        cashierHistory = cashierHistory.filter(t => !idHangus.includes(t.id));

        // Suntikkan Kapsul Akumulasi agar Saldo Laci & Bank tetap utuh
        // [PERBAIKAN AREA 4] Gunakan ID dari tahun 2000 agar tidak terhisap ke Shift Omzet Hari Ini!
        const idUnik = new Date('2000-01-01T00:00:00').getTime();
        if (totalTunaiHangus > 0) {
            cashierHistory.push({
                id: idUnik + 1, tanggal: '2000-01-01', waktu: '00:00',
                obat: '📦 AKUMULASI ARSIP LAMA (TUNAI)',     kasir: 'Sistem Cleaner', item: 0, total: totalTunaiHangus, metode: 'Tunai', laba: totalLabaHangusTunai, isPelunasan: false
            });
        }
        if (totalQRISHangus > 0) {
            cashierHistory.push({
                id: idUnik + 2, tanggal: '2000-01-01', waktu: '00:00',
                obat: '📦 AKUMULASI ARSIP LAMA (QRIS)',
                kasir: 'Sistem Cleaner', item: 0, total: totalQRISHangus, metode: 'QRIS', laba: totalLabaHangusQRIS, isPelunasan: false
            });
        }

        saveApotekDB('apotek_cashierHistory', cashierHistory);

        batalSeleksiRiwayat();
        renderBerandaMobile();
        if(!document.getElementById('layar-piutang').classList.contains('hidden')) renderPiutangMobile();

        triggerHaptic([100,50,100]);

        // 5. LAPORAN HASIL AKHIR
        alert(`✅ Pembersihan Selesai.\n\n${idHangus.length} Arsip lama dihapus dan diubah menjadi rangkuman Saldo Awal. Uang di Laci dan Bank dipastikan 100% aman.`);
    });
}


function prosesBintangMasalRiwayat() {
    if(itemTerpilihRiwayat.length === 0) return;
    cashierHistory.forEach(t => { if(itemTerpilihRiwayat.includes(t.id)) t.isBintang = !t.isBintang; });
    saveApotekDB('apotek_cashierHistory', cashierHistory);
    batalSeleksiRiwayat();
}

function prosesArsipMasalRiwayat() {
    if(itemTerpilihRiwayat.length === 0) return;
    let isKeArsip = riwayatTabAktifMobile !== 'arsip';
    cashierHistory.forEach(t => { if(itemTerpilihRiwayat.includes(t.id)) t.isArsip = isKeArsip; });
    saveApotekDB('apotek_cashierHistory', cashierHistory);
    batalSeleksiRiwayat();
    triggerHaptic([100, 50, 100]);
}

function renderRiwayatMobile() {
    const wadah = document.getElementById('daftarRiwayatMobile');

    let dataTampil = cashierHistory.filter(t => t.tanggal >= riwayatTglAwal && t.tanggal <= riwayatTglAkhir);
    if(riwayatTabAktifMobile === 'semua') dataTampil = dataTampil.filter(t => !t.isArsip);
    else if(riwayatTabAktifMobile === 'bintang') dataTampil = dataTampil.filter(t => t.isBintang && !t.isArsip);
    else if(riwayatTabAktifMobile === 'arsip') dataTampil = dataTampil.filter(t => t.isArsip);

    if (dataTampil.length === 0) {
        let pesanKosong = riwayatTabAktifMobile === 'arsip' ? 'Gudang Arsip Kosong.' : (riwayatTabAktifMobile === 'bintang' ? 'Belum ada struk ditandai bintang.' : 'Belum ada transaksi di rentang waktu ini.');
        wadah.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm mt-4"><i class="fa-solid fa-file-invoice text-4xl text-slate-300 mb-3 block"></i><p class="font-bold text-slate-600">${pesanKosong}</p></div>`;
        return;
    }

    if(modeSeleksiRiwayatAktif) {
        document.getElementById('teksJumlahSeleksi').textContent = itemTerpilihRiwayat.length + " Dipilih";
    }

    // --- SMART LIMIT (LOAD MORE LOGIC) ---
    let isPencarianSatuHari = (riwayatTglAwal === riwayatTglAkhir);
    let hasMore = false;
    let totalDataAsli = dataTampil.length;

    if (!isPencarianSatuHari && dataTampil.length > batasTampilRiwayat) {
        hasMore = true;
        dataTampil = dataTampil.slice(0, batasTampilRiwayat);
    }

    // [PENYEMPURNAAN 2] ILUSI VISUAL GROUPING BERDASAR WAKTU & NAMA
    let grupRiwayat = {};
    dataTampil.forEach(t => {
        // Jangan render kuitansi anak borongan, biar riwayat tetap bersih
        if (t.isBorongan) return;

        // [LOGIKA BARU] Tunai/QRIS dipisah mutlak pakai ID. Kasbon disatukan pakai Nama+Waktu.
        let key = t.isPelunasan ? `PELUNASAN_${t.id}` : (t.metode === 'Debt' ? `DEBT_${t.tanggal}_${t.waktu}_${t.pelanggan}` : `TRX_${t.id}`);
                                            if (!grupRiwayat[key]) {
                grupRiwayat[key] = {
                    idGabungan: t.id, tanggal: t.tanggal, waktu: t.waktu, metode: t.metode, pelanggan: t.pelanggan, kasir: t.kasir,
                    isPelunasan: t.isPelunasan, isBintang: t.isBintang, statusLunas: t.statusLunas,
                    total: 0, item: 0, rincian: [], rawIds: [], metodeBayar: t.metodeBayar
                };
            }

        grupRiwayat[key].total += (t.total || 0);
        grupRiwayat[key].item += (t.item || 1);
        grupRiwayat[key].rawIds.push(t.id);

        if (t.isPelunasan) {
            grupRiwayat[key].obat = t.obat;
        } else if(t.detailKeranjang && t.detailKeranjang.length > 0) {
            t.detailKeranjang.forEach(k => {


                // MINTA ASISTEN CEK BUKU CATATAN
                let historiCicilan = cashierHistory.filter(p => p.isPelunasan && p.idTerkait == t.id && !p.isIndukBorongan && p.obat.includes(k.nama.replace(/ \([^)]*\)/, '')));
                let qtyTertebus = historiCicilan.reduce((sum, p) => sum + (p.item || 0), 0);
                let nominalTertebus = historiCicilan.reduce((sum, p) => sum + (p.total || 0), 0);

                let qtySisa = k.qty - qtyTertebus;

                let infoFormat = formatNamaItemMaster(k.dnaInduk, k.nama, k.varian, k.kategori, 'text-[10px] flex-1');
                if (t.statusLunas || qtySisa <= 0) {
                    // LUNAS TOTAL (Garis Coret)
                    let nominalItem = (k.jual * k.qty).toLocaleString('id-ID');
                    grupRiwayat[key].rincian.push(`
                    <div class="flex flex-col w-full mb-2">
                        <div class="grid grid-cols-[1fr_30px_20px_max-content] items-center w-full opacity-60 line-through mb-1">
                            <div class="text-[10px] text-slate-600 font-semibold leading-tight pr-2">
                                <div class="truncate">- ${infoFormat.namaUtama} ${infoFormat.varianHtml}</div>
                                <div class="ml-2 mt-0.5">${infoFormat.kategoriHtml}</div>
                            </div>
                            <div class="text-[10px] font-black text-slate-500 text-center">x${k.qty}</div>
                            <div class="text-[11px] font-black text-slate-800 text-left">Rp</div>
                            <div class="text-[11px] font-black text-slate-800 text-right">${nominalItem}</div>
                        </div>
                        <div class="text-[9px] font-bold text-emerald-600 mt-0.5 ml-2 flex items-center gap-1">
                            <i class="fa-solid fa-check-circle"></i> Lunas Total: Rp ${nominalItem}
                        </div>
                    </div>`);
                } else if (qtyTertebus > 0) {
                    // LUNAS SEBAGIAN (Animasi Kuning Amber)
                    let nominalSisaStr = ((t.total || k.jual * k.qty) - nominalTertebus).toLocaleString('id-ID');
                    let nominalTebusStr = nominalTertebus.toLocaleString('id-ID');
                    grupRiwayat[key].rincian.push(`
                    <div class="flex flex-col w-full mb-2 bg-amber-50/30 p-2 rounded-xl border border-amber-200">
                        <div class="grid grid-cols-[1fr_30px_20px_max-content] items-center w-full">
                            <div class="text-[10.5px] text-slate-800 font-bold leading-tight pr-2">
                                <div class="truncate">- ${infoFormat.namaUtama} ${infoFormat.varianHtml}</div>
                                <div class="ml-2 mt-0.5">${infoFormat.kategoriHtml}</div>
                            </div>
                            <div class="text-[10.5px] font-black text-slate-700 text-center">x${qtySisa}</div>
                            <div class="text-[11px] font-black text-slate-800 text-left">Rp</div>
                            <div class="text-[11px] font-black text-slate-800 text-right">${nominalSisaStr}</div>
                        </div>
                        <div class="text-[9px] font-bold text-amber-600 mt-1.5 ml-2 flex items-center gap-1">
                            <i class="fa-solid fa-clock"></i> Telah ditebus ${qtyTertebus} stok: Rp ${nominalTebusStr}
                        </div>
                    </div>`);
                } else {
                    // NORMAL / BELUM DISENTUH
                    let nominalItem = (k.jual * k.qty).toLocaleString('id-ID');
                    grupRiwayat[key].rincian.push(`
                    <div class="grid grid-cols-[1fr_30px_20px_max-content] items-center w-full mb-1.5">
                        <div class="text-[10px] text-slate-600 font-semibold leading-tight pr-2">
                            <div class="truncate">- ${infoFormat.namaUtama} ${infoFormat.varianHtml}</div>
                            <div class="ml-2 mt-0.5">${infoFormat.kategoriHtml}</div>
                        </div>
                        <div class="text-[10px] font-black text-slate-500 text-center">x${k.qty}</div>
                        <div class="text-[11px] font-black text-slate-800 text-left">Rp</div>
                        <div class="text-[11px] font-black text-slate-800 text-right">${nominalItem}</div>
                    </div>`);
                }
            });
        } else {
            let nominalTotal = (t.total).toLocaleString('id-ID');
            let infoFormat = formatNamaItemMaster(null, t.obat, '', '', 'text-[10px] flex-1');
            grupRiwayat[key].rincian.push(`<div class="grid grid-cols-[1fr_30px_20px_max-content] items-center w-full mb-1.5"><div class="text-[10px] text-slate-600 font-semibold leading-tight pr-2"><div class="truncate">- ${infoFormat.namaUtama} ${infoFormat.varianHtml}</div><div class="ml-2 mt-0.5">${infoFormat.kategoriHtml}</div></div><div class="text-[10px] font-black text-slate-500 text-center">x${t.item || 1}</div><div class="text-[11px] font-black text-slate-800 text-left">Rp</div><div class="text-[11px] font-black text-slate-800 text-right">${nominalTotal}</div></div>`);
        }
    });

        wadah.innerHTML = Object.values(grupRiwayat).map(g => {
        let badgeWarna = g.metode === 'Tunai' ? 'bg-emerald-100 text-emerald-700' : (g.metode === 'QRIS' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700');
        let teksStatus = g.metode; let isSelected = g.rawIds.some(id => itemTerpilihRiwayat.includes(id));
        let bgCard = isSelected ? 'bg-blue-50 border-blue-400 shadow-md transform scale-[0.98]' : 'bg-white border-slate-200 shadow-sm';

        if(g.metode === 'Debt') {
            // [LOGIKA BARU] Cek Silang: Pastikan SEMUA item di dalam kotak ini benar-benar lunas
            let semuaLunas = g.rawIds.every(id => {
                let itemAsli = cashierHistory.find(x => x.id === id);
                return itemAsli ? itemAsli.statusLunas : true;
            });

            if(semuaLunas) {
                teksStatus = 'Lunas / Ditutup'; badgeWarna = 'bg-emerald-100 text-emerald-700';
            } else {
                let historiGrup = cashierHistory.filter(p => p.isPelunasan && p.idTerkait && g.rawIds.includes(parseInt(p.idTerkait)) && !p.isIndukBorongan);
                if(historiGrup.length > 0) {
                    teksStatus = 'Lunas Sebagian';
                    badgeWarna = 'bg-amber-100 text-amber-700';
                    if(!isSelected) bgCard = 'bg-white border-amber-300 shadow-sm border-2';
                }
            }
        }

        if(g.isPelunasan) teksStatus = 'Uang Masuk (Kasbon)';

        let starIcon = g.isBintang ? `<i class="fa-solid fa-star text-amber-400 text-xs drop-shadow-sm ml-1.5 align-middle -mt-0.5"></i>` : '';
        let judulObat = g.isPelunasan ? g.obat : `<i class="fa-solid fa-box-open mr-1 text-slate-400"></i> ${g.rincian.length} Item (${g.item} Stok)`;
        let teksKonsumen = (g.pelanggan && g.pelanggan !== 'UMUM' && !g.isPelunasan) ? `<p class="text-[10px] text-corporate-600 font-black mt-0.5 uppercase">Konsumen: ${g.pelanggan}</p>` : '';

        let areaRincian = '';
        if (!g.isPelunasan && g.rincian.length > 0) {
            areaRincian = `<div class="mt-3 mb-2 pt-2 border-t border-dashed border-slate-200"><p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Rincian Faktur:</p><div class="w-full">${g.rincian.join('')}</div></div>`;
        }

        let tombolPortal = (g.metode === 'Debt' && g.pelanggan) ? `<button onclick="event.stopPropagation(); lompatKeBukuPiutang('${g.pelanggan}')" class="mt-2 text-[9px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-1.5 w-max active:scale-95"><i class="fa-solid fa-book-open"></i> Lihat Buku Piutang</button>` : '';

        // [PERISAI LOGIKA] Sembunyikan tombol batal jika utang (Debt) sudah dicicil atau lunas
        let isUtangTercicil = g.metode === 'Debt' && cashierHistory.some(p => {
            if (!p.isPelunasan || !p.idTerkait) return false;
            let arrTerkait = p.idTerkait.toString().split(',').map(Number);
            return arrTerkait.some(id => g.rawIds.includes(id));
        });
        let isUtangLunas = g.metode === 'Debt' && g.rawIds.every(id => { let k = cashierHistory.find(x => x.id === id); return k ? k.statusLunas : true; });

                        // --- INJEKSI UI PELUNASAN ELEGAN ---
        let badgePelunasanHtml = '';
        if (g.isPelunasan) {
            let pName = (g.pelanggan && g.pelanggan !== 'UMUM') ? g.pelanggan : 'TIDAK DIKETAHUI';
            let qtyTebus = g.item || 1;
            let metode = (g.metodeBayar || 'TUNAI').toUpperCase();

            // Logika Ikon & Warna Dinamis
            let iconMetode = metode === 'QRIS' ? '<i class="fa-solid fa-qrcode"></i>' : '<i class="fa-solid fa-money-bill-wave"></i>';
            let warnaMetode = metode === 'QRIS' ? 'bg-blue-50/80 text-blue-700 border-blue-200/60' : 'bg-emerald-50/80 text-emerald-700 border-emerald-200/60';

            badgePelunasanHtml = `
            <div class="flex items-center flex-wrap gap-1.5 mt-2.5 z-10">
                <span class="bg-slate-50 text-slate-600 px-2 py-0.5 rounded text-[9.5px] font-bold border border-slate-200 uppercase tracking-widest shadow-sm">👤 ${pName}</span>
                <span class="bg-slate-50 text-slate-600 px-2 py-0.5 rounded text-[9.5px] font-bold border border-slate-200 uppercase tracking-widest shadow-sm">📦 x${qtyTebus} STOK</span>
                <span class="${warnaMetode} px-2 py-0.5 rounded text-[9.5px] font-bold border uppercase tracking-widest shadow-sm">${iconMetode} ${metode}</span>
            </div>`;
        }
        // -----------------------------------


                // [PERISAI WAKTU & SHIFT] Cek apakah transaksi sudah lewat 24 Jam atau sudah Tutup Buku
        let idTrx = g.rawIds[0];
        let isLewatTutupBuku = siklusAktif.waktuStart && (idTrx < siklusAktif.waktuStart);
        let isLewat24Jam = (Date.now() - idTrx) > (24 * 60 * 60 * 1000);
        let isTerkunciWaktu = isLewatTutupBuku || isLewat24Jam;

        let arrayIdsStr = `[${g.rawIds.join(',')}]`;
        let btnBatalHtml = (isUtangTercicil || isUtangLunas || isTerkunciWaktu) ? '' : `<button onclick="event.stopPropagation(); prosesBatalTransaksiMobile(${arrayIdsStr})" class="text-[10px] text-red-500 hover:bg-red-50 font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 border border-red-100 shadow-sm active:scale-95"><i class="fa-solid fa-rotate-left"></i> Batal</button>`;
        let tombolAksi = modeSeleksiRiwayatAktif ? '' : `
            <div class="flex gap-2 relative z-10 mt-3 justify-end border-t border-slate-100 pt-3">
                ${btnBatalHtml}
                <button onclick="event.stopPropagation(); prosesCetakStrukMobile(${g.rawIds[0]}, this)" class="text-[10px] text-blue-600 hover:bg-blue-50 font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 border border-blue-100 shadow-sm active:scale-95"><i class="fa-solid fa-print"></i> Cetak</button>
            </div>`;

                       return `<div id="kartu-riwayat-${g.waktu.replace(/[:\.]/g,'')}-${g.pelanggan ? g.pelanggan.toUpperCase().replace(/\s/g,'') : 'UMUM'}" onpointerdown="mulaiTekanRiwayat(${g.rawIds[0]})" onpointerup="lepasTekanRiwayat()" onpointerleave="lepasTekanRiwayat()" onclick="klikItemRiwayat(${g.rawIds[0]})" class="${bgCard} select-none rounded-2xl p-4 flex flex-col transition-all cursor-pointer relative group"><div class="flex justify-between items-start pointer-events-none"><div class="pr-2 flex-1"><p class="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mb-1"><i class="fa-regular fa-calendar-days"></i> ${g.tanggal} • ${g.waktu}</p><h3 class="font-bold text-slate-800 text-sm leading-tight inline-block mb-1">${judulObat} ${starIcon}</h3><p class="text-[10px] text-slate-500 font-medium">Oleh: ${g.kasir}</p>${badgePelunasanHtml}${teksKonsumen}</div><div class="text-right shrink-0"><p class="font-black ${isSelected ? 'text-blue-700' : 'text-corporate-700'} text-base">${rupiah(g.total)}</p><span class="inline-block mt-1.5 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider ${badgeWarna}">${teksStatus}</span></div></div>${areaRincian}${tombolPortal}${tombolAksi}</div>`;
  }).join('');

    // --- INJEKSI TOMBOL LOAD MORE DI BAWAH DAFTAR ---
    if (hasMore) {
        wadah.innerHTML += `
        <div class="py-6 flex flex-col items-center justify-center border-t border-slate-200 mt-2 border-dashed">
            <p class="text-[10px] font-bold text-slate-400 mb-3">Menampilkan ${batasTampilRiwayat} dari ${totalDataAsli} transaksi</p>
            <button onclick="muatLebihBanyakRiwayat()" class="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-black text-xs px-6 py-3 rounded-xl shadow-sm transition-transform active:scale-95 flex items-center gap-2">
                <i class="fa-solid fa-angles-down text-corporate-500"></i> Tampilkan Lebih Banyak
            </button>
        </div>`;
    }
}

// ==========================================
// 6. MESIN RENDER: PIUTANG & LAPORAN
// ==========================================
function renderPiutangMobile() {
    const wadah = document.getElementById('daftarPiutangMobile');
    const searchInput = document.getElementById('cariPiutangMobile');
    const filterTeks = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let totalPiutang = 0;
    // [MODIFIKASI] Cegah data yang sudah di-Soft Delete (Arsip Senyap) agar tidak muncul di layar
    const dataDebtMentah = cashierHistory.filter(t => (t.metode === 'Debt' || t.isPelunasan) && !t.isSembunyiPiutang);
    let agregasiPelanggan = {};

    dataDebtMentah.forEach(t => {
        if (!t.pelanggan) return;
        let namaNormal = t.pelanggan.trim().toUpperCase();

        if(!agregasiPelanggan[namaNormal]) {
            agregasiPelanggan[namaNormal] = {
                nama: namaNormal, wa: t.wa, totalAktif: 0,
                tunggakanAktif: {}, riwayatLunas: [], idsAktif: []
            };
        }

        if (t.isPelunasan) {
            agregasiPelanggan[namaNormal].riwayatLunas.push(t);
        } else if (!t.statusLunas) {
            // [LOGIKA ASISTEN] Hitung sisa tagihan dari riwayat kuitansi tanpa merusak data asli
            let historiCicilan = cashierHistory.filter(p => p.isPelunasan && p.idTerkait == t.id && !p.isIndukBorongan);
            let nominalTertebus = historiCicilan.reduce((sum, p) => sum + (p.total || 0), 0);
            let sisaTagihan = (t.total || 0) - nominalTertebus;

            if (sisaTagihan > 0) {
                agregasiPelanggan[namaNormal].totalAktif += sisaTagihan;
                agregasiPelanggan[namaNormal].idsAktif.push(t.id);
                totalPiutang += sisaTagihan;

                let keyWaktu = t.tanggal + '_' + t.waktu;
                if(!agregasiPelanggan[namaNormal].tunggakanAktif[keyWaktu]) {
                    agregasiPelanggan[namaNormal].tunggakanAktif[keyWaktu] = {
                        tanggal: t.tanggal, waktu: t.waktu, totalWaktuIni: 0, items: []
                    };
                }
                agregasiPelanggan[namaNormal].tunggakanAktif[keyWaktu].totalWaktuIni += sisaTagihan;

                // Kita tanamkan sisa tagihan ke object agar gampang digambar nanti
                let itemCopy = JSON.parse(JSON.stringify(t));
                itemCopy.sisaTagihan = sisaTagihan;

                let qtyTertebus = historiCicilan.reduce((sum, p) => sum + (p.item || 0), 0);
                itemCopy.qtySisa = (t.item || 1) - qtyTertebus;

                agregasiPelanggan[namaNormal].tunggakanAktif[keyWaktu].items.push(itemCopy);
            }
        }
    });

    document.getElementById('headerTotalPiutangMobile').textContent = rupiah(totalPiutang);

    let listTampil = Object.values(agregasiPelanggan)
        .filter(p => (p.totalAktif > 0 || p.riwayatLunas.length > 0) && (filterTeks === '' || p.nama.toLowerCase().includes(filterTeks)));

    if(listTampil.length === 0) {
        if (filterTeks === '') {
            wadah.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm mt-4"><i class="fa-solid fa-face-smile-beam text-5xl text-emerald-400 mb-3 block"></i><p class="font-bold text-slate-600">Bagus Sekali!</p><p class="text-xs text-slate-500 mt-1">Tidak ada pelanggan yang menunggak.</p></div>`;
        } else {
            wadah.innerHTML = `<div class="text-center p-6 text-slate-400 text-xs font-bold">Pencarian tidak ditemukan.</div>`;
        }
        return;
    }

    wadah.innerHTML = listTampil.map(p => {
        let zonaMerahHtml = Object.values(p.tunggakanAktif).map(grup => {
            let isMultiDalamSatuWaktu = grup.items.length > 1;

            let itemLines = grup.items.map(itemDb => {
                let namaLengkap = itemDb.obat;
                if (itemDb.detailKeranjang && itemDb.detailKeranjang.length > 0) {
                    let k = itemDb.detailKeranjang[0];
                    namaLengkap = k.nama;
                    if(k.varian) namaLengkap += ` ${k.varian}`;
                    if(k.kategori) namaLengkap += ` • ${k.kategori}`;
                }

                                let namaObatParam = namaLengkap.replace(/'/g, "\\'");

                // --- INJEKSI UI/UX: LOGIKA PEMBACAAN PRESISI & TRANSFORMASI VISUAL ---
                // 1. Perbaikan Bug Centang: Paksa ID menjadi Teks agar cocok 100%
                let itemTerpilih = seleksiPiutangEceran.find(x => x.id.toString() === itemDb.id.toString());
                let isChecked = itemTerpilih ? 'checked' : '';

                let checkboxHtml = `
                <div class="relative flex items-center justify-center pt-0.5 z-20">
                    <input type="checkbox" ${isChecked} onchange="togglePilihPiutangAman('${itemDb.id}', '${namaObatParam}', ${itemDb.sisaTagihan}, ${itemDb.qtySisa}, '${p.nama}', this)" class="w-4 h-4 text-emerald-500 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer shadow-sm">
                </div>`;

                // 2. Transformasi Desain: Berubah warna dan teks saat masuk keranjang
                let bgBaris = itemTerpilih ? 'bg-emerald-50 border border-emerald-200 shadow-inner' : 'hover:bg-slate-100 border border-transparent';

                let teksTebus = itemTerpilih ?
                    `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-black ml-1.5 shadow-sm border border-emerald-200">Ditebus x${itemTerpilih.qtyTebus} dari ${itemDb.qtySisa}</span>`
                    : ` <span class="text-slate-500">(x${itemDb.qtySisa})</span>`;

                let nominalTampil = itemTerpilih ? itemTerpilih.hargaTebus : itemDb.sisaTagihan;
                let warnaNominal = itemTerpilih ? 'text-emerald-700 font-black' : 'text-slate-800 font-black';

                return `
                <div class="flex items-start w-full mb-1.5 group/item p-1.5 -mx-1.5 rounded-lg transition-all cursor-pointer ${bgBaris}">
                    <div class="flex items-start gap-2 shrink-0">${checkboxHtml}</div>
                    <div class="text-[10.5px] text-slate-700 font-semibold leading-tight pt-0.5 flex-1 pl-1">${namaLengkap}${teksTebus}</div>
                    <div class="w-[80px] shrink-0 flex items-start pt-0.5 text-[11px] ${warnaNominal} pl-1">
                        <span class="w-[20px]">Rp</span><span class="flex-1 text-right">${(nominalTampil).toLocaleString('id-ID')}</span>
                    </div>
                </div>`;
            }).join('');

            let totalWaktuHtml = isMultiDalamSatuWaktu ? `<span class="font-black text-red-600 text-xs bg-red-50 px-2 py-1 rounded-md border border-red-100 shadow-inner">${rupiah(grup.totalWaktuIni)}</span>` : '';

            return `
            <div class="bg-white border border-red-200 rounded-xl p-3.5 mb-3 shadow-sm relative overflow-hidden">
                <div class="absolute left-0 top-0 bottom-0 w-1 bg-red-400"></div>
                <div class="flex justify-between items-center border-b border-slate-100 pb-2.5 mb-2.5 pl-1.5">
                    <span class="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><i class="fa-regular fa-calendar-days text-slate-400"></i> ${grup.tanggal} (${grup.waktu})</span>
                    ${totalWaktuHtml}
                </div>
                <div class="pl-1.5 mb-3">${itemLines}</div>
                <div class="pl-1.5">
                    <button onclick="lompatKeRiwayat('${grup.tanggal}', '${grup.waktu}', '${p.nama}')" class="text-[9px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-1.5 w-max active:scale-95 shadow-sm">
                        <i class="fa-solid fa-clock-rotate-left"></i> Cek Jejak Asli
                    </button>
                </div>
            </div>`;
        }).join('');

        let zonaHijauHtml = '';
        if (p.riwayatLunas.length > 0) {
            p.riwayatLunas.sort((a, b) => b.id - a.id);
            let limitTampil = p.riwayatLunas;

                        let lunasLines = limitTampil.map(lunasDb => {
                let waktuAsal = '-';
                let btnJejakHtml = ''; // Siapkan variabel untuk tombol Cek Jejak Asli

                if(lunasDb.idTerkait) {
                    let utangAsal = cashierHistory.find(x => x.id.toString() === lunasDb.idTerkait.toString());
                    if(utangAsal) {
                        waktuAsal = `${utangAsal.tanggal} (${utangAsal.waktu})`;
                        // Tombol Cek Jejak Asli yang mengarah ke nota utang aslinya (Hutang Asal)
                        btnJejakHtml = `
                        <div class="mt-2.5">
                            <button onclick="lompatKeRiwayat('${utangAsal.tanggal}', '${utangAsal.waktu}', '${p.nama}')" class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors flex items-center gap-1.5 w-max active:scale-95 shadow-sm">
                                <i class="fa-solid fa-clock-rotate-left"></i> Cek Jejak Asli
                            </button>
                        </div>`;
                    }
                }

                let namaObatBersih = lunasDb.obat.replace('PELUNASAN GABUNGAN: ','').replace('Pelunasan Eceran: ','');
                let qtyTebus = lunasDb.item || 1; // Menangkap jumlah stok yang dilunasi

                return `
                <div class="bg-white border border-emerald-200 rounded-xl p-3 mb-2 shadow-sm relative overflow-hidden">
                    <div class="absolute left-0 top-0 bottom-0 w-1 bg-emerald-400"></div>
                    <div class="flex justify-between items-center mb-2 pl-1.5 border-b border-emerald-50 pb-2">
                        <span class="text-[10px] font-black text-emerald-600 flex items-center gap-1.5"><i class="fa-solid fa-check-circle"></i> BUKTI PELUNASAN</span>
                        <span class="font-black text-emerald-700 text-[11px] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">+ Rp <span class="inline-block w-[45px] text-right">${(lunasDb.total).toLocaleString('id-ID')}</span></span>
                    </div>
                    <div class="pl-1.5 space-y-0.5 mt-1">
                        <p class="text-[9px] text-slate-600 font-bold"><span class="inline-block w-16 text-slate-400">Waktu Bayar</span>: ${lunasDb.tanggal} (${lunasDb.waktu})</p>
                        <p class="text-[9px] text-slate-600 font-bold"><span class="inline-block w-16 text-slate-400">Hutang Asal</span>: ${waktuAsal}</p>
                        <p class="text-[9px] text-slate-600 font-bold"><span class="inline-block w-16 text-slate-400">Metode</span>: <span class="text-blue-600 uppercase font-black">${lunasDb.metodeBayar || lunasDb.metode}</span></p>
                        <div class="border-t border-dashed border-emerald-100 my-1.5"></div>
                        <p class="text-[9px] text-slate-500 font-medium italic leading-tight">Menebus: <span class="text-slate-700 font-bold">${namaObatBersih} <span class="text-emerald-600 font-black">(x${qtyTebus})</span></span></p>
                        ${btnJejakHtml}
                    </div>
                </div>`;
            }).join('');


            zonaHijauHtml = `<div class="mt-5 pt-4 border-t border-slate-200"><div class="flex items-center gap-2 mb-3"><div class="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><i class="fa-solid fa-clock-rotate-left text-[10px]"></i></div><p class="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Riwayat Pelunasan Abadi</p></div>${lunasLines}</div>`;
        }

        let totalStokGantung = 0;
        p.idsAktif.forEach(id => {
            let t = cashierHistory.find(x => x.id === id);
            if(t) {
                let historiCicilan = cashierHistory.filter(o => o.isPelunasan && o.idTerkait == t.id && !o.isIndukBorongan);
                let qtyTertebus = historiCicilan.reduce((sum, o) => sum + (o.item || 0), 0);
                totalStokGantung += ((t.item || 1) - qtyTertebus);
            }
        });

        if (p.totalAktif === 0) {
            zonaMerahHtml = `<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 text-center shadow-sm"><p class="text-[11px] font-black text-emerald-600 uppercase tracking-widest mb-0.5"><i class="fa-solid fa-circle-check text-lg mb-1 block"></i> STATUS BERSIH</p><p class="text-[9px] font-bold text-emerald-800">Tidak ada tunggakan aktif.</p></div>`;
        }

                let keranjangOrangIni = seleksiPiutangEceran.filter(x => x.namaPelanggan === p.nama);

        // LOGIKA BARU: Wajib Centang (Tombol Default Mati/Abu-abu)
        let teksTombolLunas = 'PILIH ITEM DULU';
        let btnColorClass = 'from-slate-400 to-slate-500 border-slate-300 opacity-70';
        let totalTagihanTombol = 0;
        let funcTombol = `alert('Silakan centang item utang di atas yang ingin dilunasi terlebih dahulu.')`;

        // Jika sudah ada yang dicentang, tombol hidup (Hijau)
        if(keranjangOrangIni.length > 0) {
            totalTagihanTombol = keranjangOrangIni.reduce((sum, i) => sum + i.hargaTebus, 0);
            teksTombolLunas = 'LUNASI TERPILIH';
            btnColorClass = 'from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 border-emerald-400 shadow-[0_4px_15px_rgba(16,185,129,0.3)]';
            funcTombol = `bukaModalPelunasanMobile('CERDAS', '${p.nama}', ${totalTagihanTombol})`;
        }

        let tampilanTombolBawah = p.totalAktif > 0 ? `<button onclick="${funcTombol}" class="w-full bg-gradient-to-r ${btnColorClass} text-white font-black py-4 rounded-xl transition-transform active:scale-95 flex items-center justify-center gap-2 text-[13px] uppercase tracking-wider border"><i class="fa-solid fa-hand-holding-dollar text-lg"></i> ${teksTombolLunas} ${keranjangOrangIni.length > 0 ? '(' + rupiah(totalTagihanTombol) + ')' : ''}</button>` : '';

                return `
        <div id="kartu-piutang-${p.nama.replace(/\s/g,'')}" onpointerdown="mulaiTekanPiutang('${p.nama}', ${p.totalAktif})" onpointerup="lepasTekanPiutang()" onpointerleave="lepasTekanPiutang()" class="bg-slate-50 border-2 border-slate-200 rounded-[1.5rem] p-5 shadow-md relative transition-all duration-500 overflow-hidden cursor-pointer select-none">
            <div class="absolute top-0 right-0 w-24 h-24 bg-white rounded-bl-full -z-0 opacity-60 pointer-events-none"></div>
   <div class="flex justify-between items-start mb-4 relative z-10">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xl shadow-inner border border-slate-300"><i class="fa-solid fa-user"></i></div>
                   <div>
                        <h4 class="font-black text-slate-800 text-lg uppercase tracking-tight leading-none mb-1">${p.nama}</h4>
                        <p class="text-[10px] font-bold text-slate-500 bg-slate-200/50 px-2 py-0.5 rounded-md inline-block">${p.idsAktif.length} Item (${totalStokGantung} Stok) Menggantung</p>
                    </div>
                </div>
                <div class="flex gap-2 shrink-0">
                    <button onclick="tagihWAMultiPiutang('${p.nama}')" class="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-200 shadow-sm active:scale-95 transition-transform" title="Kirim Tagihan WA"><i class="fa-brands fa-whatsapp text-xl"></i></button>
                    <button onclick="bukaKasirKhususPiutang('${p.nama}', '${p.wa || ''}')" class="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center border border-blue-200 shadow-sm active:scale-95 transition-transform" title="Tambah Utang Baru"><i class="fa-solid fa-cart-plus text-lg"></i></button>
                </div>
            </div>
            <div class="mb-2 relative z-10">
                <div class="flex items-center gap-2 mb-3">
                    <div class="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center text-red-600"><i class="fa-solid fa-triangle-exclamation text-[10px] animate-pulse"></i></div>
                    <p class="text-[10px] font-black text-red-600 uppercase tracking-widest">Tunggakan Aktif</p>
                </div>
                <div class="max-h-[300px] overflow-y-auto hide-scrollbar pb-1">${zonaMerahHtml}</div>
            </div>
            <div class="relative z-10">${zonaHijauHtml}</div>
            <div class="bg-white border border-slate-200 rounded-xl p-4 mt-4 relative z-10 shadow-sm">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-black text-slate-500 uppercase tracking-wider">Total Tunggakan</span>
                    <span class="text-2xl font-black text-red-600 tracking-tight drop-shadow-sm">${rupiah(p.totalAktif)}</span>
                </div>
                ${tampilanTombolBawah}
            </div>
        </div>`;
    }).join('');
}


// FUNGSI SHORTCUT PIUTANG -> KASIR
function bukaKasirKhususPiutang(nama, wa) {
    bukaLayar('beranda');
    setTimeout(() => {
        bukaModalKasirMobile();
        document.querySelector('input[value="Debt"]').checked = true;
        toggleFormKasbonMobile();
        document.getElementById('kasbonNamaMobile').value = nama;
        if(wa && wa !== 'undefined') document.getElementById('kasbonWaMobile').value = wa;
        showToast(`🛒 Shortcut: Mode Kasbon untuk ${nama} telah diaktifkan.`);
    }, 100);
}

// FUNGSI MESIN WAKTU -> RIWAYAT TANGGAL ASLI & PORTAL ANIMASI
function lompatKeRiwayat(tanggal, waktuJam, nama) {
    // 1. Perbaiki Kabel Filter: Paksa Mesin Membaca Tanggal Utang
    riwayatTglAwal = tanggal;
    riwayatTglAkhir = tanggal;

    // 2. Sinkronisasi Tampilan UI Filter Neumorphism
    let uiText = document.getElementById('teksFilterRiwayatUi');
    if (uiText) uiText.textContent = typeof formatTanggalPendek === 'function' ? formatTanggalPendek(tanggal) : tanggal;

    let inputAwal = document.getElementById('filterRiwayatTglAwal');
    let inputAkhir = document.getElementById('filterRiwayatTglAkhir');
    if(inputAwal) inputAwal.value = tanggal;
    if(inputAkhir) inputAkhir.value = tanggal;

    ubahTabRiwayat('semua');
    bukaLayar('riwayat');

    // Jika dipanggil tanpa waktu spesifik, cukup buka harinya saja
    if(!waktuJam || !nama) {
        setTimeout(() => showToast(`⏰ Melompat ke arsip tanggal ${tanggal}`), 300);
        return;
    }

    // Mesin Animasi Pencari Kotak Waktu (Presisi Tinggi)
    setTimeout(() => {
        // Membersihkan titik/titik dua pada jam, dan memaksa NAMA jadi UPPERCASE
        let idTarget = `kartu-riwayat-${waktuJam.replace(/[:\.]/g,'')}-${nama.toUpperCase().replace(/\s/g,'')}`;
        let kotakTujuan = document.getElementById(idTarget);

        if(kotakTujuan) {
            kotakTujuan.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Efek Sihir Nyala Kuning
            kotakTujuan.classList.add('bg-amber-100', 'border-amber-400', 'shadow-[0_0_20px_rgba(251,191,36,0.5)]');
            kotakTujuan.classList.remove('bg-white', 'border-slate-200');
            setTimeout(() => {
                kotakTujuan.classList.remove('bg-amber-100', 'border-amber-400', 'shadow-[0_0_20px_rgba(251,191,36,0.5)]');
                kotakTujuan.classList.add('bg-white', 'border-slate-200');
            }, 2500);
            showToast(`⏰ Tiba di riwayat ${waktuJam}`);
        } else {
            alert(`⚠️ JEJAK TIDAK DITEMUKAN\n\nStruk pada pukul ${waktuJam} atas nama ${nama} tidak ditemukan di layar Riwayat ini.`);
        }
    }, 400);
}

function lompatKeBukuPiutang(namaPelanggan) {
    bukaLayar('piutang');
    let searchInput = document.getElementById('cariPiutangMobile');
    if(searchInput) {
        searchInput.value = namaPelanggan;
        renderPiutangMobile(); // Force render filter

        // Animasi Pencari Kartu Piutang
        setTimeout(() => {
            let idTarget = `kartu-piutang-${namaPelanggan.replace(/\s/g,'')}`;
            let kotakTujuan = document.getElementById(idTarget);
            if(kotakTujuan) {
                kotakTujuan.scrollIntoView({ behavior: 'smooth', block: 'start' });
                kotakTujuan.classList.add('shadow-[0_0_25px_rgba(59,130,246,0.4)]', 'border-blue-400');
                setTimeout(() => {
                    kotakTujuan.classList.remove('shadow-[0_0_25px_rgba(59,130,246,0.4)]', 'border-blue-400');
                }, 2500);
            }
        }, 400);
    }
}

// ==========================================
// MESIN HAPUS PIUTANG (SINGLE TARGET - LONG PRESS)
// ==========================================
let timerTekanPiutang;

function mulaiTekanPiutang(namaPelanggan, totalAktif) {
    timerTekanPiutang = setTimeout(() => {
        triggerHaptic([50, 100]);
        validasiHapusPiutangLunas(namaPelanggan, totalAktif);
    }, 600); // Tahan selama 600 milidetik untuk memicu
}

function lepasTekanPiutang() {
    clearTimeout(timerTekanPiutang);
}

function validasiHapusPiutangLunas(namaPelanggan, totalAktif) {
    // 1. PENOLAKAN MUTLAK JIKA BELUM LUNAS TOTAL
    if (totalAktif > 0) {
        triggerHaptic([100, 50, 100, 50]); // Getar peringatan keras
        alert(`🛡️ AKSES DITOLAK!\n\nPelanggan ${namaPelanggan} masih memiliki tunggakan sebesar ${rupiah(totalAktif)}.\nFitur pembersihan arsip ini HANYA BERLAKU untuk piutang yang sudah Lunas Total.`);
        return;
    }

    // 2. EFEK VISUAL: Kartu menyala merah sebagai tanda target terkunci
    let idKartu = `kartu-piutang-${namaPelanggan.replace(/\s/g,'')}`;
    let kartu = document.getElementById(idKartu);
    if(kartu) {
        kartu.classList.remove('border-slate-200');
        kartu.classList.add('border-red-500', 'shadow-[0_0_25px_rgba(239,68,68,0.5)]', 'bg-red-50');
    }

    // 3. KONFIRMASI PEMUSNAHAN
        tampilkanConfirmMobile(`🗑️ ARSIPKAN PIUTANG LUNAS\n\nSembunyikan seluruh riwayat utang dan bukti bayar atas nama ${namaPelanggan} dari daftar ini?\n\n(Data tidak dihapus permanen agar Laporan Buku Besar tetap akurat).`, function() {

            // [MODIFIKASI] EKSEKUSI SOFT DELETE: Beri stempel gaib, jangan dibuang dari array
            cashierHistory.forEach(t => {
                let namaOrang = (t.pelanggan || '').trim().toUpperCase();
                if ((namaOrang === namaPelanggan) && (t.metode === 'Debt' || t.isPelunasan)) {
                    t.isSembunyiPiutang = true; // Stempel Arsip Senyap
                }
            });

            saveApotekDB('apotek_cashierHistory', cashierHistory);        renderPiutangMobile();
        triggerHaptic([100, 50, 100]);
        alert(`✅ Arsip piutang atas nama ${namaPelanggan} berhasil dibersihkan dari sistem.`);

    });

    // 4. BERSIHKAN EFEK VISUAL JIKA BATAL
    setTimeout(() => {
        if(kartu) {
            kartu.classList.add('border-slate-200');
            kartu.classList.remove('border-red-500', 'shadow-[0_0_25px_rgba(239,68,68,0.5)]', 'bg-red-50');
        }
    }, 2500);
}

// MESIN PEMBELAH SEL (CHECKBOX AMAN)
async function togglePilihPiutangAman(id, namaObat, totalHarga, qtyMax, namaPelanggan, element) {
    if(element.checked) {
        if(qtyMax > 1) {
            let inputQty = await customPrompt(`${namaPelanggan} berutang ${qtyMax} stok ${namaObat}.\nBerapa stok yang ingin ditebus sekarang?`, "1");
            let qtyTebus = parseInt(inputQty);
            if(isNaN(qtyTebus) || qtyTebus <= 0 || qtyTebus > qtyMax) {
                element.checked = false;
                return alert("⚠️ Jumlah tidak valid. Batal memilih.");
            }
            let hargaTebus = 0;
            if (qtyTebus === qtyMax) {
                hargaTebus = totalHarga;
            } else {
                let hargaPerBiji = totalHarga / qtyMax;
                hargaTebus = Math.round(hargaPerBiji * qtyTebus);
            }
            seleksiPiutangEceran.push({ id, namaObat, totalAsli: totalHarga, hargaTebus: hargaTebus, qtyTebus: qtyTebus, qtyMax: qtyMax, namaPelanggan });  } else {
            seleksiPiutangEceran.push({ id, namaObat, totalAsli: totalHarga, hargaTebus: totalHarga, qtyTebus: 1, qtyMax: 1, namaPelanggan });
        }
    } else {
        seleksiPiutangEceran = seleksiPiutangEceran.filter(x => x.id !== id);
    }
    renderPiutangMobile(); // Refresh tombol bawah
}

// MESIN EKSEKUSI PEMBELAH SEL (MURNI FOKUS CENTANG)
function eksekusiPelunasanCerdas(metode) {
    let namaPelanggan = document.getElementById('pelunasanNamaMobile').textContent;
    let keranjangTarget = seleksiPiutangEceran.filter(x => x.namaPelanggan === namaPelanggan);
    if (keranjangTarget.length === 0) return alert("⚠️ Anda belum memilih item utang yang akan dilunasi.");

    let totalBayar = 0; let waPelanggan = '';
    const idPelunasanBaru = Date.now(); const tglWaktu = new Date();
    const strTanggal = getTanggalLokal(); const strWaktu = tglWaktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    keranjangTarget.forEach((sel, idx) => {
        let t = cashierHistory.find(x => x.id.toString() === sel.id.toString());
        if(!t) return;
        totalBayar += sel.hargaTebus; if(t.wa) waPelanggan = t.wa;

        let historiCicilan = cashierHistory.filter(p => p.isPelunasan && p.idTerkait == t.id && !p.isIndukBorongan);
        let totalQtyTertebus = historiCicilan.reduce((sum, p) => sum + (p.item || 0), 0);

        if((totalQtyTertebus + sel.qtyTebus) >= (t.item || 1)) { t.statusLunas = true; }

        cashierHistory.unshift({
            id: idPelunasanBaru + idx, tanggal: strTanggal, waktu: strWaktu,
            obat: `Pelunasan Eceran: ${sel.namaObat.replace(/ \([^)]*\)/, '')}`,
            kasir: 'Pemilik', item: sel.qtyTebus, total: sel.hargaTebus, metode: metode, metodeBayar: metode, laba: 0, pelanggan: namaPelanggan, wa: waPelanggan, isPelunasan: true, idTerkait: sel.id
        });
    });

    seleksiPiutangEceran = seleksiPiutangEceran.filter(x => x.namaPelanggan !== namaPelanggan);

    if (totalBayar > 0) {
        catatMutasiSiklus('OMZET_MASUK', totalBayar);
     kirimNotifikasiMobile('Pelunasan Diterima', `Pelunasan kasbon dari ${namaPelanggan} via ${metode}.`, 'lunas', totalBayar);
        saveApotekDB('apotek_cashierHistory', cashierHistory);
        saveApotekDB('apotek_siklusAktif', siklusAktif);    tutupModalMobile('modalPelunasanMobile'); renderPiutangMobile(); renderBerandaMobile(); renderRiwayatMobile();
        triggerHaptic([100, 50, 100]); alert(`✅ Pembayaran via ${metode} Berhasil! Transaksi telah dicatat ke Laporan.`);
    }
}

// ==========================================
// MESIN FILTER MULTI-TANGGAL (LAPORAN BUKU BESAR)
// ==========================================
let laporanTglAwal = getTanggalLokal();
let laporanTglAkhir = getTanggalLokal();
let laporanLabelVisual = "Hari Ini";

function toggleDropdownFilterLaporan() {
    const panel = document.getElementById('panelFilterLaporan');
    const icon = document.getElementById('iconDropdownFilterLaporan');
    const backdrop = document.getElementById('backdropFilterLaporan');
    if(panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (backdrop) backdrop.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
        icon.style.transform = 'rotate(180deg)';
    } else {
        panel.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function formatTanggalPendek(tglStr) {
    if(!tglStr) return '';
    let pecah = tglStr.split('-'); // [YYYY, MM, DD]
    if(pecah.length !== 3) return tglStr;
    let bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
    return `${parseInt(pecah[2])} ${bln[parseInt(pecah[1])-1]} ${pecah[0]}`;
}

function setFilterLaporan(tipe) {
    let tglSkrg = new Date();
    if (tipe === 'hari_ini') {
        laporanTglAwal = getTanggalLokal(tglSkrg);
        laporanTglAkhir = getTanggalLokal(tglSkrg);
        laporanLabelVisual = "Hari Ini";
    } else if (tipe === '7_hari') {
        let dateNow = getTanggalLokal(tglSkrg);
        let d1 = new Date(siklusAktif.tanggalStart);
        let d2 = new Date(dateNow);
        let diffTime = Math.abs(d2 - d1);
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
            return alert("⚠️ Maaf, siklus buku saat ini masih terlalu baru (belum mencapai 7 hari). Silakan gunakan filter Hari Ini atau Buku Baru.");
        }
        let tglLalu = new Date();
        tglLalu.setDate(tglLalu.getDate() - 6); // Mundur 7 hari
        laporanTglAwal = getTanggalLokal(tglLalu);
        laporanTglAkhir = getTanggalLokal(tglSkrg);
        laporanLabelVisual = "7 Hari Terakhir";
    } else if (tipe === '30_hari') {
        let dateNow = getTanggalLokal(tglSkrg);
        let d1 = new Date(siklusAktif.tanggalStart);
        let d2 = new Date(dateNow);
        let diffTime = Math.abs(d2 - d1);
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 30) {
            return alert("⚠️ Maaf, siklus buku saat ini masih terlalu baru (belum mencapai 30 hari). Silakan gunakan filter Hari Ini atau Buku Baru.");
        }
        let tglLalu = new Date(); tglLalu.setDate(tglLalu.getDate() - 29);
        laporanTglAwal = getTanggalLokal(tglLalu); laporanTglAkhir = getTanggalLokal(tglSkrg);
        laporanLabelVisual = "Bulan Ini (30 Hari)";
    } else if (tipe === 'siklus') {
        laporanTglAwal = siklusAktif.tanggalStart;
        laporanTglAkhir = getTanggalLokal(tglSkrg);
        laporanLabelVisual = "Siklus Saat Ini";
    } else if (tipe === 'arsip') {
        laporanTglAwal = "2000-01-01";
        laporanTglAkhir = "2099-12-31";
        laporanLabelVisual = "Arsip Total";
    } else if (tipe === 'manual') {
        let awal = document.getElementById('filterTglAwal').value;
        let akhir = document.getElementById('filterTglAkhir').value;
        if(!awal || !akhir) return alert("⚠️ Pilih tanggal Dari dan Sampai terlebih dahulu!");
        if(awal > akhir) return alert("⚠️ Tanggal 'Dari' tidak boleh lebih besar dari 'Sampai'!");
        laporanTglAwal = awal;
        laporanTglAkhir = akhir;
        if(awal === akhir) {
            laporanLabelVisual = formatTanggalPendek(awal);
        } else {
            laporanLabelVisual = `${formatTanggalPendek(awal)} - ${formatTanggalPendek(akhir)}`;
        }
    }

    document.getElementById('teksFilterLaporanUi').textContent = laporanLabelVisual;
    toggleDropdownFilterLaporan();
    renderLaporanMobile();
}


// GANTI / TEMPELKAN KODE DI BAWAH INI SECARA UTUH:
function renderLaporanMobile() {
    const wadah = document.getElementById('kontenLaporanMobile');

    // =======================================================
    // MESIN 1: KALKULASI RENTANG WAKTU (LABA/RUGI, ARUS KAS, TRAFIK)
    // =======================================================
    let dataPeriode = cashierHistory.filter(t => t.tanggal >= laporanTglAwal && t.tanggal <= laporanTglAkhir && (laporanTglAwal === '2000-01-01' ? true : t.tanggal !== '2000-01-01'));
    let dataKeluar = pengeluaranHistory.filter(p => p.tanggal >= laporanTglAwal && p.tanggal <= laporanTglAkhir && (laporanTglAwal === '2000-01-01' ? true : p.tanggal !== '2000-01-01'));

    let lOmset = 0, lHPP = 0, omzetTunai = 0, omzetQRIS = 0, omzetDebt = 0;
    let inLunas = 0, totalPembeli = 0, totalBiji = 0;
    let setPembeliUnikLaporan = new Set();

    let groupedSalesOnScreen = {};
    let lunasListOnScreen = [];

    dataPeriode.forEach(t => {
        let kunciPelacak = (t.metode === 'Debt') ? 'DEBT_'+t.tanggal+'_'+t.waktu+'_'+t.pelanggan : 'TRX_'+t.id; setPembeliUnikLaporan.add(kunciPelacak);

        if(!t.isPelunasan) {
            let omzet = t.total;
            let laba = t.laba;
            let hpp = (t.total - t.laba);

            lOmset += omzet; lHPP += hpp;
            if(t.metode === 'Tunai') omzetTunai += omzet;
            else if(t.metode === 'QRIS') omzetQRIS += omzet;
            else if(t.metode === 'Debt') omzetDebt += omzet;

            if (t.detailKeranjang && t.detailKeranjang.length > 0) {
                t.detailKeranjang.forEach(item => {
                    totalBiji += item.qty;
                    let infoFormat = formatNamaItemMaster(item.dnaInduk, item.nama, item.varian, item.kategori, '');
                    let namaLengkap = infoFormat.namaLengkapTxt + (infoFormat.kategoriTxt ? ' [' + infoFormat.kategoriTxt + ']' : '');

                    let key = namaLengkap + '|' + t.metode;
                    if(!groupedSalesOnScreen[key]) {
                        groupedSalesOnScreen[key] = { nama: namaLengkap, metode: t.metode, qty: 0, hpp: 0, omzet: 0, laba: 0 };
                    }
                    let itemHpp = item.hppTotalModal !== undefined ? item.hppTotalModal : ((item.hppSatuan || (item.jual * 0.8)) * item.qty);
                    let itemOmzet = (item.jual || 0) * item.qty;

                    groupedSalesOnScreen[key].qty += item.qty;
                    groupedSalesOnScreen[key].hpp += itemHpp;
                    groupedSalesOnScreen[key].omzet += itemOmzet;
                    groupedSalesOnScreen[key].laba += (itemOmzet - itemHpp);
                });
            } else {
                totalBiji += t.item;
                let infoFormat = formatNamaItemMaster(null, t.obat, '', '', '');
                let namaLengkap = infoFormat.namaLengkapTxt + (infoFormat.kategoriTxt ? ' [' + infoFormat.kategoriTxt + ']' : '');

                let key = namaLengkap + '|' + t.metode;
                if(!groupedSalesOnScreen[key]) {
                    groupedSalesOnScreen[key] = { nama: namaLengkap, metode: t.metode, qty: 0, hpp: 0, omzet: 0, laba: 0 };
                }
                groupedSalesOnScreen[key].qty += t.item;
                groupedSalesOnScreen[key].hpp += hpp;
                groupedSalesOnScreen[key].omzet += omzet;
                groupedSalesOnScreen[key].laba += laba;
            }
        } else {
            inLunas += t.total;
            lOmset += t.total;
            omzetTunai += t.total;
            lunasListOnScreen.push(t);
        }
    });
    totalPembeli = setPembeliUnikLaporan.size;

    let bBiayaToko = 0, bPrive = 0, bKulakan = 0;
    let listKulakanHtml = '', listBiayaHtml = '', listPriveHtml = '';

    dataKeluar.forEach(p => {
        let barisHtml = `<div class="grid grid-cols-[1fr_max-content_max-content] gap-x-2 text-[8.5px] text-slate-400 mb-1 whitespace-nowrap"><span class="truncate">&bull; ${p.keterangan}</span><span class="text-rose-400 font-mono">- Rp</span><span class="text-rose-400 font-mono text-right">${Math.round(p.nominal).toLocaleString('id-ID')}</span></div>`;
        if (p.kategori === 'Biaya Toko') { bBiayaToko += p.nominal; listBiayaHtml += barisHtml; }
        else if (p.kategori === 'Prive') { bPrive += p.nominal; listPriveHtml += barisHtml; }
        else if (p.kategori === 'Kulakan') { bKulakan += p.nominal; listKulakanHtml += barisHtml; }
    });

    let labaKotor = lOmset - lHPP;
    let kerugianPenyusutan = 0;
    let listPenyusutanHtml = "";

    historiPenyusutan.forEach(susut => {
        if (susut.tanggal >= laporanTglAwal && susut.tanggal <= laporanTglAkhir && (laporanTglAwal === '2000-01-01' ? true : susut.tanggal !== '2000-01-01')) {
            kerugianPenyusutan += (susut.totalKerugian || 0);
            listPenyusutanHtml += `<div class="grid grid-cols-[1fr_max-content_max-content] gap-x-2 text-[10px] text-slate-500 mb-1 border-b border-slate-100 pb-1">
                <span class="truncate">&bull; ${susut.namaLengkap} <br><span class="text-[8px] text-slate-400">(${susut.qtyDibuang} dibuang - ${susut.jenisMasalah})</span></span>
                <span class="text-rose-500 font-mono">- Rp</span><span class="text-rose-500 font-mono text-right font-medium">${Math.round(susut.totalKerugian || 0).toLocaleString('id-ID')}</span>
            </div>`;
        }
    });

    if(!listPenyusutanHtml) listPenyusutanHtml = `<div class="text-[10px] text-slate-400 italic text-center py-2">Belum ada kerugian barang rusak</div>`;

    let labaBersihSejati = labaKotor - bBiayaToko - kerugianPenyusutan; // Rumus Baru
    let labaDitahan = labaBersihSejati - bPrive;
    let aov = totalPembeli > 0 ? (lOmset / totalPembeli) : 0;
    let margin = lOmset > 0 ? ((labaBersihSejati / lOmset) * 100).toFixed(1) : 0;

    // =======================================================
    // MESIN 2: KALKULASI REAL-TIME (NERACA HARTA KEKAYAAN)
    // =======================================================
    let estimasiIsiLaci = hitungSaldoLaciFisik();
    let hartaQRIS = hitungSaldoQRIS();

    let hartaPiutang = 0; let hutangMap = {};
    cashierHistory.filter(t => t.metode === 'Debt' || t.isPelunasan).forEach(t => {
        if(t.metode === 'Debt' && !t.statusLunas) hutangMap[t.id] = t.total;
        if(t.isPelunasan && t.idTerkait && hutangMap[t.idTerkait]) hutangMap[t.idTerkait] -= t.total;
    });
    Object.values(hutangMap).forEach(v => { if(v > 0) hartaPiutang += v; });

    let rekapAset = kalkulasiAsetFisik();
    let sisaQtyReal = rekapAset.totalQty;
    let sisaRpReal = rekapAset.totalAset;

    // =======================================================
    // MESIN 3: KALKULASI SIKLUS PERSEDIAAN
    // =======================================================
    let terjualQtySiklus = 0; let terjualRpSiklus = 0;
    let wMulai = siklusAktif.waktuStart || 0;
    cashierHistory.filter(t => (wMulai ? t.id >= wMulai : t.tanggal >= siklusAktif.tanggalStart) && !t.isPelunasan).forEach(t => {
        terjualQtySiklus += (t.item || 1);
        terjualRpSiklus += ((t.total || 0) - (t.laba || 0));
    });

    let totalQtyTersedia = (siklusAktif.qtyAwal || 0) + (siklusAktif.qtyTambahan || 0);
    let totalModalTersedia = (siklusAktif.modalAwal || 0) + (siklusAktif.modalTambahan || 0);

  // =======================================================
    // MESIN 4: KALKULASI JENIS BARANG (BARU)
    // =======================================================
    let unikObat = new Set();
    masterItems.forEach(m => {
        if(m.nama !== '___SYSTEM_AUTH___' && m.kategori !== '⚠️ Barang Retur') unikObat.add(m.dnaInduk);
    });
    etalaseItems.forEach(e => {
        unikObat.add(e.dnaInduk || e.nama);
    });
    let totalJenisObat = unikObat.size;

    // =======================================================
    // RENDERING UI: AKORDEON DINAMIS & BATANGAN EMAS
    // =======================================================
    let listTrxGroupedHtml = "";
    for (let key in groupedSalesOnScreen) {
        let g = groupedSalesOnScreen[key];
        listTrxGroupedHtml += `<div class="grid grid-cols-[1fr_max-content_max-content] gap-x-2 text-[10px] text-slate-500 mb-2 border-b border-slate-700/50 pb-2">
            <span class="truncate">&bull; ${g.nama} <br><span class="text-[8px] text-slate-400">(${g.qty} item - ${g.metode})</span></span>
            <span class="text-emerald-500 font-mono">Rp</span><span class="text-emerald-500 font-mono text-right font-medium">${Math.round(g.omzet).toLocaleString('id-ID')}</span>
        </div>`;
    }
    lunasListOnScreen.forEach(t => {
        listTrxGroupedHtml += `<div class="grid grid-cols-[1fr_max-content_max-content] gap-x-2 text-[10px] text-slate-500 mb-2 border-b border-slate-700/50 pb-2">
            <span class="truncate">&bull; Pelunasan: ${t.keterangan || '-'} <br><span class="text-[8px] text-slate-400">(Tunai)</span></span>
            <span class="text-emerald-500 font-mono">Rp</span><span class="text-emerald-500 font-mono text-right font-medium">${Math.round(t.total).toLocaleString('id-ID')}</span>
        </div>`;
    });
    if(!listTrxGroupedHtml) listTrxGroupedHtml = `<div class="text-[10px] text-slate-400 italic text-center py-2">Belum ada transaksi</div>`;

    wadah.innerHTML = `
    <div class="flex flex-col gap-3 pb-4">

     <!-- BLOK I: ALUR MODAL PERSEDIAAN -->
        <div class="bg-[#24272c] border border-[#3b3f46] rounded-xl shadow-sm select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-persediaan')"> <div class="flex items-center gap-2">
                    <h3 class="text-[#93c5fd] font-bold text-[10px] uppercase tracking-widest"><i class="fa-solid fa-boxes-stacked mr-1"></i> 1. Barang Di Toko / Persediaan</h3>
                    <span class="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest">
                        <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_5px_rgba(239,68,68,0.8)]"></span> Live Shift
                    </span>
                </div>
                <i class="fa-solid fa-chevron-down text-slate-400 text-[10px] transition-transform duration-300" id="icon-blok-persediaan"></i>
            </div>

            <div id="blok-persediaan" class="hidden px-3.5 pb-3.5 border-t border-[#3b3f46] pt-3">
                <p class="text-[8px] text-slate-400 font-medium italic mb-3 leading-tight bg-[#1e2329] p-2 rounded border border-[#3b3f46]">
                    *Data di blok ini adalah <b class="text-slate-300">Stok Fisik Live</b> sejak terakhir tutup buku. Tidak terpengaruh filter tanggal.
                </p>
                <div class="grid grid-cols-[1fr_max-content_max-content_max-content_max-content_max-content] gap-y-1.5 items-center w-full text-[10px] whitespace-nowrap">
                    <div class="text-slate-400 truncate pr-2">Stok Awal</div>
                    <div class="text-right font-mono text-slate-200">${siklusAktif.qtyAwal}</div>
                    <div class="text-left font-mono text-slate-200 pl-1">Pcs</div>
                    <div class="text-center font-mono text-slate-500 px-1.5">|</div>
                    <div class="text-left font-mono text-slate-200">Rp</div>
                    <div class="text-right font-mono text-slate-200">${Math.round(siklusAktif.modalAwal).toLocaleString('id-ID')}</div>

                    <div class="text-slate-400 truncate pr-2">(+) Barang Masuk / Kulakan </div>
                    <div class="text-right font-mono text-emerald-400">+ ${siklusAktif.qtyTambahan}</div>
                    <div class="text-left font-mono text-emerald-400 pl-1">Pcs</div>
                    <div class="text-center font-mono text-slate-500 px-1.5">|</div>
                    <div class="text-left font-mono text-emerald-400">+ Rp</div>
                    <div class="text-right font-mono text-emerald-400">${Math.round(siklusAktif.modalTambahan).toLocaleString('id-ID')}</div>

                    <div class="col-span-6 border-t border-[#3b3f46] my-1"></div>

                    <div class="font-bold text-slate-300 truncate pr-2">(=) Total Barang Siap Jual</div>
                    <div class="text-right font-bold font-mono text-blue-300">${totalQtyTersedia}</div>
                    <div class="text-left font-bold font-mono text-blue-300 pl-1">Pcs</div>
                    <div class="text-center font-bold font-mono text-slate-500 px-1.5">|</div>
                    <div class="text-left font-bold font-mono text-blue-300">Rp</div>
                    <div class="text-right font-bold font-mono text-blue-300">${Math.round(totalModalTersedia).toLocaleString('id-ID')}</div>

                    <div class="col-span-6 h-1"></div>

                    <div class="text-slate-400 truncate pr-2">(-) Terjual (Modal Barang)</div>
                    <div class="text-right font-mono text-rose-400">- ${terjualQtySiklus}</div>
                    <div class="text-left font-mono text-rose-400 pl-1">Pcs</div>
                    <div class="text-center font-mono text-slate-500 px-1.5">|</div>
                    <div class="text-left font-mono text-rose-400">- Rp</div>
                    <div class="text-right font-mono text-rose-400">${Math.round(terjualRpSiklus).toLocaleString('id-ID')}</div>

                    <div class="text-slate-500 truncate pr-2 mt-1">(-) Rusak / Hilang / Exp</div>
                    <div class="text-right font-mono text-orange-400 mt-1">- ${siklusAktif.qtyDihapus || 0}</div>           <div class="text-left font-mono text-orange-400 pl-1 mt-1">Pcs</div>
                    <div class="text-center font-mono text-slate-600 px-1.5 mt-1">|</div>
                    <div class="text-left font-mono text-orange-400 mt-1">- Rp</div>
                    <div class="text-right font-mono text-orange-400 mt-1">${Math.round(siklusAktif.modalDihapus || 0).toLocaleString('id-ID')}</div>

                    <div class="col-span-6 border-t border-dashed border-[#3b3f46] my-1.5"></div>

                    <div class="font-bold text-white text-[10.5px] truncate pr-2">(=) Sisa Barang / Stok di Rak</div>
                    <div class="text-right font-bold font-mono text-white text-[10.5px]">${sisaQtyReal}</div>
                    <div class="text-left font-bold font-mono text-white text-[10.5px] pl-1">Pcs</div>
                    <div class="text-center font-bold font-mono text-slate-500 text-[10.5px] px-1.5">|</div>
                    <div class="text-left font-bold font-mono text-white text-[10.5px]">Rp</div>
                    <div class="text-right font-bold font-mono text-white text-[10.5px] tracking-tight">${Math.round(sisaRpReal).toLocaleString('id-ID')}</div>
                </div>
            </div>
        </div>

        <!-- BLOK II: KINERJA PENJUALAN -->
        <div class="bg-[#f8fafc] border border-slate-300 rounded-xl shadow-sm text-slate-800 select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-penjualan')">      <h3 class="text-[#0f766e] font-bold text-[10px] uppercase tracking-widest"><i class="fa-solid fa-scale-balanced mr-1"></i> 2. Penjualan / Keuntungan </h3>
                <div class="flex items-center gap-2">
                    <span class="text-[8px] font-bold text-slate-500 uppercase border border-slate-300 px-1 rounded-sm tracking-widest">${laporanLabelVisual}</span>
                    <i class="fa-solid fa-chevron-down text-slate-400 text-[10px] transition-transform duration-300" id="icon-blok-penjualan"></i>
                </div>
            </div>

            <div id="blok-penjualan" class="hidden px-3.5 pb-3.5 border-t border-slate-300 pt-3">
                <p class="text-[9px] font-black text-slate-500 mb-2 uppercase">A. Pemasukan (Omzet)</p>
                <div class="grid grid-cols-[1fr_max-content_max-content] gap-y-1.5 items-center w-full text-[10px] pl-2 whitespace-nowrap">
                    <div class="text-slate-600 truncate pr-2">Pembayaran via Tunai</div>
                    <div class="font-mono text-slate-800 pl-2 pr-1">Rp</div>
                    <div class="font-mono text-slate-800 text-right">${Math.round(omzetTunai).toLocaleString('id-ID')}</div>

                    <div class="text-slate-600 truncate pr-2">Pembayaran via QRIS / Bank</div>
                    <div class="font-mono text-slate-800 pl-2 pr-1">Rp</div>
                    <div class="font-mono text-slate-800 text-right">${Math.round(omzetQRIS).toLocaleString('id-ID')}</div>

                    <div class="text-slate-600 truncate pr-2">Pelanggan Bon / Piutang</div>
                    <div class="font-mono text-slate-800 pl-2 pr-1">Rp</div>
                    <div class="font-mono text-slate-800 text-right">${Math.round(omzetDebt).toLocaleString('id-ID')}</div>

                    <div class="col-span-3 border-t border-slate-200 my-0.5"></div>

                    <div class="text-slate-800 font-bold truncate pr-2">Total</div>
                    <div class="font-mono text-[#0f766e] font-bold pl-2 pr-1">Rp</div>
                    <div class="font-mono text-[#0f766e] font-bold text-right">${Math.round(lOmset).toLocaleString('id-ID')}</div>

                    <div class="col-span-3 h-2"></div>

                    <div class="text-[#0f766e] font-bold truncate pr-2">(+) Terima Bayaran Bon</div>
                    <div class="font-mono text-[#0f766e] font-bold pl-2 pr-1">+ Rp</div>
                    <div class="font-mono text-[#0f766e] font-bold text-right">${Math.round(inLunas).toLocaleString('id-ID')}</div>
                </div>

                <p class="text-[9px] font-black text-slate-500 mt-4 mb-2 uppercase">B. HPP Terjual & Biaya Operasional Toko</p>
                <div class="grid grid-cols-[1fr_max-content_max-content] gap-y-1.5 items-center w-full text-[10px] pl-2 whitespace-nowrap">
                    <div class="text-slate-600 truncate pr-2">Modal Barang (Hpp) Terjual</div>
                    <div class="font-mono text-rose-600 pl-2 pr-1">- Rp</div>
                    <div class="font-mono text-rose-600 text-right">${Math.round(lHPP).toLocaleString('id-ID')}</div>

                    <div class="text-slate-600 truncate pr-2">Biaya Operasional Toko</div>
                    <div class="font-mono text-rose-600 pl-2 pr-1">- Rp</div>
                    <div class="font-mono text-rose-600 text-right">${Math.round(bBiayaToko).toLocaleString('id-ID')}</div>

                    <div class="text-slate-600 truncate pr-2">Barang Rusak/Hilang/Exp</div>
                    <div class="font-mono text-rose-600 pl-2 pr-1">- Rp</div>
                    <div class="font-mono text-rose-600 text-right">${Math.round(kerugianPenyusutan).toLocaleString('id-ID')}</div>
                </div>

                <div class="border-t border-slate-400 mt-3 pt-2 flex justify-between items-center">           <div class="flex items-center gap-2">
                        <span class="font-black text-[11px] uppercase">Untung Bersih</span>
                        <span class="bg-[#0f766e] text-white text-[8px] px-1 rounded-sm font-black">${margin}% Margin</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="font-black font-mono text-[11px] ${labaBersihSejati >= 0 ? 'text-[#166534]' : 'text-rose-600'}">Rp</span>
                        <span class="font-black font-mono text-[13px] tracking-tight ${labaBersihSejati >= 0 ? 'text-[#166534]' : 'text-rose-600'}">${Math.round(labaBersihSejati).toLocaleString('id-ID')}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- BLOK RINCIAN BUKU HARIAN (GROUPED TRANSAKSI) -->
        <div class="bg-[#24272c] border border-[#3b3f46] rounded-xl shadow-sm select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-transaksi-grouped')">
                <p class="text-[9px] font-black text-[#93c5fd] uppercase tracking-widest flex items-center gap-1.5"><i class="fa-solid fa-receipt text-sky-400"></i> RINCIAN TRANSAKSI (GROUPED)</p>
                <i class="fa-solid fa-chevron-down text-slate-400 text-[10px] transition-transform duration-300" id="icon-blok-transaksi-grouped"></i>
            </div>
            <div id="blok-transaksi-grouped" class="hidden px-3.5 pb-3.5 border-t border-[#3b3f46] pt-2 space-y-2">
                <div class="bg-[#1e2329] border border-[#3b3f46] p-2 rounded-sm">
                    ${listTrxGroupedHtml}
                </div>
            </div>
        </div>

        <!-- BLOK KERUGIAN BARANG RUSAK -->
        <div class="bg-[#24272c] border border-[#3b3f46] rounded-xl shadow-sm select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-rusak')">
                <p class="text-[9px] font-black text-rose-400 uppercase tracking-widest flex items-center gap-1.5"><i class="fa-solid fa-truck-ramp-box text-rose-500"></i> KERUGIAN BRG RUSAK/EXP</p>
                <i class="fa-solid fa-chevron-down text-slate-400 text-[10px] transition-transform duration-300" id="icon-blok-rusak"></i>
            </div>
            <div id="blok-rusak" class="hidden px-3.5 pb-3.5 border-t border-[#3b3f46] pt-2 space-y-2">
                <div class="bg-[#1e2329] border border-[#3b3f46] p-2 rounded-sm">
                    ${listPenyusutanHtml}
                </div>
            </div>
        </div>

        <!-- BLOK RINCIAN KAS KELUAR -->
        <div class="bg-[#24272c] border border-[#3b3f46] rounded-xl shadow-sm text-slate-200 select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-kaskeluar')">    <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><i class="fa-solid fa-file-invoice"></i> 3. UANG KELUAR</p>
                 <div class="flex items-center gap-2">
                    <span class="text-[11px] font-black text-rose-400 font-mono tracking-tight">- ${rupiah(Math.round(bKulakan + bBiayaToko + bPrive))}</span>
                    <i class="fa-solid fa-chevron-down text-slate-400 text-[10px] transition-transform duration-300" id="icon-blok-kaskeluar"></i>
                 </div>
            </div>

            <div id="blok-kaskeluar" class="hidden px-3.5 pb-3.5 border-t border-[#3b3f46] pt-2 space-y-2">
                ${listKulakanHtml ? `<div class="bg-[#1e2329] border border-[#3b3f46] p-2 rounded-sm"><p class="text-[8px] text-blue-400 font-black uppercase mb-1.5">Belanja Barang</p>${listKulakanHtml}</div>` : ''}
                ${listBiayaHtml ? `<div class="bg-[#1e2329] border border-[#3b3f46] p-2 rounded-sm"><p class="text-[8px] text-orange-400 font-black uppercase mb-1.5">Biaya Toko</p>${listBiayaHtml}</div>` : ''}
                ${listPriveHtml ? `<div class="bg-[#1e2329] border border-[#3b3f46] p-2 rounded-sm"><p class="text-[8px] text-purple-400 font-black uppercase mb-1.5">Diambil Pribadi</p>${listPriveHtml}</div>` : ''}
                ${(!listKulakanHtml && !listBiayaHtml && !listPriveHtml) ? `<p class="text-[9px] text-slate-500 italic">Tidak ada catatan kas keluar.</p>` : ''}
            </div>
        </div>

        <!-- BLOK III: TRAFIK & EKUITAS -->
        <div class="bg-[#24272c] border border-[#3b3f46] rounded-xl shadow-sm text-slate-200 select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-trafik')">             <h3 class="text-[#fcd34d] font-bold text-[10px] uppercase tracking-widest"><i class="fa-solid fa-chart-line mr-1"></i> 4. Keramaian & Sisa Untung</h3>
                <i class="fa-solid fa-chevron-down text-slate-400 text-[10px] transition-transform duration-300" id="icon-blok-trafik"></i>
            </div>

            <div id="blok-trafik" class="hidden px-3.5 pb-3.5 border-t border-[#3b3f46] pt-3">
                <div class="grid grid-cols-3 gap-2 mb-4">
                    <div class="border border-[#3b3f46] rounded-sm p-2 text-center bg-[#1e2329]">
                        <p class="text-[8px] font-bold text-slate-400 uppercase mb-1">Jumlah Pembeli</p>
                        <p class="text-[12px] font-black text-white">${totalPembeli}</p>
                    </div>
                    <div class="border border-[#3b3f46] rounded-sm p-2 text-center bg-[#1e2329]">
                        <p class="text-[8px] font-bold text-slate-400 uppercase mb-1">Terjual</p>
                        <p class="text-[12px] font-black text-white">${totalBiji} Stok</p>
                    </div>
                    <div class="border border-[#3b3f46] rounded-sm p-2 text-center bg-[#1e2329]">
                        <p class="text-[8px] font-bold text-slate-400 uppercase mb-1">Rata-rata Belanja</p>
                        <p class="text-[10px] font-black text-emerald-400 font-mono">${rupiah(Math.round(aov))}</p>
                    </div>
                </div>

                <div class="grid grid-cols-[1fr_max-content_max-content] gap-y-1.5 items-center w-full text-[10px] whitespace-nowrap">
                    <div class="text-slate-400 truncate pr-2">Untung Bersih</div>
                    <div class="font-mono text-slate-200 pl-2 pr-1">Rp</div>
                    <div class="font-mono text-slate-200 text-right">${Math.round(labaBersihSejati).toLocaleString('id-ID')}</div>

                    <div class="text-slate-400 truncate pr-2">(-) Diambil Pribadi</div>
                    <div class="font-mono text-rose-400 pl-2 pr-1">- Rp</div>
                    <div class="font-mono text-rose-400 text-right">${Math.round(bPrive).toLocaleString('id-ID')}</div>

                    <div class="col-span-3 border-t border-[#3b3f46] my-0.5"></div>

                    <div class="font-bold text-white text-[10.5px] truncate pr-2">Untung Yang Tinggal</div>
                    <div class="font-bold font-mono ${labaDitahan >= 0 ? 'text-[#fcd34d]' : 'text-rose-500'} text-[10.5px] pl-2 pr-1">Rp</div>
                    <div class="font-bold font-mono ${labaDitahan >= 0 ? 'text-[#fcd34d]' : 'text-rose-500'} text-right text-[10.5px] tracking-tight">${Math.round(labaDitahan).toLocaleString('id-ID')}</div>
                </div>
            </div>
        </div>

        <!-- BLOK IV: NERACA KEKAYAAN (GOLD CARD) -->
        <div class="bg-gradient-to-br from-[#cfa950] to-[#997321] border border-[#ebd088] rounded-xl shadow-md text-[#332508] mt-1 select-none">
            <div class="flex justify-between items-center px-4 py-2.5 cursor-pointer" onclick="toggleAkordeonLaporan('blok-neraca')">        <h3 class="font-black text-[10px] uppercase tracking-widest"><i class="fa-solid fa-vault mr-1"></i> 5. Total Milik Toko (Sekarang)<span class="bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-2 inline-flex items-center gap-1">🔴 LIVE</span></h3>
                <i class="fa-solid fa-chevron-down text-[#6b4e12] text-[10px] transition-transform duration-300" id="icon-blok-neraca"></i>
            </div>

            <div id="blok-neraca" class="hidden px-3.5 pb-3.5 border-t border-[#a6802e] pt-3">
                <div class="grid grid-cols-[max-content_1fr_max-content_max-content] gap-x-1.5 items-end w-full text-[10px] font-semibold whitespace-nowrap">

                    <span>1. Uang Tunai (Laci)</span>
                    <div class="border-b border-dotted border-[#8c6b24] mb-1 relative top-[-4px]"></div>
                    <span class="font-mono font-black text-[#1d1504]">Rp</span>
                    <span class="font-mono font-black text-[#1d1504] text-right">${Math.round(estimasiIsiLaci).toLocaleString('id-ID')}</span>

                    <span class="mt-1.5">2. Bank / QRIS</span>
                    <div class="border-b border-dotted border-[#8c6b24] mb-1 relative top-[-4px] mt-1.5"></div>
                    <span class="font-mono font-black text-[#1d1504] mt-1.5">Rp</span>
                    <span class="font-mono font-black text-[#1d1504] text-right mt-1.5">${Math.round(hartaQRIS).toLocaleString('id-ID')}</span>

                    <span class="mt-1.5">3. Bon / Piutang (Di Luar)</span>
                    <div class="border-b border-dotted border-[#8c6b24] mb-1 relative top-[-4px] mt-1.5"></div>
                    <span class="font-mono font-black text-[#1d1504] mt-1.5">Rp</span>
                    <span class="font-mono font-black text-[#1d1504] text-right mt-1.5">${Math.round(hartaPiutang).toLocaleString('id-ID')}</span>

                    <span class="mt-1.5">4. Nilai Stok Barang</span>
                    <div class="border-b border-dotted border-[#8c6b24] mb-1 relative top-[-4px] mt-1.5"></div>
                    <span class="font-mono font-black text-[#1d1504] mt-1.5">Rp</span>
                    <span class="font-mono font-black text-[#1d1504] text-right mt-1.5">${Math.round(sisaRpReal).toLocaleString('id-ID')}</span>
                </div>

                <div class="border-t border-[#8c6b24] pt-2 flex justify-between items-center mt-2">
                    <span class="font-black text-[10px] uppercase">TOTAL MILIK TOKO</span>
                    <div class="flex items-center gap-1">
                        <span class="font-black font-mono text-[11px]">Rp</span>
                        <span class="font-black font-mono text-[14px] tracking-tight">${Math.round(estimasiIsiLaci + hartaQRIS + hartaPiutang + sisaRpReal).toLocaleString('id-ID')}</span>
                    </div>
                </div>
            </div>
        </div>
                <!-- ====================================================================== -->
        <!-- EXECUTIVE SUMMARY: ALIGNMENT GRID MISTAR TITIK DUA (KIRI) -->
        <!-- ====================================================================== -->
        <div class="mt-6 flex flex-col w-full shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-[#a6802e]">

            <!-- HEADER KESIMPULAN INTI -->
            <div class="bg-gradient-to-r from-slate-900 to-black p-2.5 text-center border-b border-slate-700">
                <h3 class="text-white font-black text-[10px] uppercase tracking-[0.2em]"><i class="fa-solid fa-crown text-[#cfa950] mr-1"></i> Rekap Putaran Dagang</h3>
            </div>

            <!-- BATANG 1: OMZET -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_35px_max-content] items-center border-b border-[#735311]">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">Pemasukan/Omzet</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#1a1202] font-black text-[11px] text-left">Rp</div>
                <div class="text-[#1a1202] font-black font-mono text-[13px] text-right">${Math.round(lOmset).toLocaleString('id-ID')}</div>
            </div>

            <!-- BATANG 2: HPP, BIAYA & KERUGIAN -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_35px_max-content] items-center border-b border-[#735311]">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">HPP + Biaya Toko</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#5b1414] font-black text-[11px] text-left">- Rp</div>
                <div class="text-[#5b1414] font-black font-mono text-[13px] text-right">${Math.round(lHPP + bBiayaToko + kerugianPenyusutan).toLocaleString('id-ID')}</div>
            </div>

            <!-- BATANG 3: LABA BERSIH (GLOWING) -->
            <div class="bg-gradient-to-r from-[#fcd34d] to-[#d97706] p-3 grid grid-cols-[135px_10px_1fr_35px_max-content] items-center border-b border-[#735311] shadow-inner">
                <div class="text-black font-black text-[12px] uppercase tracking-widest flex items-center gap-1.5 truncate"><i class="fa-solid fa-sack-dollar text-[#78350f]"></i> Untung / Laba</div>
                <div class="text-black font-black text-[12px] text-center">:</div>
                <div></div>
                <div class="text-black font-black text-[12px] text-left">Rp</div>
                <div class="text-black font-black font-mono text-[16px] drop-shadow-md text-right tracking-tight">${Math.round(labaBersihSejati).toLocaleString('id-ID')}</div>
            </div>

            <!-- BATANG 4: MODAL BARANG (DARK MODE STYLE) -->
            <div class="bg-gradient-to-r from-slate-900 to-black p-2.5 grid grid-cols-[135px_1fr_35px_max-content] items-center border-b border-[#cfa950]">
                <div class="text-[#cfa950] font-black text-[10px] uppercase tracking-widest truncate flex items-center gap-1.5"><i class="fa-solid fa-boxes-packing"></i> Modal Barang</div>
                <div class="text-slate-300 font-bold text-[10px] text-center truncate px-1">${totalQtyTersedia} Stok Awal</div>
                <div class="text-white font-black text-[11px] text-left">Rp</div>
                <div class="text-white font-black font-mono text-[14px] text-right tracking-tight">${Math.round(totalModalTersedia).toLocaleString('id-ID')}</div>
            </div>

            <!-- BATANG 5: TERJUAL -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_max-content] items-center border-b border-[#735311]/40">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">Barang Terjual</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#1a1202] font-black font-mono text-[12px] text-right">${terjualQtySiklus} Pcs</div>
            </div>

            <!-- BATANG BARU 6: RUSAK / EXP -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_max-content] items-center border-b border-[#735311]/40">
                <div class="text-[#5b1414] font-black text-[10px] uppercase tracking-widest truncate">Rusak / Expired</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#5b1414] font-black font-mono text-[12px] text-right">${siklusAktif.qtyDihapus || 0} Pcs</div>
            </div>

            <!-- BATANG 7: SISA STOK -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_max-content] items-center border-b border-[#735311]/40">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">Sisa Stok</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#1a1202] font-black font-mono text-[12px] text-right">${sisaQtyReal} Pcs</div>
            </div>

            <!-- BATANG 8: JENIS BARANG -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_max-content] items-center border-b border-[#735311]/40">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">Jenis Barang</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#1a1202] font-black font-mono text-[12px] text-right">${totalJenisObat} Jenis</div>
            </div>

            <!-- BATANG 9: TOTAL PEMBELI -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_max-content] items-center border-b border-[#735311]">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">Total Pembeli</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-black font-black font-mono text-[11px] bg-black/10 px-2 py-0.5 rounded text-right ml-auto w-max justify-self-end">${totalPembeli} Org</div>
            </div>

            <!-- BATANG 10: ASET RAK -->
            <div class="bg-gradient-to-r from-[#cfa950] to-[#997321] p-2.5 grid grid-cols-[135px_10px_1fr_35px_max-content] items-center border-b border-[#735311]">
                <div class="text-[#2a1e04] font-black text-[10px] uppercase tracking-widest truncate">Nilai Sisa Stok</div>
                <div class="text-[#2a1e04] font-black text-[10px] text-center">:</div>
                <div></div>
                <div class="text-[#1a1202] font-black text-[11px] text-left">Rp</div>
                <div class="text-[#1a1202] font-black font-mono text-[13px] text-right">${Math.round(sisaRpReal).toLocaleString('id-ID')}</div>
            </div>

            <!-- BATANG 11: PERFORMA OBAT (DROPDOWN) DENGAN LENCANA JENIS OBAT -->
            <div class="bg-gradient-to-r from-slate-900 to-slate-800 border-t border-[#cfa950]">
                <div class="p-3 flex justify-between items-center cursor-pointer" onclick="toggleAkordeonLaporan('tabel-performa-obat')">
                    <span class="text-[#cfa950] font-black text-[10px] uppercase tracking-widest flex items-center gap-1.5">
                        <i class="fa-solid fa-list-ol"></i> Rincian Jenis Barang
                        <span id="badge-jenis-obat" class="bg-[#cfa950] text-[#1a1202] px-1.5 py-0.5 rounded-sm text-[8px] leading-none ml-1 hidden tracking-normal">0 Jenis</span>
                    </span>
                    <i class="fa-solid fa-chevron-down text-[#cfa950] text-[12px] transition-transform duration-300" id="icon-tabel-performa-obat"></i>
                </div>

                <!-- ISI DROPDOWN BATANG -->
                <div id="tabel-performa-obat" class="hidden bg-white overflow-x-auto hide-scrollbar border-t border-slate-700">
                    <table class="w-full text-left border-collapse whitespace-nowrap">
                        <thead>
                            <tr class="bg-slate-100 text-[8px] font-black text-slate-500 uppercase tracking-widest border-b-2 border-slate-300">
                                <th class="py-2 px-2 sticky left-0 bg-slate-100 z-10 border-r border-slate-200">Nama Barang</th>
                                <th class="py-2 px-2 border-r border-slate-200 text-right">Awal</th>
                                <th class="py-2 px-2 border-r border-slate-200 text-right text-amber-600">Laku</th>
                                <th class="py-2 px-2 border-r border-slate-200 text-right text-emerald-600">Sisa</th>
                                <th class="py-2 px-2 border-r border-slate-200 text-right">Modal/HPP</th>
                                <th class="py-2 px-2 text-right">Jual</th>
                            </tr>
                        </thead>
                        <tbody class="text-[9px] font-bold font-mono text-slate-700 divide-y divide-slate-100" id="body-tabel-performa">
                            <!-- INJEKSI JS AKAN MASUK KE SINI -->
                        </tbody>
                    </table>
                </div>
            </div>

        </div>

    </div>`;

    // ======================================================================
    // INJEKSI JS: MERAKIT DATA TABEL OBAT BATANG 11 (VIA SATPAM ARSIP)
    // ======================================================================
    setTimeout(function() {
        // ⚡ KABEL BARU: PANGGIL POHON DATA SECARA INSTAN
        let pohonData = KalkulatorMasterObat();
        let htmlTabelObat = '';
        let jumlahJenisObat = 0;

        // Urutkan dari yang paling laris di shift ini
        Object.values(pohonData).sort((a,b) => b.lakuShiftIni - a.lakuShiftIni).forEach(obat => {

            // RUMUS PATEN AWAL (Sisa Fisik + Terjual Shift + Rusak/Exp)
            let awal = obat.sisaFisikTotal + obat.lakuShiftIni + obat.rusakExpTotal;

            if (awal > 0) {
                jumlahJenisObat++;

                // Desain Kolom Nama & Kategori
                let infoFormat = formatNamaItemMaster(obat.dnaInduk, obat.namaLengkap, '', obat.kategori, 'text-[11px] text-slate-900');
                let kolomNamaHtml = `
                <div class="flex flex-col py-1 gap-1">
                    ${infoFormat.namaHtml}
                    <div>${infoFormat.kategoriHtml}</div>
                </div>`;

                // Kalkulasi Rata-rata HPP Presisi Tinggi (Berdasarkan Sisa Aset Aktual)
                let hppRataRata = (obat.sisaFisikTotal > 0 && obat.modalAsetTersisa > 0)
                    ? Math.round(obat.modalAsetTersisa / obat.sisaFisikTotal)
                    : 0;

                // RAKIT BARIS TABEL (MISTAR PRESISI KIRI-KANAN)
                htmlTabelObat += `
                <tr class="hover:bg-amber-50/50 transition-colors">
                    <td class="py-1.5 px-2 sticky left-0 bg-white z-10 border-r border-slate-100 max-w-[140px]">${kolomNamaHtml}</td>
                    <td class="py-1.5 px-2 border-r border-slate-100 text-right font-mono text-[10px]">${awal}</td>
                    <td class="py-1.5 px-2 border-r border-slate-100 text-right text-amber-600 font-bold font-mono text-[10px]">${obat.lakuShiftIni}</td>
                    <td class="py-1.5 px-2 border-r border-slate-100 text-right text-emerald-600 font-bold font-mono text-[10px]">${obat.sisaFisikTotal}</td>
                    <td class="py-1.5 px-2 border-r border-slate-100">
                        <div class="grid grid-cols-[15px_1fr] items-center w-full min-w-[55px]"><span class="text-[8px] text-slate-400 font-sans text-left">Rp</span><span class="text-right font-mono text-[10px]">${hppRataRata.toLocaleString('id-ID')}</span></div>
                    </td>
                    <td class="py-1.5 px-2">
                        <div class="grid grid-cols-[15px_1fr] items-center w-full min-w-[55px]"><span class="text-[8px] text-slate-400 font-sans text-left">Rp</span><span class="text-right font-mono text-[10px]">${(obat.hargaJual || 0).toLocaleString('id-ID')}</span></div>
                    </td>
                </tr>`;
            }
        });

        let elemenBody = document.getElementById('body-tabel-performa');
        if (elemenBody) {
            elemenBody.innerHTML = htmlTabelObat || '<tr><td colspan="6" class="py-4 text-center text-slate-400">Belum ada data barang.</td></tr>';
        }

        let badgeObat = document.getElementById('badge-jenis-obat');
        if (badgeObat) {
            badgeObat.textContent = jumlahJenisObat + ' Jenis';
            badgeObat.classList.remove('hidden');
        }

    }, 50); // Waktu muat dipercepat dari 100ms menjadi 50ms karena data sudah matang
}


// ==========================================
// 6.5. MESIN REKAPITULASI (TUNAI & DIGITAL)
// ==========================================
let metodeRekapAktif = 'Tunai';

function bukaLayarRekapMobile(metode) {
    metodeRekapAktif = metode;
    bukaLayar('rekap');
}

function renderRekapMobile() {
    const wadah = document.getElementById('daftarRekapMobile');
    let waktuMulai = siklusAktif.waktuStart || 0; // KUNCI SHIFT: Membaca jam Tutup Buku terakhir

    // Setting Header
    document.getElementById('judulLayarRekap').textContent = metodeRekapAktif === 'Tunai' ? 'REKAP TUNAI' : 'REKAP DIGITAL';
    document.getElementById('tanggalLayarRekap').textContent = 'Fase Harian (Hari Ini)';

    // FILTER: Hanya transaksi SETELAH Tutup Buku terakhir (Sistem Shift)
    let dataPeriode = cashierHistory.filter(t => t.tanggal === getTanggalLokal() && t.metode === metodeRekapAktif && !t.isPelunasan);

    let rekapItem = {};
    let grandTotalBiji = 0;
    let grandTotalModal = 0;
    let grandTotalJual = 0;

    dataPeriode.forEach(trx => {
        if (trx.detailKeranjang && trx.detailKeranjang.length > 0) {
            trx.detailKeranjang.forEach(item => {
                let idKunci = item.dnaInduk || item.nama;
                let namaLengkap = item.nama + (item.varian ? ` ${item.varian}` : '');

                if(!rekapItem[idKunci]) {
                    rekapItem[idKunci] = { dnaInduk: item.dnaInduk, nama: item.nama, varian: item.varian, kategori: item.kategori, qty: 0, modal: 0, jual: 0 };
                }

                                                let hpp = item.hppSatuan || Math.round(item.jual * 0.8);
                let subModal = item.hppTotalModal !== undefined ? item.hppTotalModal : (hpp * item.qty);
                let subJual = item.jual * item.qty;


                rekapItem[idKunci].qty += item.qty;
                rekapItem[idKunci].modal += subModal;
                rekapItem[idKunci].jual += subJual;

                grandTotalBiji += item.qty;
                grandTotalModal += subModal;
                grandTotalJual += subJual;
            });
        } else {
            let qty = trx.item || 1;
            let hpp = ((trx.total || 0) - (trx.laba || 0));
            let jual = trx.total || 0;

            if(!rekapItem[trx.obat]) {
                rekapItem[trx.obat] = { dnaInduk: null, nama: trx.obat, varian: '', kategori: '', qty: 0, modal: 0, jual: 0 };
            }

            rekapItem[trx.obat].qty += qty;
            rekapItem[trx.obat].modal += hpp;
            rekapItem[trx.obat].jual += jual;

            grandTotalBiji += qty;
            grandTotalModal += hpp;
            grandTotalJual += jual;
        }
    });

    if (Object.keys(rekapItem).length === 0) {
        wadah.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm mt-4"><i class="fa-solid fa-box-open text-4xl text-slate-300 mb-3 block"></i><p class="font-bold text-slate-600">Belum ada penjualan ${metodeRekapAktif} di sesi ini.</p></div>`;
    } else {
        let urut = 1;
        wadah.innerHTML = Object.values(rekapItem).map(r => {
            let infoFormat = formatNamaItemMaster(r.dnaInduk, r.nama, r.varian, r.kategori, 'text-sm');
            return `
            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-start gap-3 relative overflow-hidden">
                <div class="absolute top-0 right-0 w-16 h-16 bg-slate-50 rounded-bl-full -z-0 opacity-50"></div>
                <div class="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-black text-xs shrink-0 border border-slate-200 relative z-10">${urut++}</div>
                <div class="flex-1 relative z-10">
                    <div class="mb-2">
                        ${infoFormat.namaHtml}
                        <div class="mt-1">${infoFormat.kategoriHtml}</div>
                    </div>
                    <p class="text-[11px] font-bold text-slate-600 leading-relaxed">
                        <span class="bg-slate-100 px-2 py-0.5 rounded text-slate-700">${r.qty} Biji</span> <span class="text-slate-300 mx-0.5">|</span>
                        Modal: <span class="text-red-500">${rupiah(r.modal)}</span> <span class="text-slate-300 mx-0.5">|</span>
                        Jual: <span class="text-emerald-600">${rupiah(r.jual)}</span>
                    </p>
                </div>
            </div>`;
        }).join('');
    }

    document.getElementById('rekapTotalBiji').textContent = grandTotalBiji + " Biji";
    document.getElementById('rekapTotalModal').textContent = rupiah(grandTotalModal);
    document.getElementById('rekapTotalJual').textContent = rupiah(grandTotalJual);
}


// ==========================================
// 7. MESIN MODAL UMUM
// ==========================================
let idBatchAktif = null;

function bukaModalMobile(idModal, idPanel) {
    const modal = document.getElementById(idModal);
    const panel = document.getElementById(idPanel);

    // --- PENYEMPURNAAN UX: Paksa scroll kembali ke paling atas ---
    const areaScroll = panel.querySelector('.overflow-y-auto');
    if (areaScroll) areaScroll.scrollTop = 0;
    // -------------------------------------------------------------

    // --- KABEL RESET OTOMATIS JENDELA KAS KELUAR ---
    if (idModal === 'modalPengeluaranMobile') {
        let opsiTunai = document.querySelector('input[name="sumberDanaPengeluaran"][value="Tunai"]');
        if(opsiTunai) opsiTunai.checked = true;
    }
    // -----------------------------------------------

    modal.classList.remove('hidden');
    setTimeout(() => { panel.classList.remove('translate-y-full'); }, 10);
}


function tutupModalMobile(idModal) {
    const modal = document.getElementById(idModal); const panel = modal.querySelector('.transform.transition-transform');
    
    // --- SENSOR SAPU BERSIH POP-UP DI DALAM MODAL ---
    let dKasir = document.getElementById('dropdownKasirList');
    if (dKasir) dKasir.classList.add('hidden');
    document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.classList.add('hidden'));
    document.querySelectorAll('.custom-dropdown-icon').forEach(i => i.style.transform = 'rotate(0deg)');
    // ------------------------------------------------

    if(panel) panel.classList.add('translate-y-full'); setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

// ==========================================
// 8. MESIN TRANSFER GUDANG KE ETALASE
// ==========================================
let dnaIndukTransferAktif = null;

function bukaModalTransferMobile(dnaInduk) {
    dnaIndukTransferAktif = dnaInduk;
    let batches = masterItems.filter(i => i.dnaInduk === dnaInduk);

    if(batches.length > 0) {
         let namaObat = batches[0].nama;
        let totalStok = batches.reduce((sum, b) => sum + b.stok, 0);

        document.getElementById('transferNamaObat').textContent = namaObat;
         document.getElementById('transferSisaGudang').textContent = totalStok;
         document.getElementById('transferInputQty').value = '';
         bukaModalMobile('modalTransferMobile', 'panelTransferMobile');
         setTimeout(() => document.getElementById('transferInputQty').focus(), 350);
     }
}

function prosesTransferMobile() {
    let inputQty = parseInt(document.getElementById('transferInputQty').value);
    if(isNaN(inputQty) || inputQty <= 0) return alert("Masukkan jumlah yang benar!");

    let batchesGudang = masterItems.filter(i => i.dnaInduk === dnaIndukTransferAktif && i.stok > 0);
    let totalStokGudang = batchesGudang.reduce((sum, b) => sum + b.stok, 0);
    if(inputQty > totalStokGudang) return alert("Gagal! Sisa total di gudang tidak cukup.");

  let namaObat = batchesGudang[0].nama;
    let kategoriObat = batchesGudang[0].kategori;
    let jualObat = batchesGudang[0].jual;
    let varianObat = batchesGudang[0].varian;

    transferStokKeEtalase(dnaIndukTransferAktif, inputQty, namaObat, kategoriObat, jualObat, varianObat);

    saveApotekDB('apotek_masterItems', masterItems);
    saveApotekDB('apotek_etalaseItems', etalaseItems);
    tutupModalMobile('modalTransferMobile');
    renderGudangMobile(document.getElementById('cariGudangMobile').value);
    renderBerandaMobile();
    triggerHaptic([100, 50, 100]);
    alert("📦 " + inputQty + " " + namaObat + " berhasil dipindah ke Etalase!");
}

// ==========================================
// 9. MESIN EDIT MULTI-BATCH & KUNCI
// ==========================================
let currentEditBatchesMobile = [];
let activeEditBatchIndexMobile = 0;
let isAddingNewBatchMobile = false;

function bukaModalEditMobile(idBatch) {
    modeEditKeranjangIndex = null; // Matikan saklar edit penampungan
    idBatchAktif = idBatch;
let barang = masterItems.find(i => i.idBatch === idBatch);

    if(barang) {
        currentEditBatchesMobile = masterItems.filter(m => m.dnaInduk === barang.dnaInduk);
        currentEditBatchesMobile.sort((a, b) => a.idBatch.localeCompare(b.idBatch));
        activeEditBatchIndexMobile = currentEditBatchesMobile.findIndex(b => b.idBatch === idBatch);
        if(activeEditBatchIndexMobile === -1) activeEditBatchIndexMobile = 0;
        isAddingNewBatchMobile = false;

        renderEditTabsMobile();
        loadFormEditBatchMobile();
        kunciFormEditMobile();
        bukaModalMobile('modalEditMobile', 'panelEditMobile');
    }
}

function renderEditTabsMobile() {
    let html = currentEditBatchesMobile.map((b, index) => {
        // Desain Kapsul Menyala (Aktif) vs Redup (Tidak Aktif)
        let isActive = (!isAddingNewBatchMobile && index === activeEditBatchIndexMobile) 
            ? 'bg-white text-blue-700 shadow-sm border border-slate-200/80 rounded-lg' 
            : 'text-slate-500 border border-transparent hover:bg-slate-200/50 hover:text-slate-700 rounded-lg';
        return `<button type="button" onclick="pindahTabEditMobile(${index})" class="whitespace-nowrap px-4 py-2.5 text-xs font-black transition-all duration-300 ${isActive}">Batch ${index + 1}</button>`;
    }).join('');

    // Tombol Tambah Stok dengan tema Emerald jika Aktif
    let addActive = isAddingNewBatchMobile 
        ? 'bg-white text-emerald-600 shadow-sm border border-slate-200/80 rounded-lg' 
        : 'text-slate-500 border border-transparent hover:bg-slate-200/50 hover:text-slate-700 rounded-lg';
    html += `<button type="button" onclick="siapkanBatchBaruMobile()" class="whitespace-nowrap px-4 py-2.5 text-xs font-black transition-all duration-300 flex items-center gap-1.5 ${addActive}"><i class="fa-solid fa-plus ${isAddingNewBatchMobile ? 'text-emerald-500' : 'text-slate-400'}"></i> Tambah Stok</button>`;

    document.getElementById('editBatchNavMobile').innerHTML = html;
}

function pindahTabEditMobile(index) {
    modeEditKeranjangIndex = null;
    isAddingNewBatchMobile = false; activeEditBatchIndexMobile = index;
    idBatchAktif = currentEditBatchesMobile[index].idBatch;
    renderEditTabsMobile(); loadFormEditBatchMobile(); kunciFormEditMobile();
}

// ==========================================
// MESIN UI CUSTOM DROPDOWN (AMAN DARI CRASH)
// ==========================================
function toggleDropdownCustom(idKey) {
    const menu = document.getElementById('menu_' + idKey);
    const icon = document.getElementById('icon_' + idKey);
    if (menu.classList.contains('hidden')) {
        document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.classList.add('hidden'));
        document.querySelectorAll('.custom-dropdown-icon').forEach(i => i.style.transform = 'rotate(0deg)');
        menu.classList.remove('hidden');
        if(icon) icon.style.transform = 'rotate(180deg)';
    } else {
        menu.classList.add('hidden');
        if(icon) icon.style.transform = 'rotate(0deg)';
    }
}

function pilihDropdownCustom(idKey, nilaiKode, teksTampil, isManual = false) {
    document.getElementById(idKey).value = nilaiKode; // Mengisi Nilai Rahasia (Aman untuk Logika)
    setDropdownUIManual(idKey, teksTampil); // Mengubah Tampilan Kasir
    toggleDropdownCustom(idKey); // Menutup Menu

    if (idKey === 'tambahKategoriMobile') {
        let inputKustom = document.getElementById('tambahKategoriKustom');
        if(isManual) { inputKustom.classList.remove('hidden'); inputKustom.focus(); }
        else { inputKustom.classList.add('hidden'); inputKustom.value = ''; }
    } else if (idKey === 'editKategoriMobile') {
        let inputKustom = document.getElementById('editKategoriKustom');
        if(isManual) { inputKustom.classList.remove('hidden'); inputKustom.focus(); }
        else { inputKustom.classList.add('hidden'); inputKustom.value = ''; }
    } else if (idKey === 'tambahSatuanEceran' || idKey === 'tambahSatuanBesar') {
        kalkulasiTambahObatCerdas();
    } else if (idKey === 'editSatuanEceran' || idKey === 'editSatuanBesar') {
        kalkulatorEditBatchMobile();
    }
}

function setDropdownUIManual(idKey, teksTampil) {
    const btn = document.getElementById('btn_' + idKey);
    const teks = document.getElementById('teks_' + idKey);
    if(!teks) return;
    teks.innerHTML = teksTampil;
    teks.className = 'truncate font-black text-slate-800 text-sm'; // Teks berubah jadi hitam tebal!

    // Perubahan Warna Kotak JIKA itu Satuan Eceran/Besar
    if(idKey.includes('SatuanEceran') || idKey.includes('SatuanBesar')) {
         btn.classList.add('bg-[#eef5ef]', 'border-[#b2d5bb]');
         btn.classList.remove('bg-white', 'bg-slate-50', 'border-slate-200');
    } else {
         btn.classList.add('bg-white');
         btn.classList.remove('bg-slate-50');
    }
}

function resetDropdownUI(idKey, placeholderHtml, isEditMode = false) {
    const btn = document.getElementById('btn_' + idKey);
    const teks = document.getElementById('teks_' + idKey);
    if(!teks || !btn) return;
    document.getElementById(idKey).value = ''; // Kosongkan Nilai Mesin
    teks.innerHTML = placeholderHtml;
    teks.className = 'truncate text-slate-400 text-xs'; // Teks kembali abu-abu buram (Placeholder)

    btn.classList.remove('bg-[#eef5ef]', 'border-[#b2d5bb]', 'bg-white');
    if(isEditMode) btn.classList.add('bg-slate-50', 'border-slate-200');
    else btn.classList.add('bg-white', 'border-slate-200');
}

// FUNGSI INI DIBANGUN ULANG AGAR TIDAK CRASH SAAT EDIT OBAT
function isiKategoriEditCerdas(kategori) {
    let inputSelect = document.getElementById('editKategoriMobile');
    let inputKustom = document.getElementById('editKategoriKustom');
    let opsiStandar = ['Sakit Kepala', 'Vitamin', 'Sirup', 'Analgesik', 'Antibiotik', 'Salep'];

    if (kategori && !opsiStandar.includes(kategori) && kategori !== 'kustom') {
        inputSelect.value = 'kustom';
        inputKustom.value = kategori;
        inputKustom.classList.remove('hidden');
        setDropdownUIManual('editKategoriMobile', 'Tulis Manual');
    } else {
        inputSelect.value = kategori || '';
        inputKustom.value = '';
        inputKustom.classList.add('hidden');
        if(kategori) setDropdownUIManual('editKategoriMobile', kategori);
        else resetDropdownUI('editKategoriMobile', 'Contoh: <i>Vitamin</i>', true);
    }
}


function siapkanBatchBaruMobile() {
    modeEditKeranjangIndex = null;
    isAddingNewBatchMobile = true; renderEditTabsMobile();
    let referensi = currentEditBatchesMobile[0];

    if(document.getElementById('editQtyBeli')) {
        document.getElementById('editQtyBeli').value = '';
        document.getElementById('editModalKotor').value = '';
        document.getElementById('editIsiPerBox').value = '';
        document.getElementById('editToggleGrosir').checked = false;

        // PERBAIKAN BUG VISUAL: Sinkronisasi Dropdown Custom UI
        let ecerAwal = (referensi.riwayatAsal && referensi.riwayatAsal.satuanEcer) ? referensi.riwayatAsal.satuanEcer : '';
        if (ecerAwal) {
            document.getElementById('editSatuanEceran').value = ecerAwal;
            setDropdownUIManual('editSatuanEceran', ecerAwal);
        } else {
            resetDropdownUI('editSatuanEceran', 'Contoh: <i>Strip</i>', true);
        }
        resetDropdownUI('editSatuanBesar', 'Contoh: <i>Box</i>', true);

        kalkulatorEditBatchMobile();
    }

    document.getElementById('editNamaMobile').value = referensi.nama;
    document.getElementById('editVarianMobile').value = referensi.varian || '';
    isiKategoriEditCerdas(referensi.kategori);
    document.getElementById('editModalMobile').value = '';
    document.getElementById('editJualMobile').value = referensi.jual;
    document.getElementById('editStokMobile').value = '';
    document.getElementById('editExpiredMobile').value = '';

    let opsiPribadiEd1 = document.querySelector('input[name="sumberDanaKulakanEdit"][value="Pribadi"]');
    if (opsiPribadiEd1) opsiPribadiEd1.checked = true;

    aktifkanModeEditMobile();

    let btnAksi = document.getElementById('btnAksiEditMobile');
    btnAksi.innerHTML = '<i class="fa-solid fa-plus-circle text-lg"></i> Simpan Batch Baru';
    btnAksi.className = 'w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-500/30 transition-transform active:scale-95 flex items-center justify-center gap-2 text-sm uppercase tracking-wider';
}

function loadFormEditBatchMobile() {
    let barang = currentEditBatchesMobile[activeEditBatchIndexMobile];
    document.getElementById('editNamaMobile').value = barang.nama;
    document.getElementById('editVarianMobile').value = barang.varian || '';
    isiKategoriEditCerdas(barang.kategori);
    document.getElementById('editModalMobile').value = barang.modal;
    document.getElementById('editJualMobile').value = barang.jual;
    document.getElementById('editStokMobile').value = barang.stok;
    document.getElementById('editExpiredMobile').value = barang.expired || '';

    if(barang.riwayatAsal) {
        document.getElementById('editToggleGrosir').checked = barang.riwayatAsal.isGrosir;
        document.getElementById('editQtyBeli').value = barang.riwayatAsal.qtyBeli || '';
        document.getElementById('editIsiPerBox').value = barang.riwayatAsal.isiPerBox || '';

        // PERBAIKAN BUG VISUAL: Sinkronisasi Dropdown Custom UI
        if(barang.riwayatAsal.satuanBesar) {
            document.getElementById('editSatuanBesar').value = barang.riwayatAsal.satuanBesar;
            setDropdownUIManual('editSatuanBesar', barang.riwayatAsal.satuanBesar);
        } else {
            resetDropdownUI('editSatuanBesar', 'Contoh: <i>Box</i>', true);
        }

        if(barang.riwayatAsal.satuanEcer) {
            document.getElementById('editSatuanEceran').value = barang.riwayatAsal.satuanEcer;
            setDropdownUIManual('editSatuanEceran', barang.riwayatAsal.satuanEcer);
        } else {
            resetDropdownUI('editSatuanEceran', 'Contoh: <i>Strip</i>', true);
        }

        let modalKotorLoaded = barang.riwayatAsal.isGrosir ? (barang.modal * barang.riwayatAsal.isiPerBox) : barang.modal;
        document.getElementById('editModalKotor').value = modalKotorLoaded > 0 ? modalKotorLoaded.toLocaleString('id-ID').replace(/,/g, '.') : '';
    } else {
        document.getElementById('editToggleGrosir').checked = false;
        document.getElementById('editQtyBeli').value = '';
        document.getElementById('editIsiPerBox').value = '';
        document.getElementById('editModalKotor').value = '';

        resetDropdownUI('editSatuanBesar', 'Contoh: <i>Box</i>', true);
        resetDropdownUI('editSatuanEceran', 'Contoh: <i>Strip</i>', true);
    }
    kalkulatorEditBatchMobile();
}

function kunciFormEditMobile() {
    let formInputs = document.querySelectorAll('#panelEditMobile input:not([type="hidden"]), #panelEditMobile select');
    formInputs.forEach(input => {
        if(input.type === 'checkbox' || input.type === 'radio') {
            input.disabled = true;
        } else {
            input.readOnly = true;
        }
        input.classList.add('bg-slate-100', 'text-slate-500');
        input.classList.remove('bg-white', 'text-slate-800', 'bg-slate-50', 'bg-[#eef5ef]', 'text-[#274f31]');
    });

    let toggleGrosir = document.getElementById('editToggleGrosir');
    if (toggleGrosir) toggleGrosir.parentElement.classList.add('opacity-50', 'grayscale', 'pointer-events-none');

    let customBtns = document.querySelectorAll('#panelEditMobile .custom-dropdown-btn');  customBtns.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('bg-slate-100', 'text-slate-500');
        btn.classList.remove('bg-white', 'bg-slate-50', 'bg-[#eef5ef]', 'border-[#b2d5bb]');
    });

    document.getElementById('teksHeaderKunciEdit').innerHTML = '<i class="fa-solid fa-pen text-blue-300"></i> Edit Data Obat';
    document.getElementById('subTeksHeaderKunci').innerHTML = 'Mode Terkunci 🔒 (Ketuk untuk Edit)';
    document.getElementById('btnHeaderKunciEdit').classList.replace('from-amber-500', 'from-blue-600');
    document.getElementById('btnHeaderKunciEdit').classList.replace('to-orange-600', 'to-indigo-700');

    let btnJual = document.getElementById('btnUbahJualMobile');
    if (btnJual) btnJual.classList.add('hidden');

    let btnAksi = document.getElementById('btnAksiEditMobile');
    btnAksi.innerHTML = 'Tutup Layar';
    btnAksi.className = 'w-full bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-transform active:scale-95 text-sm uppercase tracking-wider';
}

function aktifkanModeEditMobile() {
    // 1. BUKA SEMUA DULU (Sebagai Dasar/Baseline)
    let formInputs = document.querySelectorAll('#panelEditMobile input:not([type="hidden"]), #panelEditMobile select');
    formInputs.forEach(input => {
        if(input.type !== 'checkbox' && input.type !== 'radio') { input.readOnly = false; }
        input.disabled = false; // Buka disable pada checkbox/radio
        input.classList.remove('bg-slate-100', 'text-slate-500', 'bg-slate-200');
        input.classList.add('bg-white', 'text-slate-800');
    });

    let toggleGrosir = document.getElementById('editToggleGrosir');
    if (toggleGrosir) toggleGrosir.parentElement.classList.remove('opacity-50', 'grayscale', 'pointer-events-none');

    let customBtns = document.querySelectorAll('#panelEditMobile .custom-dropdown-btn');    customBtns.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('bg-slate-100', 'bg-slate-200', 'text-slate-500');
        let hiddenInput = document.getElementById(btn.id.replace('btn_', ''));
        if(hiddenInput && hiddenInput.value !== '') {
            if(btn.id.includes('Satuan')) btn.classList.add('bg-[#eef5ef]', 'border-[#b2d5bb]');
            else btn.classList.add('bg-white');
        } else {
            btn.classList.add('bg-slate-50');
        }
    });

    // 2. EKSEKUSI PEMBELAH LOGIKA BATCH LAMA VS BATCH BARU
    if (isAddingNewBatchMobile) {
        // --- MODE BATCH BARU (KULAKAN FAKTUR) ---
        // KUNCI: Nama, Varian, Kategori, Satuan Eceran, Modal HPP, Stok Gudang
        document.getElementById('editNamaMobile').readOnly = true; document.getElementById('editNamaMobile').classList.add('bg-slate-200','text-slate-500');
        document.getElementById('editVarianMobile').readOnly = true; document.getElementById('editVarianMobile').classList.add('bg-slate-200','text-slate-500');

        let btnKat = document.getElementById('btn_editKategoriMobile');
        if(btnKat) { btnKat.disabled = true; btnKat.classList.add('bg-slate-200','text-slate-500'); btnKat.classList.remove('bg-white'); }

        let btnSatEcer = document.getElementById('btn_editSatuanEceran');
        if(btnSatEcer) { btnSatEcer.disabled = true; btnSatEcer.classList.add('bg-slate-200','text-slate-500'); btnSatEcer.classList.remove('bg-[#eef5ef]', 'border-[#b2d5bb]', 'bg-white'); }

        document.getElementById('editModalMobile').readOnly = true; document.getElementById('editModalMobile').classList.add('bg-slate-200','text-slate-500');
        document.getElementById('editStokMobile').readOnly = true; document.getElementById('editStokMobile').classList.add('bg-slate-200','text-slate-500');
        // Logika Saldo: Matikan opsi jika Laci/Bank kosong
        let opsiTunai = document.querySelector('input[name="sumberDanaKulakanEdit"][value="Tunai"]');
        if (opsiTunai && hitungSaldoLaciFisik() <= 0) {
            opsiTunai.disabled = true; opsiTunai.parentElement.classList.add('opacity-40', 'grayscale', 'pointer-events-none');
        }
        let opsiQris = document.querySelector('input[name="sumberDanaKulakanEdit"][value="QRIS"]');
        if (opsiQris && hitungSaldoQRIS() <= 0) {
            opsiQris.disabled = true; opsiQris.parentElement.classList.add('opacity-40', 'grayscale', 'pointer-events-none');
        }

        // Harga Jual dibiarkan terbuka (Sudah dibongkar di Baseline)
        let btnJual = document.getElementById('btnUbahJualMobile');
        if (btnJual) btnJual.classList.add('hidden');

    } else {
        // --- MODE EDIT BATCH LAMA (STRICT ACCOUNTING) ---
        // KUNCI MUTLAK: Toggle Grosir, Input Pembelian/Konversi, Modal Kotor, Modal Ecer, Sumber Anggaran, SISA STOK

        // 1. Kunci Sisa Stok
        document.getElementById('editStokMobile').readOnly = true;
        document.getElementById('editStokMobile').classList.add('bg-slate-200','text-slate-500');

        // 2. Kunci Modal dan Konversi
        document.getElementById('editToggleGrosir').disabled = true;
        document.getElementById('editQtyBeli').readOnly = true; document.getElementById('editQtyBeli').classList.add('bg-slate-200','text-slate-500');

        let btnSatBesar = document.getElementById('btn_editSatuanBesar');
        if(btnSatBesar) { btnSatBesar.disabled = true; btnSatBesar.classList.add('bg-slate-200','text-slate-500'); btnSatBesar.classList.remove('bg-white'); }

        document.getElementById('editIsiPerBox').readOnly = true; document.getElementById('editIsiPerBox').classList.add('bg-slate-200','text-slate-500');
        document.getElementById('editModalKotor').readOnly = true; document.getElementById('editModalKotor').classList.add('bg-slate-200','text-slate-500');

        let btnSatEcer = document.getElementById('btn_editSatuanEceran');
        if(btnSatEcer) { btnSatEcer.disabled = true; btnSatEcer.classList.add('bg-slate-200','text-slate-500'); btnSatEcer.classList.remove('bg-[#eef5ef]', 'border-[#b2d5bb]', 'bg-white'); }

        document.getElementById('editModalMobile').readOnly = true; document.getElementById('editModalMobile').classList.add('bg-slate-200','text-slate-500');

        // 3. Paksa Sumber Dana ke Uang Pribadi dan Kunci Mati
        let opsiPribadi = document.querySelector('input[name="sumberDanaKulakanEdit"][value="Pribadi"]');
        if(opsiPribadi) opsiPribadi.checked = true;
        document.querySelectorAll('input[name="sumberDanaKulakanEdit"]').forEach(radio => {
            radio.disabled = true;
            radio.parentElement.classList.add('opacity-50', 'grayscale', 'pointer-events-none');
        });

        // 4. Harga Jual dibiarkan terbuka (Sudah dibongkar di Baseline)
        let btnJual = document.getElementById('btnUbahJualMobile');
        if (btnJual) btnJual.classList.add('hidden');
    }

    // 3. Update Visual Teks & Tombol
    document.getElementById('teksHeaderKunciEdit').innerHTML = '<i class="fa-solid fa-lock-open text-amber-200"></i> Edit Terbuka';
    document.getElementById('subTeksHeaderKunci').innerHTML = 'Mode Edit Aktif ✍️';
    document.getElementById('btnHeaderKunciEdit').classList.replace('from-blue-600', 'from-amber-500');
    document.getElementById('btnHeaderKunciEdit').classList.replace('to-indigo-700', 'to-orange-600');
    let btnAksi = document.getElementById('btnAksiEditMobile');
    btnAksi.innerHTML = '<i class="fa-solid fa-save text-lg"></i> Simpan Perubahan';
    btnAksi.className = 'w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-600/30 transition-transform active:scale-95 flex items-center justify-center gap-2 text-sm uppercase tracking-wider';
}


function bukaKunciHargaJualMobile() {
    let inputJual = document.getElementById('editJualMobile');
    inputJual.readOnly = false;
    inputJual.classList.remove('bg-slate-200', 'text-slate-500');
    inputJual.classList.add('bg-white', 'text-slate-900');
    inputJual.focus();
    let btnJual = document.getElementById('btnUbahJualMobile'); if(btnJual) btnJual.classList.add('hidden');
}

function prosesTombolAksiEditMobile() {
    let btnAksi = document.getElementById('btnAksiEditMobile');
    if (btnAksi.innerHTML.includes('Tutup Layar')) { tutupModalMobile('modalEditMobile'); }
    else { simpanEditLanjutanMobile(); }
}

function eksekusiSimpanEditLanjutanMobile(isKulakanBaru, nBaru, vBaru, kBaru, mBaru, jBaru, sBaru, expBaru, selisihStok, riwayatAsalBaru, hppPresisi) {
    let referensi = currentEditBatchesMobile[0];
    let barang = masterItems.find(i => i.idBatch === idBatchAktif);

    // --- SAKLAR RESET KULAKAN BARU ---
    let qtySuntikan = isAddingNewBatchMobile ? sBaru : selisihStok;

       if (isKulakanBaru || isAddingNewBatchMobile) {      let nilaiSuntikanMutlak = Math.round(qtySuntikan * hppPresisi);

        // [PERBAIKAN BUG TAHAP 1] - LOGIKA DETEKTOR kulakan UNTUK EDIT
        let batchAda = masterItems.find(m => m.dnaInduk === referensi.dnaInduk && m.expired === expBaru);

        if (batchAda) {
            // BATCH SUDAH ADA (TGL EXP SAMA) -> Buka Kamar kulakan!
            if (!batchAda.kulakan_keuangan) batchAda.kulakan_keuangan = [];

            // ✅ KABEL 1 & 2 DIPERBAIKI: Mesin mencari berdasarkan HPP & 3 Syarat Kemasan Mutlak
            let kulakanAda = batchAda.kulakan_keuangan.find(f => {
                let rLama = f.riwayatAsal || {};
                let rBaru = riwayatAsalBaru || {};
                return f.hpp === hppPresisi && rLama.isGrosir === rBaru.isGrosir && rLama.satuanBesar === rBaru.satuanBesar && rLama.isiPerBox === rBaru.isiPerBox;
            });

            if (kulakanAda) {
                kulakanAda.stokAwal += qtySuntikan;
                kulakanAda.sisaGudang += qtySuntikan;
                kulakanAda.modalKeluar += nilaiSuntikanMutlak;

                // --- INJEKSI KABEL BARU: AKUMULASI RIWAYAT KULAKAN (Hanya Menambah Qty Beli krn kemasan sudah pasti sama) ---
                if (kulakanAda.riwayatAsal && riwayatAsalBaru) {
                    kulakanAda.riwayatAsal.qtyBeli += (parseFloat(riwayatAsalBaru.qtyBeli) || 0);
                } else {
                    kulakanAda.riwayatAsal = JSON.parse(JSON.stringify(riwayatAsalBaru));
                }
            } else {
                batchAda.kulakan_keuangan.push({
                    idkulakan: "F-" + Date.now() + Math.floor(Math.random() * 100),
                    tanggalNota: getTanggalLokal(),
                    hpp: hppPresisi,
                    stokAwal: qtySuntikan,
                    sisaGudang: qtySuntikan,
                    sisaEtalase: 0,
                    modalKeluar: nilaiSuntikanMutlak,
                    riwayatAsal: JSON.parse(JSON.stringify(riwayatAsalBaru))
                });
            }
            batchAda.stok += qtySuntikan;
            batchAda.totalModal += nilaiSuntikanMutlak;
            batchAda.modal = mBaru;
            // PERBAIKAN BUG: Dilarang menimpa batchAda.riwayatAsal agar identitas Induk Batch tetap utuh!
            alert("📦 Sukses! Kulakan baru telah dirakit ke dalam Batch yang sama secara presisi.");
        } else {
            // BATCH BENAR-BENAR BARU
            const idBatchBaru = 'B-' + Date.now() + '-' + Math.floor(Math.random()*1000);
            masterItems.unshift({
                idBatch: idBatchBaru, dnaInduk: referensi.dnaInduk, barcode: referensi.barcode, qrcode: referensi.qrcode,
                nama: nBaru, varian: vBaru, keterangan: '', kategori: kBaru, modal: mBaru, jual: jBaru, stok: qtySuntikan, expired: expBaru,
                totalModal: nilaiSuntikanMutlak, riwayatAsal: riwayatAsalBaru,
                kulakan_keuangan: [{
                    idkulakan: "F-" + Date.now(), tanggalNota: getTanggalLokal(),
                    hpp: hppPresisi, // ✅ KABEL 1 DIPERBAIKI
                    stokAwal: qtySuntikan,
                    sisaGudang: qtySuntikan, sisaEtalase: 0, modalKeluar: nilaiSuntikanMutlak,
                    riwayatAsal: JSON.parse(JSON.stringify(riwayatAsalBaru))
                }]
            });

                    if(!isAddingNewBatchMobile) alert("📦 Sukses! Sistem otomatis merakitkan Batch Kulakan Baru di Gudang.");
            else alert("📦 Sukses! Batch baru berhasil ditambahkan.");
        }

                // --- SAKLAR DANA BOS (KULAKAN LANGSUNG) ---
        catatMutasiSiklus('KULAKAN_TAMBAH', nilaiSuntikanMutlak, qtySuntikan);
    } else {
            // STRICT ACCOUNTING: MURNI KOREKSI IDENTITAS & HARGA (STOK DAN HPP TERKUNCI MATI)
            barang.jual = jBaru;
            barang.expired = expBaru;
            // Identitas master (nama, varian, kategori) diupdate di blok masterItems global di bawah.
            // HPP, Stok, totalModal, dan riwayatAsal TIDAK DISENTUH SAMA SEKALI.

            alert("✅ Identitas dan Harga Jual berhasil diperbarui!");
        }


    masterItems.forEach(m => {
        if (m.dnaInduk === referensi.dnaInduk) {
             m.nama = nBaru; m.varian = vBaru; m.kategori = kBaru; m.jual = jBaru;
         }
    });

    let bEtalase = etalaseItems.find(i => i.dnaInduk === referensi.dnaInduk || i.nama === referensi.nama);
    if(bEtalase) {
         bEtalase.dnaInduk = referensi.dnaInduk; bEtalase.nama = nBaru; bEtalase.varian = vBaru; bEtalase.kategori = kBaru; bEtalase.jual = jBaru;
    }

    saveApotekDB('apotek_masterItems', masterItems);
    saveApotekDB('apotek_etalaseItems', etalaseItems);
    saveApotekDB('apotek_siklusAktif', siklusAktif);

    tutupModalMobile('modalEditMobile'); renderGudangMobile(document.getElementById('cariGudangMobile').value); renderBerandaMobile();
}


function simpanEditLanjutanMobile() {
    let nBaru = document.getElementById('editNamaMobile').value;
    let vBaru = document.getElementById('editVarianMobile').value;

    let kBaru = document.getElementById('editKategoriMobile').value;
    if (kBaru === 'kustom') {
        kBaru = document.getElementById('editKategoriKustom').value.trim();
        if (!kBaru) return alert('⚠️ Kategori manual tidak boleh kosong!');
    }

    let jBaru = parseInt(document.getElementById('editJualMobile').value);
    let expBaru = document.getElementById('editExpiredMobile').value;
    let satEcer = document.getElementById('editSatuanEceran').value;

    let barang = masterItems.find(i => i.idBatch === idBatchAktif);

    // STRICT ACCOUNTING: Kunci Backend untuk Stok & HPP
    let mBaru = 0, sBaru = 0;
    if (isAddingNewBatchMobile) {
        mBaru = parseInt(document.getElementById('editModalMobile').value);
        sBaru = parseInt(document.getElementById('editStokMobile').value);
    } else {
        mBaru = barang ? barang.modal : 0;
        sBaru = barang ? barang.stok : 0;
    }

    if(!satEcer) return alert("⚠️ Satuan Eceran wajib dipilih!");
    if(!nBaru || isNaN(mBaru) || isNaN(jBaru) || isNaN(sBaru) || mBaru < 0 || jBaru < 0 || sBaru < 0) return alert("⚠️ AKSES DITOLAK: Pastikan Nama dan semua kolom Harga/Stok terisi angka positif yang valid (Angka minus dilarang)!");
    if(mBaru >= jBaru) return alert("Peringatan: Harga Jual tidak boleh lebih kecil/sama dengan Harga Modal.");

    const isGrosir = document.getElementById('editToggleGrosir').checked;
    const qtyBeliAwal = parseFloat(document.getElementById('editQtyBeli').value) || 0;
    const satBesar = document.getElementById('editSatuanBesar').value || 'Box';
    const isiPerSatuan = parseFloat(document.getElementById('editIsiPerBox').value) || 1;
    let riwayatAsalBaru = { isGrosir: isGrosir, satuanEcer: satEcer, satuanBesar: satBesar, qtyBeli: qtyBeliAwal, isiPerBox: isiPerSatuan };

    let modalRaw = document.getElementById('editModalKotor').value.replace(/\./g, '');
    let modalKotor = parseFloat(modalRaw) || 0;
    let hppPresisi = isGrosir ? (modalKotor / (isiPerSatuan || 1)) : modalKotor;
    if (modalKotor === 0) hppPresisi = mBaru;

    let referensi = currentEditBatchesMobile[0];
    let hargaJualLama = referensi.jual;

    // STRICT ACCOUNTING: Selisih stok mutlak 0 jika bukan nambah batch baru
    let selisihStok = isAddingNewBatchMobile ? sBaru : 0;
    const jalankanPenyimpanan = () => {
                if (selisihStok > 0) {
            // --- MASUK KERANJANG PENAMPUNGAN (KULAKAN TAMBAH STOK) ---
            let sumberDanaDipilih = 'Pribadi';  let tagihanMutlak = Math.round(selisihStok * hppPresisi);
            let isKulakanBaru = isAddingNewBatchMobile || ((expBaru || '') !== (barang.expired || '') || mBaru !== barang.modal);

            let itemAntrean = {
                idTunggu: 'T-' + Date.now(), sumber: 'EDIT_STOK',
                namaLengkap: nBaru + (vBaru ? ' ' + vBaru : ''),
                tagihan: tagihanMutlak, sumberDana: sumberDanaDipilih, qty: selisihStok, satEcer: satEcer,
  payload: {
                    isAddingNewBatchMobile: isAddingNewBatchMobile,
                    isKulakanBaru: isKulakanBaru,
                    idBatchAktif: idBatchAktif,
                    dnaInduk: referensi.dnaInduk, barcode: referensi.barcode, qrcode: referensi.qrcode,
                    nBaru: nBaru, vBaru: vBaru, kBaru: kBaru, mBaru: mBaru, jBaru: jBaru, sBaru: sBaru, expBaru: expBaru, selisihStok: selisihStok, riwayatAsalBaru: riwayatAsalBaru, hppPresisi: hppPresisi, tagihanMutlak: tagihanMutlak
                }
            };

                        if (modeEditKeranjangIndex !== null) {
                itemAntrean.idTunggu = antreanKulakan[modeEditKeranjangIndex].idTunggu;
                antreanKulakan[modeEditKeranjangIndex] = itemAntrean;
                modeEditKeranjangIndex = null;
                saveApotekDB('apotek_antreanKulakan', antreanKulakan);
                tutupModalMobile('modalEditMobile');
                renderBadgeAntreanKulakan();
                triggerHaptic(100);
                alert('🛒 Data Stok di Keranjang berhasil diperbarui!');
                setTimeout(() => bukaModalAntreanKulakan(), 400);
            } else {
                antreanKulakan.push(itemAntrean);
                saveApotekDB('apotek_antreanKulakan', antreanKulakan);
                tutupModalMobile('modalEditMobile');
                renderBadgeAntreanKulakan();
                triggerHaptic(100);
                alert('🛒 Tambah Stok diparkir di Keranjang Kulakan!\n(Buka troli merah di atas untuk membayar & memasukkannya ke Gudang).');
            }
        } else {
            // --- EKSEKUSI LANGSUNG (EDIT MURNI / KOREKSI KURANGI STOK) ---
            // Tidak melibatkan uang laci karena selisihStok <= 0
            eksekusiSimpanEditLanjutanMobile(false, nBaru, vBaru, kBaru, mBaru, jBaru, sBaru, expBaru, selisihStok, riwayatAsalBaru, hppPresisi);
        }
    };

    if (jBaru !== hargaJualLama) {
        tampilkanConfirmMobile(`⚠️ PENYESUAIAN HARGA JUAL ETALASE\n\nHarga jual obat ini akan diubah menjadi ${rupiah(jBaru)}.\n\nSistem akan MENYAMAKAN harga ini untuk SELURUH stok lama agar seragam di Kasir (Satu Nyawa). HPP/Modal lama Anda dijamin aman. Lanjutkan?`, function() { jalankanPenyimpanan(); });
    } else { jalankanPenyimpanan(); }
}


// ==========================================
// 10. MESIN HAPUS CERDAS (SMART DELETE BATCH)
// ==========================================
let dnaIndukHapusAktif = null;
let namaObatHapusAktif = null;

function bukaModalHapusCerdas(dnaInduk, namaObat) {
    dnaIndukHapusAktif = dnaInduk;
    namaObatHapusAktif = namaObat;

    let batches = masterItems.filter(i => i.dnaInduk === dnaInduk);

    if (batches.length <= 1) {
        prosesHapusObatMobile(dnaInduk, namaObat);
    } else {
        document.getElementById('hapusCerdasNamaObat').textContent = namaObat;
        renderListHapusBatchMobile();
        bukaModalMobile('modalHapusCerdasMobile', 'panelHapusCerdasMobile');
    }
}

function renderListHapusBatchMobile() {
    const list = document.getElementById('listHapusCerdasBodyMobile');
    let batches = masterItems.filter(i => i.dnaInduk === dnaIndukHapusAktif);

    batches.sort((a, b) => a.idBatch.localeCompare(b.idBatch));

    list.innerHTML = batches.map((b, index) => {
        let expText = b.expired ? `<span class="text-red-500 font-bold">${b.expired}</span>` : `<span class="text-slate-400">Tanpa Exp</span>`;
        return `
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex justify-between items-center shadow-sm">
            <div>
                <p class="font-black text-slate-800 text-sm mb-1 uppercase tracking-tight">Batch ${index + 1}</p>
                <p class="text-[10px] text-slate-500 font-medium tracking-wider">Stok Sisa: <span class="font-black text-emerald-600 text-xs">${b.stok}</span> | Exp: ${expText}</p>
            </div>
            <button onclick="prosesHapusBatchSpesifikMobile('${b.idBatch}', ${index + 1})" class="h-10 px-4 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold transition-transform active:scale-95 shadow-sm flex items-center gap-1.5 shrink-0">
                <i class="fa-solid fa-trash-can"></i> Hapus
            </button>
        </div>`;
    }).join('');
}

function prosesHapusBatchSpesifikMobile(idBatch, urutanBatch) {
    tampilkanConfirmMobile(`Hapus permanen Batch ${urutanBatch} dari obat ${namaObatHapusAktif}?\n\nKarena obat ini belum terjual, pembatalan stok ini akan memulihkan data modal Anda di Buku Besar.`, function() {

        let barangYgDihapus = masterItems.find(i => i.idBatch === idBatch);
        if (barangYgDihapus) {
            let qtyBatal = barangYgDihapus.stok || 0;
            let nilaiSuntikan = barangYgDihapus.totalModal !== undefined ? barangYgDihapus.totalModal : ((barangYgDihapus.modal || 0) * qtyBatal);

            // PEMBASMIAN ZOMBIE DI ETALASE & TARIK UANGNYA
            let bEtalase = etalaseItems.find(e => e.dnaInduk === dnaIndukHapusAktif);
            if (bEtalase && bEtalase.antreanFIFO) {
                let fifoTarget = bEtalase.antreanFIFO.find(x => x.idBatch === idBatch);
                if(fifoTarget) {
                    qtyBatal += fifoTarget.stok;
                    nilaiSuntikan += fifoTarget.totalModal !== undefined ? fifoTarget.totalModal : (fifoTarget.stok * fifoTarget.modal);
                }
                bEtalase.antreanFIFO = bEtalase.antreanFIFO.filter(x => x.idBatch !== idBatch);
                bEtalase.stok = bEtalase.antreanFIFO.reduce((sum, x) => sum + x.stok, 0);
                if (bEtalase.stok <= 0) etalaseItems = etalaseItems.filter(e => e.dnaInduk !== dnaIndukHapusAktif);
            }

            if (qtyBatal > 0) {
                catatMutasiSiklus('KULAKAN_BATAL', nilaiSuntikan, qtyBatal);
            }
        }
        masterItems = masterItems.filter(i => i.idBatch !== idBatch);

        saveApotekDB('apotek_masterItems', masterItems);
        saveApotekDB('apotek_etalaseItems', etalaseItems);
        saveApotekDB('apotek_siklusAktif', siklusAktif);

        let sisaBatches = masterItems.filter(i => i.dnaInduk === dnaIndukHapusAktif);
        if (sisaBatches.length === 0) {
            tutupModalMobile('modalHapusCerdasMobile');
        } else {
            renderListHapusBatchMobile();
        }

        // KABEL PELAPOR UPDATE LAYAR REAL-TIME
        let inputCari = document.getElementById('cariGudangMobile');
        renderGudangMobile(inputCari ? inputCari.value : '');
        if (typeof renderBerandaMobile === 'function') renderBerandaMobile();
        if (typeof renderEtalaseMobile === 'function') renderEtalaseMobile();
        if (typeof renderLaporanMobile === 'function') renderLaporanMobile();

        alert(`✅ Batch ${urutanBatch} berhasil dihapus dari sistem tanpa mencatat kerugian.`);
    });
}

function prosesHapusSemuaBatchMobile() {
    tutupModalMobile('modalHapusCerdasMobile');
    setTimeout(() => {
        prosesHapusObatMobile(dnaIndukHapusAktif, namaObatHapusAktif);
    }, 400);
}

function prosesHapusObatMobile(dnaInduk, namaObat) {
    tampilkanConfirmMobile(`Hapus permanen obat ${namaObat} beserta SELURUH BATCH-NYA dari Gudang? Aksi ini tidak dapat dibatalkan.`, function() {

        let qtyTotalHapus = 0;
        let modalTotalHapus = 0;

        // 1. Hitung kerugian dari Gudang
        let batchesYgDihapus = masterItems.filter(i => i.dnaInduk === dnaInduk);
        batchesYgDihapus.forEach(b => {
            qtyTotalHapus += (b.stok || 0);
            modalTotalHapus += b.totalModal !== undefined ? b.totalModal : ((b.modal || 0) * (b.stok || 0));
        });

        // 2. Hitung kerugian dari Etalase (Tarik uang yang menyangkut di etalase)
        let etalaseYgDihapus = etalaseItems.find(i => i.dnaInduk === dnaInduk);
        if (etalaseYgDihapus) {
            qtyTotalHapus += (etalaseYgDihapus.stok || 0);
            if (etalaseYgDihapus.antreanFIFO) {
                etalaseYgDihapus.antreanFIFO.forEach(f => {
                    modalTotalHapus += (f.totalModal !== undefined ? f.totalModal : ((f.modal || 0) * (f.stok || 0)));
                });
            } else {
                modalTotalHapus += ((batchesYgDihapus[0]?.modal || 0) * (etalaseYgDihapus.stok || 0));
            }
        }

        if (qtyTotalHapus > 0) {
            catatMutasiSiklus('KULAKAN_BATAL', modalTotalHapus, qtyTotalHapus);
        }

        // PEMBASMIAN TOTAL (GUDANG & ZOMBIE ETALASE)
        masterItems = masterItems.filter(i => i.dnaInduk !== dnaInduk);
        etalaseItems = etalaseItems.filter(i => i.dnaInduk !== dnaInduk);

        saveApotekDB('apotek_masterItems', masterItems);
        saveApotekDB('apotek_etalaseItems', etalaseItems);
        saveApotekDB('apotek_siklusAktif', siklusAktif);

        // ==========================================================
        // KABEL PELAPOR (MEMAKSA SELURUH PANEL MERESET ANGKA)
        // ==========================================================
        let inputCari = document.getElementById('cariGudangMobile');
        renderGudangMobile(inputCari ? inputCari.value : '');

        if (typeof renderBerandaMobile === 'function') renderBerandaMobile();
        if (typeof renderEtalaseMobile === 'function') renderEtalaseMobile();
        if (typeof renderLaporanMobile === 'function') renderLaporanMobile();
        if (typeof renderPantauanSistem === 'function') renderPantauanSistem();
        // ==========================================================

        alert(`✅ Obat ${namaObat} berhasil dibersihkan dari sistem.`);
    });
}


// ==========================================
// 11. MESIN TAMBAH OBAT BARU (SMART CALCULATOR)
// ==========================================
// --- ASISTEN TAK KASAT MATA: PEMBELAH UANG OTOMATIS (AUTO-SPLIT MULTI SUMBER) ---
function formatAngkaRibuan(inputElement) {
    let rawValue = inputElement.value.replace(/[^0-9]/g, '');
    if(rawValue === '') { inputElement.value = ''; return; }
    inputElement.value = parseInt(rawValue, 10).toLocaleString('id-ID').replace(/,/g, '.');
}

function tampilkanKolomVarianMobile() {
    document.getElementById('wadahVarianMobile').classList.remove('hidden');
}

function toggleKategoriKustomMobile() {
    const selectKategori = document.getElementById('tambahKategoriMobile');
    const inputKustom = document.getElementById('tambahKategoriKustom');

    if (selectKategori.value === 'kustom') {
        inputKustom.classList.remove('hidden');
        inputKustom.focus();
    } else {
        inputKustom.classList.add('hidden');
        inputKustom.value = ''; // Bersihkan input jika kembali ke pilihan standar
    }
}
function toggleKategoriKustomEditMobile() {
    const selectKategori = document.getElementById('editKategoriMobile');
    const inputKustom = document.getElementById('editKategoriKustom');
    if (selectKategori.value === 'kustom') {
        inputKustom.classList.remove('hidden');
        inputKustom.focus();
    } else {
        inputKustom.classList.add('hidden');
        inputKustom.value = '';
    }
}

function bukaModalTambahObatMobile() {
    modeEditKeranjangIndex = null; // Matikan saklar edit penampungan
    // Reset Form Input & Kembalikan Tombol Rekam Ke Bawaan
    document.getElementById('tambahBarcodeMobile').value = ''; document.getElementById('tambahQrcodeMobile').value = '';

    ['tambah_qr', 'tambah_barcode'].forEach(tipe => {
        let btn = document.getElementById('btnUI_' + tipe);
        let teks = document.getElementById('teksUI_' + tipe);
        if(btn && teks) {
            btn.className = "w-12 h-12 bg-white text-[#d97706] rounded-2xl flex flex-col items-center justify-center shrink-0 border border-slate-200 shadow-sm active:scale-95 transition-all gap-0.5";
            teks.classList.add('hidden');
            teks.textContent = "Rekam";
        }
    });

    document.getElementById('tambahNamaMobile').value = ''; document.getElementById('tambahVarianMobile').value = '';

    // RESET UI DROPDOWN CUSTOM (Aman 100%)
    resetDropdownUI('tambahKategoriMobile', 'Contoh: <i>Vitamin</i>');
    resetDropdownUI('tambahSatuanEceran', 'Contoh: <i>Strip</i>');
    resetDropdownUI('tambahSatuanBesar', 'Contoh: <i>Box</i>');
    document.getElementById('tambahKategoriKustom').value = '';

    document.getElementById('tambahQtyBeli').value = ''; document.getElementById('tambahIsiPerSatuan').value = '';
    document.getElementById('tambahToggleBulk').checked = true;
        document.getElementById('tambahModalKotor').value = ''; document.getElementById('tambahJualEceran').value = '';
    document.getElementById('tambahExpiredMobile').value = '';

    document.getElementById('wadahVarianMobile').classList.add('hidden');
    document.getElementById('tambahKategoriKustom').classList.add('hidden');

    kalkulasiTambahObatCerdas();
    bukaModalMobile('modalTambahObatMobile', 'panelTambahObatMobile');
}


// MESIN PENGGERAK LOGIKA (Dipanggil setiap kali user mengetik)
function kalkulasiTambahObatCerdas() {
    let isBulk = document.getElementById('tambahToggleBulk').checked;

    // Ambil Data Input (Buang titik pada uang secara Real-time / FITUR B)
    let satEcer = document.getElementById('tambahSatuanEceran').value || 'Pcs';
    let satBesar = document.getElementById('tambahSatuanBesar').value || 'Box';
    let qtyBeli = parseFloat(document.getElementById('tambahQtyBeli').value) || 0;
    let isiPerSatuan = parseFloat(document.getElementById('tambahIsiPerSatuan').value) || 1;

    // Pembersihan Karakter Titik secara aman sebelum diparsing oleh mesin kalkulator
    let modalRaw = document.getElementById('tambahModalKotor').value.replace(/\./g, '');
    let modalKotor = parseFloat(modalRaw) || 0;

    let jualRaw = document.getElementById('tambahJualEceran').value.replace(/\./g, '');
    let jualEceran = parseFloat(jualRaw) || 0;

    // UI Saklar Logic (Sembunyikan/Tampilkan Multiplier)
    const wadahMultiplier = document.getElementById('wadahMultiplier');
    const labelModalKotor = document.getElementById('labelModalKotor');
    const labelJualEceran = document.getElementById('labelJualEceran');
    const labelMultiplier = document.getElementById('labelMultiplier');
    const knob = document.querySelector('.toggle-knob');

    if (isBulk) {
        wadahMultiplier.classList.remove('opacity-30', 'pointer-events-none');
        labelMultiplier.textContent = `1 ${satBesar} isi brp ${satEcer}?`;
        labelModalKotor.innerHTML = `Modal (per ${satBesar}) <span class="text-red-500">*</span>`;
        if(knob) knob.style.transform = 'translateX(24px)';
    } else {
        wadahMultiplier.classList.add('opacity-30', 'pointer-events-none');
        labelModalKotor.innerHTML = `Modal (per ${satEcer}) <span class="text-red-500">*</span>`;
        if(knob) knob.style.transform = 'translateX(0px)';
    }
    labelJualEceran.innerHTML = `Jual (per ${satEcer}) <span class="text-red-500">*</span>`;

    // Mesin Hitung Arsitektur Cerdas
    let totalStokEceran = isBulk ? (qtyBeli * isiPerSatuan) : qtyBeli;
    let hppEceran = isBulk ? (modalKotor / (isiPerSatuan || 1)) : modalKotor;
    let tagihanTotal = isBulk ? (qtyBeli * modalKotor) : (qtyBeli * modalKotor);
    let profitEceran = jualEceran - hppEceran;

    // Injeksi Hasil ke Layar (Fact Sheet & Label Otomatis)
    document.getElementById('teksHppOtomatis').textContent = `Otomatis: HPP = ${rupiah(Math.round(hppEceran))} / ${satEcer}`;
    let warnaUntung = profitEceran > 0 ? 'text-[#657e65]' : 'text-red-500';
    document.getElementById('teksEstimasiUntung').innerHTML = `<span class="${warnaUntung}">Est. Keuntungan: ${rupiah(Math.round(profitEceran))} / ${satEcer}</span>`;

    document.getElementById('teksVisualStok').textContent = `${totalStokEceran} ${satEcer}`;
    document.getElementById('factSheetStok').textContent = `Total Stok Masuk: ${totalStokEceran} ${satEcer}`;
    document.getElementById('factSheetTagihan').textContent = `Total Tagihan Modal: ${rupiah(tagihanTotal)}`;

   // Simpan data kalkulasi ini ke atribut elemen untuk dihisap oleh prosesSimpanObatBaruMobile
    document.getElementById('tambahQtyBeli').dataset.calculatedStok = totalStokEceran;
    document.getElementById('tambahQtyBeli').dataset.tagihanMutlak = tagihanTotal;
    document.getElementById('tambahModalKotor').dataset.calculatedHpp = hppEceran;
}

function prosesSimpanObatBaruMobile() {
    const barcode = document.getElementById('tambahBarcodeMobile').value.trim();
    const qrcode = document.getElementById('tambahQrcodeMobile').value.trim();
    const nama = document.getElementById('tambahNamaMobile').value.trim();
    const varian = document.getElementById('tambahVarianMobile').value.trim();

    let kategori = document.getElementById('tambahKategoriMobile').value;
    if (kategori === 'kustom') {
        kategori = document.getElementById('tambahKategoriKustom').value.trim();
        if (!kategori) return alert('⚠️ Kategori manual tidak boleh kosong!');
    }

    const jualRaw = document.getElementById('tambahJualEceran').value.replace(/\./g, '');
    const jual = parseFloat(jualRaw) || 0;
    const expired = document.getElementById('tambahExpiredMobile').value;

    const modal = parseFloat(document.getElementById('tambahModalKotor').dataset.calculatedHpp) || 0;
    const stok = parseFloat(document.getElementById('tambahQtyBeli').dataset.calculatedStok) || 0;
    const tagihanMutlak = parseFloat(document.getElementById('tambahQtyBeli').dataset.tagihanMutlak) || (modal * stok);
    const satEcer = document.getElementById('tambahSatuanEceran').value;

    if(!satEcer || satEcer === "") return alert('⚠️ Satuan Eceran wajib dipilih!');
    if(!nama || !kategori || isNaN(modal) || isNaN(jual) || stok <= 0 || modal < 0 || jual < 0) return alert('⚠️ AKSES DITOLAK: Nama, Kategori, Jumlah, Modal, dan Jual wajib diisi dengan angka positif (> 0). Angka minus/negatif tidak diizinkan!');
    if(modal >= jual) return alert('⚠️ Peringatan: Harga Jual Eceran harus lebih tinggi dari HPP Eceran.');
    const idBatch = 'B-' + Date.now();
    let dnaInduk = '';

    if (qrcode) { dnaInduk = qrcode; } else if (barcode) { dnaInduk = barcode; }
    else {
        let cekGudang = masterItems.find(m => m.nama.toLowerCase() === nama.toLowerCase() && (m.varian || '').toLowerCase() === varian.toLowerCase() && (m.kategori || '').toLowerCase() === kategori.toLowerCase());
        if (cekGudang && cekGudang.dnaInduk) { dnaInduk = cekGudang.dnaInduk; } else { dnaInduk = 'DNA-' + Date.now(); }
    }

    const isBulk = document.getElementById('tambahToggleBulk').checked;
    const satBesar = document.getElementById('tambahSatuanBesar').value || 'Box';
    const qtyBeliAwal = parseFloat(document.getElementById('tambahQtyBeli').value) || 0;
    const isiPerSatuan = parseFloat(document.getElementById('tambahIsiPerSatuan').value) || 1;
    let riwayatAsal = { isGrosir: isBulk, satuanEcer: satEcer, satuanBesar: satBesar, qtyBeli: qtyBeliAwal, isiPerBox: isiPerSatuan };

        let sumberDanaDipilih = 'Pribadi';
    // --- DI PARKIR KE KERANJANG KULAKAN ---
    let itemAntrean = {
        idTunggu: 'T-' + Date.now(), sumber: 'TAMBAH_BARU',
        namaLengkap: nama + (varian ? ' ' + varian : ''),
        tagihan: tagihanMutlak, sumberDana: sumberDanaDipilih, qty: stok, satEcer: satEcer,
        payload: { idBatch, dnaInduk, barcode, qrcode, nama, varian, kategori, jual, expired, modal, stok, tagihanMutlak, satEcer, riwayatAsal }
    };

        if (modeEditKeranjangIndex !== null) {
        itemAntrean.idTunggu = antreanKulakan[modeEditKeranjangIndex].idTunggu; // Pertahankan ID aslinya
        antreanKulakan[modeEditKeranjangIndex] = itemAntrean;
        modeEditKeranjangIndex = null; // Matikan saklar
        saveApotekDB('apotek_antreanKulakan', antreanKulakan);
        tutupModalMobile('modalTambahObatMobile');
        renderBadgeAntreanKulakan();
        triggerHaptic(100);
        alert('🛒 Data obat di Keranjang berhasil diperbarui!');
        setTimeout(() => bukaModalAntreanKulakan(), 400); // Otomatis balik ke Troli
    } else {
        antreanKulakan.push(itemAntrean);
        saveApotekDB('apotek_antreanKulakan', antreanKulakan);
        tutupModalMobile('modalTambahObatMobile');
        renderBadgeAntreanKulakan();
        triggerHaptic(100);
        alert('🛒 Obat diparkir di Keranjang Kulakan!\n(Belum masuk gudang & belum memotong uang).');
    }
}


// ==========================================
// MESIN PEMROSES MASAL (KERANJANG KE GUDANG)
function eksekusiAntreanKulakan() {
    if(antreanKulakan.length === 0) return alert('Keranjang kosong!');

    let totalTagihanModalBos = 0;
    let qtyTotalSuntik = 0;
    let itemGagal = 0; // [PERBAIKAN] Sensor item hantu

    antreanKulakan.forEach(item => {
        if(item.sumber === 'TAMBAH_BARU') {
            // Obat baru (TAMBAH_BARU) pasti valid karena dibuat dari nol
            qtyTotalSuntik += item.qty;
            totalTagihanModalBos += item.tagihan;

            let p = item.payload;
            let batchAda = masterItems.find(m => m.dnaInduk === p.dnaInduk && m.expired === p.expired);

            if (batchAda) {
                if (!batchAda.kulakan_keuangan) batchAda.kulakan_keuangan = [];
                let kulakanAda = batchAda.kulakan_keuangan.find(f => {
                    let rLama = f.riwayatAsal || {};
                    let rBaru = p.riwayatAsal || {};
                    return f.hpp === p.modal && rLama.isGrosir === rBaru.isGrosir && rLama.satuanBesar === rBaru.satuanBesar && rLama.isiPerBox === rBaru.isiPerBox;
                });

                if (kulakanAda) {
                    kulakanAda.stokAwal += p.stok;
                    kulakanAda.sisaGudang += p.stok;
                    kulakanAda.modalKeluar += p.tagihanMutlak;
                    if (kulakanAda.riwayatAsal && p.riwayatAsal) {
                        kulakanAda.riwayatAsal.qtyBeli += (parseFloat(p.riwayatAsal.qtyBeli) || 0);
                    } else {
                        kulakanAda.riwayatAsal = JSON.parse(JSON.stringify(p.riwayatAsal));
                    }
                } else {
                    batchAda.kulakan_keuangan.push({ idkulakan: "F-" + Date.now() + Math.floor(Math.random()*100), tanggalNota: getTanggalLokal(), hpp: p.modal, stokAwal: p.stok, sisaGudang: p.stok, sisaEtalase: 0, modalKeluar: p.tagihanMutlak, riwayatAsal: JSON.parse(JSON.stringify(p.riwayatAsal)) });
                }
                batchAda.stok += p.stok; batchAda.totalModal += p.tagihanMutlak; batchAda.modal = p.modal;
            } else {
                masterItems.unshift({
                    idBatch: p.idBatch, dnaInduk: p.dnaInduk, barcode: p.barcode, qrcode: p.qrcode, nama: p.nama, varian: p.varian, keterangan: '',
                    kategori: p.kategori, modal: p.modal, jual: p.jual, stok: p.stok, expired: p.expired, totalModal: p.tagihanMutlak, riwayatAsal: p.riwayatAsal,
                    kulakan_keuangan: [{ idkulakan: "F-" + Date.now(), tanggalNota: getTanggalLokal(), hpp: p.modal, stokAwal: p.stok, sisaGudang: p.stok, sisaEtalase: 0, modalKeluar: p.tagihanMutlak, riwayatAsal: JSON.parse(JSON.stringify(p.riwayatAsal)) }]
                });
            }

            masterItems.forEach(m => { if (m.dnaInduk === p.dnaInduk) { m.jual = p.jual; m.kategori = p.kategori; } });
            let bEtalase = etalaseItems.find(e => e.dnaInduk === p.dnaInduk);
            if (bEtalase) { bEtalase.jual = p.jual; bEtalase.kategori = p.kategori; }

        } else if (item.sumber === 'EDIT_STOK') {
            let p = item.payload;

            // --- [POS SATPAM KERANJANG] VALIDASI ITEM HANTU ---
            let dataValid = false;
            if (p.isKulakanBaru || p.isAddingNewBatchMobile) {
                dataValid = masterItems.some(m => m.dnaInduk === p.dnaInduk);
            } else {
                dataValid = masterItems.some(i => i.idBatch === p.idBatchAktif);
            }

            // Jika Data Obat sudah Dihapus/Disusutkan di Gudang Utama
            if (!dataValid) {
                itemGagal++;
                return; // ⛔ STOP! Jangan eksekusi dan JANGAN tarik uang Bos. Lanjut ke loop berikutnya.
            }

            // Jika lolos sensor (Obat Valid), baru uang Bos dicatat keluar
            qtyTotalSuntik += item.qty;
            totalTagihanModalBos += item.tagihan;

            if (p.isKulakanBaru || p.isAddingNewBatchMobile) {
                let batchAda = masterItems.find(m => m.dnaInduk === p.dnaInduk && m.expired === p.expBaru);

                if (batchAda) {
                    if (!batchAda.kulakan_keuangan) batchAda.kulakan_keuangan = [];
                    let kulakanAda = batchAda.kulakan_keuangan.find(f => {
                        let rLama = f.riwayatAsal || {};
                        let rBaru = p.riwayatAsalBaru || {};
                        return f.hpp === p.hppPresisi && rLama.isGrosir === rBaru.isGrosir && rLama.satuanBesar === rBaru.satuanBesar && rLama.isiPerBox === rBaru.isiPerBox;
                    });

                    if (kulakanAda) {
                        kulakanAda.stokAwal += p.selisihStok;
                        kulakanAda.sisaGudang += p.selisihStok;
                        kulakanAda.modalKeluar += p.tagihanMutlak;
                        if (kulakanAda.riwayatAsal && p.riwayatAsalBaru) {
                            kulakanAda.riwayatAsal.qtyBeli += (parseFloat(p.riwayatAsalBaru.qtyBeli) || 0);
                        } else {
                            kulakanAda.riwayatAsal = JSON.parse(JSON.stringify(p.riwayatAsalBaru));
                        }
                    } else {
                        batchAda.kulakan_keuangan.push({ idkulakan: "F-" + Date.now() + Math.floor(Math.random()*100), tanggalNota: getTanggalLokal(), hpp: p.hppPresisi, stokAwal: p.selisihStok, sisaGudang: p.selisihStok, sisaEtalase: 0, modalKeluar: p.tagihanMutlak, riwayatAsal: JSON.parse(JSON.stringify(p.riwayatAsalBaru)) });
                    }
                    batchAda.stok += p.selisihStok; batchAda.totalModal += p.tagihanMutlak; batchAda.modal = p.mBaru;
                } else {
                    const idBatchBaru = 'B-' + Date.now() + '-' + Math.floor(Math.random()*1000);
                    masterItems.unshift({
                        idBatch: idBatchBaru, dnaInduk: p.dnaInduk, barcode: p.barcode, qrcode: p.qrcode, nama: p.nBaru, varian: p.vBaru, keterangan: '',
                        kategori: p.kBaru, modal: p.mBaru, jual: p.jBaru, stok: p.selisihStok, expired: p.expBaru, totalModal: p.tagihanMutlak, riwayatAsal: p.riwayatAsalBaru,
                        kulakan_keuangan: [{ idkulakan: "F-" + Date.now(), tanggalNota: getTanggalLokal(), hpp: p.hppPresisi, stokAwal: p.selisihStok, sisaGudang: p.selisihStok, sisaEtalase: 0, modalKeluar: p.tagihanMutlak, riwayatAsal: JSON.parse(JSON.stringify(p.riwayatAsalBaru)) }]
                    });
                }
            } else {
                // STRICT ACCOUNTING: Blok ini sengaja dimatikan.
                // Tidak boleh ada modifikasi stok dan HPP pada Batch lama dari jalur antrean.
                console.warn("Akses modifikasi stok lama diblokir oleh Strict Accounting.");
            }

            masterItems.forEach(m => { if (m.dnaInduk === p.dnaInduk) { m.nama = p.nBaru; m.varian = p.vBaru; m.jual = p.jBaru; m.kategori = p.kBaru; } });
            let bEtalase = etalaseItems.find(e => e.dnaInduk === p.dnaInduk || e.nama === p.nBaru);
            if (bEtalase) { bEtalase.dnaInduk = p.dnaInduk; bEtalase.nama = p.nBaru; bEtalase.varian = p.vBaru; bEtalase.jual = p.jBaru; bEtalase.kategori = p.kBaru; }
        }
    });

    // Modal Bos hanya dikurangi dari nominal yang VALID lolos eksekusi
    // Pengeluaran 0 dihapus sesuai instruksi
    // if (totalTagihanModalBos > 0) { ... }

    if (qtyTotalSuntik > 0) {
        catatMutasiSiklus('KULAKAN_TAMBAH', totalTagihanModalBos, qtyTotalSuntik);
    }

    // Berhasil atau Gagal, Keranjang selalu dikosongkan (Sapu Bersih)
    antreanKulakan = [];
    saveApotekDB('apotek_antreanKulakan', antreanKulakan);
    saveApotekDB('apotek_masterItems', masterItems);
    saveApotekDB('apotek_siklusAktif', siklusAktif);

    tutupModalMobile('modalAntreanKulakanMobile');
    renderBadgeAntreanKulakan();
    renderGudangMobile(document.getElementById('cariGudangMobile').value);
    renderBerandaMobile();
    triggerHaptic([100, 50, 100]);

    // ALARM DINAMIS: Beda pesan jika ada Item Hantu
    if (itemGagal > 0) {
        alert(`⚠️ EKSKUSI SELESAI DENGAN PERINGATAN!\n\nSebagian obat berhasil diturunkan ke Gudang.\n\nNamun, ada ${itemGagal} item dari keranjang yang OTOMATIS DIBATALKAN oleh sistem karena data induk obat tersebut ternyata sudah dihapus di Gudang.\n\n(Uang Laporan Keuangan Anda aman dan tidak terpotong!)`);
    } else {
        alert('✅ EKSKUSI FAKTUR KULAKAN SELESAI!\nSemua obat (Obat Baru & Tambah Stok) telah diturunkan ke Gudang secara bersamaan.');
    }
}
function bukaModalAntreanKulakan() {
    renderListAntreanKulakan();
    bukaModalMobile('modalAntreanKulakanMobile', 'panelAntreanKulakanMobile');
}

function renderListAntreanKulakan() {
    let wadah = document.getElementById('wadahListAntreanKulakan');
    let totalSemua = 0;
    if(antreanKulakan.length === 0) {
        wadah.innerHTML = `<div class="p-6 text-center text-slate-400 font-bold text-xs"><i class="fa-solid fa-box-open text-3xl mb-2 opacity-50 block"></i>Keranjang Kosong</div>`;
        document.getElementById('totalAntreanKulakan').textContent = "Rp 0";
        return;
    }

                wadah.innerHTML = antreanKulakan.map((item, idx) => {
        totalSemua += item.tagihan;

        let badgeLaci = `<span class="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200"><i class="fa-solid fa-user-tie mr-1"></i> Dana Bos</span>`;
                // Pemasangan Label " ✨ BARANG BARU" vs "📦 TAMBAH STOK"
        let badgeJenis = '';
        if (item.sumber === 'TAMBAH_BARU') badgeJenis = `<span class="text-[8.5px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-black border border-emerald-200 tracking-wider mt-1 inline-block shadow-sm">✨ BARANG BARU</span>`;
        else if (item.sumber === 'EDIT_STOK') badgeJenis = `<span class="text-[8.5px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black border border-blue-200 tracking-wider mt-1 inline-block shadow-sm">📦 TAMBAH STOK</span>`;

        // --- EKSTRAKSI & PEMBEDA VISUAL TIGA SERANGKAI (NAMA, VARIAN, KATEGORI) ---
        let p = item.payload;
        let namaUtama = item.sumber === 'TAMBAH_BARU' ? p.nama : p.nBaru;
        let varian = item.sumber === 'TAMBAH_BARU' ? p.varian : p.vBaru;
        let kategori = item.sumber === 'TAMBAH_BARU' ? p.kategori : p.kBaru;

        let teksVarian = varian ? `<span class="text-[9px] text-slate-400 italic font-medium ml-1.5 border-l border-slate-300 pl-1.5">${varian}</span>` : '';
        let teksKategori = kategori ? `<span class="text-[8px] bg-corporate-50 text-corporate-600 border border-corporate-100 px-1.5 py-0.5 rounded uppercase font-black tracking-widest inline-block shadow-sm ml-2 -mt-0.5">${kategori}</span>` : '';
        // -------------------------------------------------------------------------

        return `
        <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm mb-2 flex flex-col">
            <div class="flex justify-between items-start mb-2">
                <div class="flex-1 pr-2">
                    <div class="flex items-center flex-wrap leading-tight mb-0.5">
                        <span class="font-bold text-slate-800 text-sm">${namaUtama || '-'}</span>${teksVarian}${teksKategori}
                    </div>
                    ${badgeJenis}
                </div>
                <div class="text-right shrink-0">
                    <span class="font-black text-corporate-700 text-sm">${rupiah(item.tagihan)}</span>
                </div>
            </div>

            <div class="flex items-center justify-between border-t border-slate-50 pt-2">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shadow-sm">+${item.qty} ${item.satEcer}</span>
                    ${badgeLaci}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="bukaEditItemAntrean(${idx})" class="text-[9px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors border border-blue-100 shadow-sm flex items-center gap-1 active:scale-95"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button onclick="hapusItemAntrean(${idx})" class="text-[9px] font-bold text-red-500 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors border border-red-100 shadow-sm flex items-center gap-1 active:scale-95"><i class="fa-solid fa-trash"></i> Hapus</button>
                </div>
            </div>
        </div>`;
    }).join('');

    document.getElementById('totalAntreanKulakan').textContent = rupiah(totalSemua);
}

function hapusItemAntrean(idx) {
    antreanKulakan.splice(idx, 1);
    modeEditKeranjangIndex = null;
    saveApotekDB('apotek_antreanKulakan', antreanKulakan);
    renderListAntreanKulakan();
    renderBadgeAntreanKulakan();
}

// MESIN DAUR ULANG UI: KOREKSI DATA LANGSUNG DARI DALAM KERANJANG
function bukaEditItemAntrean(idx) {
    let item = antreanKulakan[idx];
    modeEditKeranjangIndex = idx; // Nyalakan Saklar Edit Penampungan
    let p = item.payload;

    tutupModalMobile('modalAntreanKulakanMobile');

    if (item.sumber === 'TAMBAH_BARU') {
        // CABANG A: Buka Formulir Tambah Obat Baru
        document.getElementById('tambahBarcodeMobile').value = p.barcode || '';
        document.getElementById('tambahQrcodeMobile').value = p.qrcode || '';

        ['tambah_qr', 'tambah_barcode'].forEach(tipe => {
            let btn = document.getElementById('btnUI_' + tipe);
            let teks = document.getElementById('teksUI_' + tipe);
            let isTerekam = (tipe === 'tambah_qr' && p.qrcode) || (tipe === 'tambah_barcode' && p.barcode);
            if(btn && teks) {
                if(isTerekam) {
                    btn.className = "w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex flex-col items-center justify-center shrink-0 border-2 border-emerald-500 shadow-sm transition-all gap-0.5";
                    teks.classList.remove('hidden'); teks.textContent = "TEREKAM";
                } else {
                    btn.className = "w-12 h-12 bg-white text-[#d97706] rounded-2xl flex flex-col items-center justify-center shrink-0 border border-slate-200 shadow-sm transition-all gap-0.5";
                    teks.classList.add('hidden'); teks.textContent = "Rekam";
                }
            }
        });

        document.getElementById('tambahNamaMobile').value = p.nama || '';
        document.getElementById('tambahVarianMobile').value = p.varian || '';
        if(p.varian) document.getElementById('wadahVarianMobile').classList.remove('hidden');
        else document.getElementById('wadahVarianMobile').classList.add('hidden');

        let opsiStandar = ['Sakit Kepala', 'Vitamin', 'Sirup', 'Analgesik', 'Antibiotik', 'Salep'];
        let selectKategori = document.getElementById('tambahKategoriMobile');
        let inputKustom = document.getElementById('tambahKategoriKustom');
        if (p.kategori && !opsiStandar.includes(p.kategori) && p.kategori !== 'kustom') {
            selectKategori.value = 'kustom'; inputKustom.value = p.kategori; inputKustom.classList.remove('hidden');
            setDropdownUIManual('tambahKategoriMobile', 'Tulis Manual');
        } else {
            selectKategori.value = p.kategori || ''; inputKustom.value = ''; inputKustom.classList.add('hidden');
            if(p.kategori) setDropdownUIManual('tambahKategoriMobile', p.kategori);
            else resetDropdownUI('tambahKategoriMobile', 'Contoh: <i>Vitamin</i>');
        }

        document.getElementById('tambahSatuanEceran').value = p.satEcer || '';
        if(p.satEcer) setDropdownUIManual('tambahSatuanEceran', p.satEcer);

        let riwayat = p.riwayatAsal;
        document.getElementById('tambahToggleBulk').checked = riwayat ? riwayat.isGrosir : true;
        document.getElementById('tambahSatuanBesar').value = riwayat ? riwayat.satuanBesar : '';
        if(riwayat && riwayat.satuanBesar) setDropdownUIManual('tambahSatuanBesar', riwayat.satuanBesar);

        document.getElementById('tambahQtyBeli').value = riwayat ? riwayat.qtyBeli : '';
        document.getElementById('tambahIsiPerSatuan').value = riwayat ? riwayat.isiPerBox : '';

        let modalKotor = (riwayat && riwayat.isGrosir) ? (p.modal * riwayat.isiPerBox) : p.modal;
        document.getElementById('tambahModalKotor').value = modalKotor ? modalKotor.toLocaleString('id-ID').replace(/,/g, '.') : '';
        document.getElementById('tambahJualEceran').value = p.jual ? p.jual.toLocaleString('id-ID').replace(/,/g, '.') : '';
        document.getElementById('tambahExpiredMobile').value = p.expired || '';

        kalkulasiTambahObatCerdas();
        setTimeout(() => bukaModalMobile('modalTambahObatMobile', 'panelTambahObatMobile'), 400);

    } else if (item.sumber === 'EDIT_STOK') {
        // CABANG B: Buka Formulir Koreksi Stok / Edit Obat
        idBatchAktif = p.idBatchAktif;
        let barang = masterItems.find(i => i.idBatch === idBatchAktif);
        if(barang) {
            currentEditBatchesMobile = masterItems.filter(m => m.dnaInduk === barang.dnaInduk);
            currentEditBatchesMobile.sort((a, b) => a.idBatch.localeCompare(b.idBatch));
            activeEditBatchIndexMobile = currentEditBatchesMobile.findIndex(b => b.idBatch === idBatchAktif);
            if(activeEditBatchIndexMobile === -1) activeEditBatchIndexMobile = 0;
            isAddingNewBatchMobile = p.isAddingNewBatchMobile;

            renderEditTabsMobile();

            document.getElementById('editNamaMobile').value = p.nBaru;
            document.getElementById('editVarianMobile').value = p.vBaru || '';
            isiKategoriEditCerdas(p.kBaru);

            let riwayatBaru = p.riwayatAsalBaru;
            document.getElementById('editToggleGrosir').checked = riwayatBaru ? riwayatBaru.isGrosir : false;
            document.getElementById('editQtyBeli').value = riwayatBaru ? riwayatBaru.qtyBeli : '';

            document.getElementById('editSatuanBesar').value = riwayatBaru ? riwayatBaru.satuanBesar : '';
            if(riwayatBaru && riwayatBaru.satuanBesar) setDropdownUIManual('editSatuanBesar', riwayatBaru.satuanBesar);
            else resetDropdownUI('editSatuanBesar', 'Contoh: <i>Box</i>', true);

            document.getElementById('editIsiPerBox').value = riwayatBaru ? riwayatBaru.isiPerBox : '';

            document.getElementById('editSatuanEceran').value = riwayatBaru ? riwayatBaru.satuanEcer : '';
            if(riwayatBaru && riwayatBaru.satuanEcer) setDropdownUIManual('editSatuanEceran', riwayatBaru.satuanEcer);
            else resetDropdownUI('editSatuanEceran', 'Contoh: <i>Strip</i>', true);

            let modalKotorEd = (riwayatBaru && riwayatBaru.isGrosir) ? (p.mBaru * riwayatBaru.isiPerBox) : p.mBaru;
            document.getElementById('editModalKotor').value = modalKotorEd ? modalKotorEd.toLocaleString('id-ID').replace(/,/g, '.') : '';

            kalkulatorEditBatchMobile();

            document.getElementById('editModalMobile').value = p.mBaru;
            document.getElementById('editJualMobile').value = p.jBaru;
            document.getElementById('editStokMobile').value = p.sBaru;
            document.getElementById('editExpiredMobile').value = p.expBaru || '';

            aktifkanModeEditMobile();

            if (isAddingNewBatchMobile) {
                document.getElementById('editNamaMobile').readOnly = true; document.getElementById('editNamaMobile').classList.add('bg-slate-200','text-slate-500');
                document.getElementById('editVarianMobile').readOnly = true; document.getElementById('editVarianMobile').classList.add('bg-slate-200','text-slate-500');
                document.getElementById('editKategoriMobile').disabled = true; document.getElementById('btn_editKategoriMobile').classList.add('bg-slate-200','text-slate-500');
                document.getElementById('editJualMobile').readOnly = true; document.getElementById('editJualMobile').classList.add('bg-slate-200','text-slate-500');
                let btnJual = document.getElementById('btnUbahJualMobile');
                if (btnJual) { btnJual.classList.add('hidden'); }
            }

            setTimeout(() => bukaModalMobile('modalEditMobile', 'panelEditMobile'), 400);
        } else {
            alert("⚠️ Data sumber di Gudang sudah tidak ada. Silakan Hapus item ini dari keranjang.");
            modeEditKeranjangIndex = null;
        }
    }
}


function renderBadgeAntreanKulakan() {
    let badge = document.getElementById('badgeKeranjangKulakan');
    if(badge) {
        if(antreanKulakan.length > 0) {
            badge.classList.remove('hidden');
            badge.textContent = antreanKulakan.length;
        } else {
            badge.classList.add('hidden');
        }
    }
}
setTimeout(renderBadgeAntreanKulakan, 1000);


// ==========================================
// 12. MESIN KASIR & KERANJANG (POINT OF SALE)
// ==========================================
let keranjangKasirMobile = [];

function toggleDropdownKasir() { document.getElementById('dropdownKasirList').classList.toggle('hidden'); }

function pilihObatDariDropdown(dnaInduk) {
    document.getElementById('dropdownKasirList').classList.add('hidden');
    let barang = etalaseItems.find(e => e.dnaInduk === dnaInduk);
    if(barang) masukkanKeKeranjangMobile(barang);
}


function bukaModalKasirMobile() {
    keranjangKasirMobile = []; renderKeranjangMobile();
    const list = document.getElementById('dropdownKasirList');
    list.innerHTML = '';
    let adaBarang = false;

    etalaseItems.forEach(item => {
        if(item.stok > 0) {
            // SUNTIKAN: Desain elegan, varian lebih kecil & miring, kategori di bawah.
            let teksVarian = item.varian ? ` <span class="text-[9px] text-slate-400 italic font-medium ml-1 block">${item.varian}</span>` : '';
            let teksKategori = item.kategori ? ` <span class="text-[8px] uppercase font-black text-corporate-500 block">${item.kategori}</span>` : '';

                        list.innerHTML += `<button onclick="pilihObatDariDropdown('${item.dnaInduk}')" class="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex justify-between items-center border-b border-slate-100 last:border-0"><div class="leading-tight"><span class="font-bold text-slate-800 text-sm block">${item.nama}</span>${teksVarian}${teksKategori}</div><span class="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 shrink-0 ml-3">Sisa ${item.stok}</span></button>`;
      adaBarang = true;
        }
    });

    if(!adaBarang) {
         list.innerHTML = `<div class="p-4 text-center text-xs font-bold text-slate-400">Etalase Kosong</div>`;
         return alert("⚠️ Etalase masih kosong! Masuk ke menu Gudang lalu transfer stok ke Etalase.");
    }

    document.querySelector('input[value="Tunai"]').checked = true; toggleFormKasbonMobile();
    bukaModalMobile('modalKasirMobile', 'panelKasirMobile');
}

let toastTimeoutMobile;
function showToast(pesan) {
    const toast = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMessage');
    if(!toast || !toastMsg) return;
    toastMsg.innerHTML = pesan;
    toast.classList.remove('opacity-0', '-translate-y-10'); toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toastTimeoutMobile);
    toastTimeoutMobile = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0'); toast.classList.add('opacity-0', '-translate-y-10');
    }, 2000);
}

function masukkanKeKeranjangMobile(barang) {
    let index = keranjangKasirMobile.findIndex(k => k.dnaInduk === barang.dnaInduk);
    if(index !== -1) {
        if(keranjangKasirMobile[index].qty < barang.stok) {
            keranjangKasirMobile[index].qty++;
            showToast(`✅ ${barang.nama} ditambahkan. Total di keranjang: ${keranjangKasirMobile[index].qty} stok.`);
            triggerHaptic([50, 100]);
        } else { alert("⚠️ Sisa stok " + barang.nama + " tidak cukup!"); }
    } else {
        // SUNTIKAN: Kunci dnaInduk ke keranjang agar sistem tidak salah potong
        keranjangKasirMobile.push({ dnaInduk: barang.dnaInduk, nama: barang.nama, varian: barang.varian, keterangan: barang.keterangan, kategori: barang.kategori, jual: barang.jual, qty: 1, stokMax: barang.stok });
        showToast(`✅ 1 stok ${barang.nama} berhasil masuk keranjang.`);
        triggerHaptic([50, 100]);
    }
    renderKeranjangMobile();
}

function ubahQtyKeranjangMobile(index, delta) {
    let item = keranjangKasirMobile[index]; let newQty = item.qty + delta;
    if(newQty > item.stokMax) return alert("Sisa stok hanya " + item.stokMax);
    if(newQty <= 0) { keranjangKasirMobile.splice(index, 1); } else { item.qty = newQty; }
    renderKeranjangMobile();
}

function renderKeranjangMobile() {
    const tbody = document.getElementById('keranjangBodyMobile'); let total = 0;
    if(keranjangKasirMobile.length === 0) {
        tbody.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-50/50">
                <div class="w-14 h-14 mx-auto bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 mb-3">
                    <i class="fa-solid fa-basket-shopping text-2xl text-slate-300"></i>
                </div>
                <p class="text-[11px] font-black text-slate-700 uppercase tracking-widest mb-1">Keranjang Kosong</p>
                <p class="text-[9px] text-slate-500 font-medium">Pilih obat dari etalase atas atau<br>tekan tombol Scanner Scanner</p>
            </div>`;
    } else {
        tbody.innerHTML = keranjangKasirMobile.map((k, i) => {
            let sub = k.jual * k.qty; total += sub;
            let ketTeks = (k.varian || k.keterangan) ? `<p class="text-[9px] text-slate-500 italic mt-0.5">${k.varian || ''} ${k.keterangan || ''}</p>` : '';
            return `<div class="px-4 py-3 bg-white flex items-center justify-between gap-3 border-b border-slate-50 last:border-0"><div class="flex-1 pr-2"><h4 class="font-bold text-slate-800 text-xs leading-tight">${k.nama}</h4>${ketTeks}<p class="font-black text-corporate-600 text-sm mt-1">${rupiah(sub)}</p></div><div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner shrink-0"><button onclick="ubahQtyKeranjangMobile(${i}, -1)" class="w-7 h-7 rounded-lg bg-white shadow-sm text-slate-600 font-bold active:bg-slate-100 transition">-</button><span class="w-5 text-center font-black text-slate-800 text-xs">${k.qty}</span><button onclick="ubahQtyKeranjangMobile(${i}, 1)" class="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 shadow-sm text-emerald-600 font-bold active:bg-emerald-100 transition">+</button></div></div>`;
        }).join('');
    }
    document.getElementById('kasirTotalMobile').textContent = rupiah(total);
}

function toggleFormKasbonMobile() {
    const metode = document.querySelector('input[name="kasirMetodeMobile"]:checked').value;
    const formIdentitas = document.getElementById('formKasbonMobile');
    if(metode === 'Debt') { formIdentitas.classList.remove('hidden'); } else { formIdentitas.classList.add('hidden'); document.getElementById('kasbonNamaMobile').value = ''; document.getElementById('kasbonWaMobile').value = ''; }
}

function prosesBayarMobile() {
    if(keranjangKasirMobile.length === 0) return alert('Keranjang masih kosong!');

    // [POS SATPAM] VALIDASI STOK REAL-TIME (Anti-Stok Minus / Distorsi Waktu)
    for (let i = 0; i < keranjangKasirMobile.length; i++) {
        let k = keranjangKasirMobile[i];
        let bEtalase = etalaseItems.find(e => e.dnaInduk === k.dnaInduk);
        let stokRealTime = bEtalase ? bEtalase.stok : 0;

        if (stokRealTime < k.qty) {
            triggerHaptic([100, 50, 100, 50]);
            return alert(`⚠️ TRANSAKSI DITOLAK!\n\nStok [${k.nama}] di Etalase telah berubah atau dimusnahkan.\nSisa fisik saat ini: ${stokRealTime}\n\nSilakan hapus item tersebut dari keranjang kasir terlebih dahulu.`);
        }
    }

    const metode = document.querySelector('input[name="kasirMetodeMobile"]:checked').value;
    let namaPelanggan = ''; let waPelanggan = '';
    if(metode === 'Debt') {
        namaPelanggan = document.getElementById('kasbonNamaMobile').value; waPelanggan = document.getElementById('kasbonWaMobile').value;
        if(!namaPelanggan) return alert('Nama pelanggan wajib diisi untuk Kasbon!');
    }

    let totalBelanja = 0, totalLaba = 0, totalItem = 0; let namaObatGabungan = [];    keranjangKasirMobile.forEach(k => {
        totalBelanja += (k.jual * k.qty); totalItem += k.qty;
        let namaLengkap = k.nama; if(k.varian || k.keterangan) namaLengkap += ` (${k.varian || ''} ${k.keterangan || ''})`; namaObatGabungan.push(namaLengkap);

                        let totalModalItemIni = potongStokPenjualanFIFO(k.dnaInduk, k.qty, k.nama);
        totalLaba += ((k.jual * k.qty) - totalModalItemIni);
        k.hppSatuan = Math.round(totalModalItemIni / k.qty);
        k.hppTotalModal = totalModalItemIni;
}); // <--- INILAH PENYELAMATNYA (Penutup Loop Keranjang)
    if (metode !== 'Debt') catatMutasiSiklus('OMZET_MASUK', totalBelanja);
    const tglWaktu = new Date();
    const strWaktu = tglWaktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const strTglLokal = getTanggalLokal();

    // [PENYEMPURNAAN 1] MESIN AUTO-SPLIT KHUSUS KASBON (DEBT)
    if (metode === 'Debt' && keranjangKasirMobile.length > 0) {
        keranjangKasirMobile.forEach((k, index) => {
            let subTotal = k.jual * k.qty;
            // ANTI-BOCOR 1: Menggunakan hppTotalModal utuh tanpa pembulatan
            let subLaba = subTotal - (k.hppTotalModal !== undefined ? k.hppTotalModal : (k.hppSatuan * k.qty));
            let namaKet = k.nama + (k.varian ? ` ${k.varian}` : '');
            cashierHistory.unshift({
                id: Date.now() + index, // ID unik per item
                tanggal: strTglLokal, waktu: strWaktu,
                obat: namaKet, detailKeranjang: [JSON.parse(JSON.stringify(k))],
                kasir: 'Pemilik', item: k.qty, total: subTotal, metode: metode, laba: subLaba, pelanggan: namaPelanggan, wa: waPelanggan, isPelunasan: false
            });
        });
    } else {
        // JIKA BUKAN KASBON, TETAP 1 STRUK GABUNGAN SEPERTI BIASA
        const namaObatFinal = namaObatGabungan.length > 1 ? `${namaObatGabungan[0]} + ${namaObatGabungan.length - 1} lainnya` : namaObatGabungan[0];
        cashierHistory.unshift({
            id: Date.now(), tanggal: strTglLokal, waktu: strWaktu,
            obat: namaObatFinal, detailKeranjang: JSON.parse(JSON.stringify(keranjangKasirMobile)),
            kasir: 'Pemilik', item: totalItem, total: totalBelanja, metode: metode, laba: totalLaba, pelanggan: namaPelanggan, wa: waPelanggan, isPelunasan: false
        });
    }

    const namaNotifFinal = namaObatGabungan.length > 1 ? `${namaObatGabungan[0]} + ${namaObatGabungan.length - 1} lainnya` : namaObatGabungan[0];

    // TEMBAKKAN ALARM NOTIFIKASI (BUG FIXED: namaObatFinal diganti menjadi namaNotifFinal)
    if (metode === 'Debt') {
        kirimNotifikasiMobile('Kasbon / Piutang', `${namaNotifFinal} berstatus kasbon atas nama ${namaPelanggan}.`, 'piutang', totalBelanja);
    } else {
        kirimNotifikasiMobile('Pembelian Baru', `${namaNotifFinal} laku terjual secara ${metode}.`, 'beli', totalBelanja);
    }

    /// TAHAP 2: MENAMBAL AMNESIA BUKU MASTER
    saveApotekDB('apotek_masterItems', masterItems);
    saveApotekDB('apotek_etalaseItems', etalaseItems);
    saveApotekDB('apotek_cashierHistory', cashierHistory);
    saveApotekDB('apotek_siklusAktif', siklusAktif);

    // [PENAWAR BUG DOUBLE-CHECKOUT] KOSONGKAN KERANJANG SEKETIKA!
    keranjangKasirMobile = [];
    renderKeranjangMobile();

    tutupModalMobile('modalKasirMobile');
    renderBerandaMobile();

    if(!document.getElementById('layar-gudang').classList.contains('hidden')) renderGudangMobile(document.getElementById('cariGudangMobile').value);
    if(!document.getElementById('layar-etalase').classList.contains('hidden')) renderEtalaseMobile();
    triggerHaptic([100, 50, 100]);
    alert(`✅ Transaksi ${metode} Berhasil! Omzet telah masuk ke Beranda.`);

    // Inject ke Supabase Queue jika Offline
    if (!navigator.onLine) {
         let toast = document.createElement('div');
         toast.className = 'fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg z-[9999] opacity-90';
         toast.innerHTML = '<i class="fa-solid fa-wifi-slash mr-2"></i> Offline mode: Transaction saved locally';
         document.body.appendChild(toast);
         setTimeout(() => toast.remove(), 4000);
    }
    sinkronKeAwanMobile(); // Selalu panggil, biar fungsi cloud sync yang mikirin mau push apa queue
}

async function prosesBatalTransaksiMobile(idTransaksiInput) {
    let confirmBatal = await customConfirm("Batalkan transaksi ini?\n\nJika ini penjualan biasa, uang ditarik & obat diretur. Jika ini Pelunasan, utang akan dihidupkan kembali tanpa mengacaukan stok.");
    if (confirmBatal) {
        // Normalisasi input menjadi array (Mendukung Pembatalan Multi-ID hasil Split)
        let arrIds = Array.isArray(idTransaksiInput) ? idTransaksiInput : [idTransaksiInput];
        let transaksiYangDibatalkan = cashierHistory.filter(t => arrIds.includes(t.id));

        if (transaksiYangDibatalkan.length === 0) return tutupConfirmMobile();

        // Ambil sampel pertama untuk cek jenis transaksi (Kuitansi gabungan pasti sejenis)
        const sampelTrx = transaksiYangDibatalkan[0];

        // [PERISAI MUTLAK] Cegah batal nota utama jika sudah ada cicilan
        if (!sampelTrx.isPelunasan && sampelTrx.metode === 'Debt') {
            let adaCicilan = cashierHistory.some(p => {
                if (!p.isPelunasan || !p.idTerkait) return false;
                let arrTerkait = p.idTerkait.toString().split(',').map(Number);
                return arrTerkait.some(id => arrIds.includes(id));
            });
            if (adaCicilan) {
                tutupConfirmMobile();
                return setTimeout(() => alert("⚠️ DITOLAK!\n\nNota Kasbon ini sudah memiliki riwayat pembayaran/cicilan.\nAnda harus membatalkan Bukti Pelunasannya terlebih dahulu jika ingin membatalkan nota utamanya."), 400);
            }
        }

        // Kumpulkan semua detail dari seluruh ID yang batal secara paralel
        let totalUangBatal = 0;
        let kumpulanItemRetur = [];
        let idTerkaitGabungan = [];

        transaksiYangDibatalkan.forEach(trx => {
            totalUangBatal += (trx.total || 0);
            if (trx.idTerkait) {
                idTerkaitGabungan = idTerkaitGabungan.concat(trx.idTerkait.toString().split(','));
            }
            if (trx.detailKeranjang && trx.detailKeranjang.length > 0) {
                kumpulanItemRetur = kumpulanItemRetur.concat(trx.detailKeranjang);
            } else if (!trx.isPelunasan) {
                // Fallback riwayat lama sebelum keranjang array
                let qty = trx.item || 1;
                let hppRetur = Math.round(((trx.total || 0) - (trx.laba || 0)) / qty);
                                                let hppAbsolutLama = ((trx.total || 0) - (trx.laba || 0));
                kumpulanItemRetur.push({
                    dnaInduk: 'DNA-RETUR-OLD', nama: trx.obat, jual: Math.round((trx.total || 0) / qty),
                    qty: qty, hppSatuan: hppRetur, hppTotalModal: hppAbsolutLama
                });
            }
        });

        // [CELAH 1] LOGIKA BATAL KHUSUS PELUNASAN GABUNGAN
        if (sampelTrx.isPelunasan) {
            catatMutasiSiklus('OMZET_BATAL', totalUangBatal);

            // Bangkitkan Utang Lama dari Tali Pusar (Sistem Asisten)
            if (idTerkaitGabungan.length > 0) {                cashierHistory.forEach(t => {
                    if(idTerkaitGabungan.includes(t.id.toString())) {
                        t.statusLunas = false; // Kembalikan statusnya ke belum lunas
                    }
                });
            }
            kirimNotifikasiMobile('Batal Pelunasan', `Pelunasan ${sampelTrx.pelanggan || ''} dibatalkan. Utang aktif kembali.`, 'batal', totalUangBatal);

        } else {

            // BATAL TRANSAKSI PENJUALAN BIASA (TUNAI/QRIS/DEBT UTAMA)
            if (sampelTrx.metode !== 'Debt') {
                catatMutasiSiklus('OMZET_BATAL', totalUangBatal);
            }

            // Kembalikan Stok ke Etalase Menggunakan Mesin Sentral
            kumpulanItemRetur.forEach(itemRetur => {
                pulihkanStokBatal(itemRetur);
                // [MODIFIKASI] Tanam stempel gaib agar tombol hapus tetap terkunci abu-abu
                masterItems.forEach(m => {
                    if (m.dnaInduk === itemRetur.dnaInduk) {
                        m.isPernahBatal = true;
                    }
                });
            });
        } // <--- INI ADALAH KURUNG KURAWAL YANG HILANG!
        // Eksekusi Pemusnahan ID dari History
        cashierHistory = cashierHistory.filter(t => !arrIds.includes(t.id));
        // SIMPAN SEMUA MEMORI TERMASUK MASTER ITEMS
        saveApotekDB('apotek_masterItems', masterItems);
        saveApotekDB('apotek_etalaseItems', etalaseItems);
        saveApotekDB('apotek_cashierHistory', cashierHistory);
        saveApotekDB('apotek_siklusAktif', siklusAktif);

        renderRiwayatMobile(); renderBerandaMobile();
        if(!document.getElementById('layar-piutang').classList.contains('hidden')) renderPiutangMobile();
        if(!document.getElementById('layar-etalase').classList.contains('hidden')) renderEtalaseMobile();
        if(!document.getElementById('layar-gudang').classList.contains('hidden')) {
            let inputCari = document.getElementById('cariGudangMobile');
            renderGudangMobile(inputCari ? inputCari.value : '');
        }
        triggerHaptic([100,50,100]);
        alert(sampelTrx.isPelunasan ? "✅ Batal Pelunasan Berhasil! Utang dihidupkan kembali secara presisi (Stok tidak disentuh)." : "✅ Transaksi Dibatalkan. Stok setiap item diretur ke Etalase.");
    }
}

// ==========================================
// 13. MESIN LACAK STRUK & PENAGIHAN WA
// ==========================================
function bukaModalLacakMobile() {
    document.getElementById('inputLacakIDMobile').value = ''; document.getElementById('hasilLacakAreaMobile').classList.add('hidden');
    bukaModalMobile('modalLacakMobile', 'panelLacakMobile');
}

function prosesLacakIDMobile() {
    const inputID = parseInt(document.getElementById('inputLacakIDMobile').value);
    const area = document.getElementById('hasilLacakAreaMobile');
    if(!inputID) return alert("⚠️ Ketik nomor ID transaksi yang valid!");

    const trx = cashierHistory.find(t => t.id === inputID);
    area.classList.remove('hidden');

    if(!trx) { area.innerHTML = `<div class="text-center p-4 bg-red-50 rounded-2xl border border-red-100"><i class="fa-solid fa-file-circle-xmark text-3xl text-red-300 mb-2 block"></i><p class="text-xs font-bold text-red-600">ID Transaksi tidak ditemukan.</p></div>`; return; }

    let statusHtml = '';
    if (trx.metode === 'Debt') {
        if(trx.statusLunas) statusHtml = `<div class="bg-emerald-50 border border-emerald-200 p-3 rounded-xl mt-3"><p class="text-[9px] font-black text-emerald-600 uppercase mb-1 tracking-wider"><i class="fa-solid fa-check-circle"></i> SUDAH DILUNASI</p><p class="text-[11px] text-emerald-800 font-medium leading-tight">Utang telah dibayar via ${trx.idTerkait || '-'}</p></div>`;
        else statusHtml = `<div class="bg-red-50 border border-red-200 p-3 rounded-xl mt-3"><p class="text-[9px] font-black text-red-600 uppercase mb-1 tracking-wider"><i class="fa-solid fa-triangle-exclamation"></i> BELUM BAYAR</p><p class="text-[11px] text-red-800 font-medium leading-tight">Faktur kasbon ini masih menunggak.</p></div>`;
    } else if (trx.isPelunasan) {
        statusHtml = `<div class="bg-blue-50 border border-blue-200 p-3 rounded-xl mt-3"><p class="text-[9px] font-black text-blue-600 uppercase mb-1 tracking-wider"><i class="fa-solid fa-link"></i> BUKTI PELUNASAN</p><p class="text-[11px] text-blue-800 font-medium leading-tight">Nota terima uang untuk Faktur ID: ${trx.idTerkait || '-'}</p></div>`;
    } else {
        statusHtml = `<div class="bg-slate-50 border border-slate-200 p-3 rounded-xl mt-3"><p class="text-[9px] font-black text-slate-600 uppercase mb-1 tracking-wider"><i class="fa-solid fa-check"></i> TRANSAKSI LUNAS</p><p class="text-[11px] text-slate-600 font-medium leading-tight">Pembelian putus via ${trx.metode}.</p></div>`;
    }

    area.innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm"><h4 class="font-black text-corporate-900 text-sm mb-1 tracking-tight">Rincian Struk</h4><div class="flex justify-between items-center text-[10px] font-bold text-slate-400 mb-3 border-b border-slate-100 pb-2"><span><i class="fa-regular fa-clock"></i> ${trx.tanggal} (${trx.waktu})</span><span>Kasir: ${trx.kasir}</span></div><p class="text-xs font-bold text-slate-800 leading-tight">${trx.obat}</p><p class="text-2xl font-black text-corporate-700 mt-2">${rupiah(trx.total)}</p>${statusHtml}</div>`;
}

function tagihViaWAMobile(idTransaksi) {
    const trx = cashierHistory.find(t => t.id === idTransaksi);
    if (!trx || !trx.wa) return alert("⚠️ Nomor WhatsApp pelanggan tidak ditemukan!");

    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); canvas.width = 400; canvas.height = 460;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
    ctx.font = '900 24px monospace'; ctx.fillText(profilApotek.nama.toUpperCase().substring(0,25), 200, 45);
    ctx.font = '600 14px monospace'; ctx.fillText((profilApotek.alamat || '').substring(0,40), 200, 70);
    ctx.font = '14px monospace'; ctx.fillText('====================================', 200, 95);
    ctx.font = '900 18px monospace'; ctx.fillText('BUKTI KASBON / PIUTANG', 200, 125);
    ctx.font = '14px monospace'; ctx.fillText('====================================', 200, 145);

    ctx.textAlign = 'left'; let y = 180; ctx.font = '600 14px monospace';
    ctx.fillText(`No. Trx : ${trx.id}`, 25, y); y += 25; ctx.fillText(`Waktu   : ${trx.tanggal} (${trx.waktu})`, 25, y); y += 25;
    ctx.fillText(`Kasir   : ${trx.kasir}`, 25, y); y += 30; ctx.fillText(`Yth.    : ${(trx.pelanggan || '').toUpperCase()}`, 25, y); y += 35;

    ctx.textAlign = 'center'; ctx.fillText('------------------------------------', 200, y); y += 30;
    ctx.textAlign = 'left'; ctx.font = '900 15px monospace'; ctx.fillText(`${trx.obat}`, 25, y); y += 25;
    ctx.font = '600 14px monospace'; ctx.fillText(`${trx.item} Item Obat`, 25, y);
    ctx.textAlign = 'right'; ctx.fillText(`${rupiah(trx.total)}`, 375, y); y += 35;

    ctx.textAlign = 'center'; ctx.font = '14px monospace'; ctx.fillText('------------------------------------', 200, y); y += 35;
    ctx.textAlign = 'left'; ctx.font = '900 18px monospace'; ctx.fillText('TOTAL TAGIHAN:', 25, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#dc2626'; ctx.fillText(`${rupiah(trx.total)}`, 375, y); y += 45;

    ctx.fillStyle = '#64748b'; ctx.textAlign = 'center'; ctx.font = 'italic 12px monospace';
    ctx.fillText('Struk digital ini adalah bukti sah', 200, y); y += 20; ctx.fillText('dari ' + profilApotek.nama, 200, y);

    let noWA = trx.wa.toString().replace(/\D/g, ''); if (noWA.startsWith('0')) { noWA = '62' + noWA.substring(1); } else if (noWA.startsWith('8')) { noWA = '62' + noWA; }

    const pesanTeks = `Halo Bapak/Ibu *${trx.pelanggan || 'Pelanggan'}*,\n\nKami dari *${profilApotek.nama}* memohon izin mengingatkan catatan kasbon/piutang yang belum diselesaikan.\n*(Struk Terlampir)*\n\nMohon kerjasamanya untuk dapat melakukan pelunasan di tempat kami.\nTerima kasih! ├░┼╕тДв┬П`;

    canvas.toBlob(async (blob) => {
        const namaFile = `Tagihan_${(trx.pelanggan || 'Apotek').replace(/\s+/g, '_')}.png`; const fileGambar = new File([blob], namaFile, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [fileGambar] })) {
            try { await navigator.share({ files: [fileGambar], title: 'Tagihan Apotek', text: pesanTeks }); } catch (err) { console.log(err); }
        } else {
            alert("✅ Gambar struk akan diunduh. Silakan kirim (Drag & Drop) gambar tersebut ke WhatsApp yang akan terbuka.");
            const linkDownload = document.createElement('a'); linkDownload.href = URL.createObjectURL(blob); linkDownload.download = namaFile; linkDownload.click();
            setTimeout(() => { window.open(`https://api.whatsapp.com/send?phone=${noWA}&text=${encodeURIComponent(pesanTeks)}`, '_blank'); }, 800);
        }
    }, 'image/png');
}

// ==========================================
// 14. MESIN TRUK LOGISTIK (TRANSFER MASAL)
// ==========================================
function bukaModalTransferMasalMobile() {
    const list = document.getElementById('listTransferMasalBodyMobile');
    let barangTersedia = masterItems.filter(o => o.stok > 0 && o.nama !== '___SYSTEM_AUTH___' && o.kategori !== '⚠️ Barang Retur');

    if(barangTersedia.length === 0) {
        return alert("Gudang kosong! Tidak ada barang yang bisa ditransfer.");
    }

        let grouped = {};
    barangTersedia.forEach(o => {
        if(!grouped[o.dnaInduk]) {
            // SUNTIKAN: Mengambil Varian ke dalam wadah pengelompokan
            grouped[o.dnaInduk] = { dnaInduk: o.dnaInduk, nama: o.nama, varian: o.varian, kategori: o.kategori, jual: o.jual, totalStok: 0 };
        }
        grouped[o.dnaInduk].totalStok += o.stok;
    });

    let groupedArray = Object.values(grouped);
    list.innerHTML = groupedArray.map((g, index) => {
        // SUNTIKAN UI: Merakit Tiga Serangkai (Nama, Varian, Kategori) dengan rapi
        let teksVarian = g.varian ? `<span class="text-[9px] text-slate-400 italic font-medium ml-1.5 border-l border-slate-300 pl-1.5">${g.varian}</span>` : '';
        let teksKategori = g.kategori ? `<span class="text-[8px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded ml-2 uppercase font-bold tracking-widest inline-block -mt-0.5">${g.kategori}</span>` : '';

        return `
        <div class="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-2xl shadow-sm mb-2">
            <div class="flex-1 pr-2">
                <div class="flex items-center flex-wrap mb-1 leading-tight"><span class="font-bold text-sm text-slate-800">${g.nama}</span>${teksVarian}${teksKategori}</div>
                <p class="text-[10px] text-slate-500 mt-1">Total di Gudang: <span class="font-black text-emerald-600">${g.totalStok}</span></p>
            </div>
            <div class="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100 shrink-0">
                <button type="button" onclick="ubahJumlahMasalMobile('masalM-${index}', -1)" class="h-8 w-8 rounded-lg bg-white shadow-sm text-slate-600 font-black active:bg-slate-200">-</button>
                <input type="number" id="masalM-${index}" data-dna="${g.dnaInduk}" value="0" min="0" max="${g.totalStok}" class="w-10 bg-transparent text-center font-black text-slate-800 text-sm focus:outline-none input-masal-transfer">
                <button type="button" onclick="ubahJumlahMasalMobile('masalM-${index}', 1)" class="h-8 w-8 rounded-lg bg-emerald-100 shadow-sm text-emerald-700 font-black active:bg-emerald-200">+</button>
            </div>
        </div>`;
    }).join('');

    bukaModalMobile('modalTransferMasalMobile', 'panelTransferMasalMobile');
}

function ubahJumlahMasalMobile(idInput, delta) {
    let input = document.getElementById(idInput);
    let val = parseInt(input.value) || 0;
    let max = parseInt(input.getAttribute('max')) || 0;
    let newVal = val + delta;
    if (newVal < 0) newVal = 0;
    if (newVal > max) newVal = max;
    input.value = newVal;
}

function prosesTransferMasalMobile() {
    let adaYangDitransfer = false;
    let inputs = document.querySelectorAll('.input-masal-transfer');

    inputs.forEach(input => {
        let val = parseInt(input.value) || 0;
        let dnaInduk = input.getAttribute('data-dna');

        if (val > 0) {
            let batchesGudang = masterItems.filter(i => i.dnaInduk === dnaInduk && i.stok > 0);
            let totalStokGudang = batchesGudang.reduce((sum, b) => sum + b.stok, 0);

            if (val <= totalStokGudang) {
                adaYangDitransfer = true;
                let namaObat = batchesGudang[0].nama;
                transferStokKeEtalase(dnaInduk, val, namaObat, batchesGudang[0].kategori, batchesGudang[0].jual, batchesGudang[0].varian);
            }
        }
    });

    if(adaYangDitransfer) {
        saveApotekDB('apotek_masterItems', masterItems);
        saveApotekDB('apotek_etalaseItems', etalaseItems);

        tutupModalMobile('modalTransferMasalMobile');
        renderGudangMobile(document.getElementById('cariGudangMobile').value);
        renderBerandaMobile();
        triggerHaptic([100, 50, 100]);
        alert("📦 Barang berhasil diberangkatkan ke Etalase secara Cerdas!");
    } else { alert("Pilih minimal 1 barang untuk ditransfer."); }
}

// ==========================================
// 15. MESIN SETELAN HUB (PROFIL & PENGATURAN)
// ==========================================
function bukaModalSetelanMobile() {
    document.getElementById('setNamaMobile').value = profilApotek.nama;
    document.getElementById('setAlamatMobile').value = profilApotek.alamat || '';
    document.getElementById('setTelpMobile').value = profilApotek.telepon || '';

    // Pastikan semua panel akordeon dalam keadaan tertutup rapat saat pertama kali dibuka
    let panelProfil = document.getElementById('setelan-profil');
    let iconProfil = document.getElementById('icon-setelan-profil');
    if(panelProfil) panelProfil.classList.add('hidden');
    if(iconProfil) iconProfil.style.transform = 'rotate(0deg)';

    bukaModalMobile('modalSetelanMobile', 'panelSetelanMobile');
}


function toggleAkordeonSetelan(idElemen) {
    let el = document.getElementById(idElemen);
    let icon = document.getElementById('icon-' + idElemen);
    if(el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        if(icon) icon.style.transform = 'rotate(180deg)';
    } else {
        el.classList.add('hidden');
        if(icon) icon.style.transform = 'rotate(0deg)';
    }
}

function prosesSimpanSetelanMobile() {
    let nama = document.getElementById('setNamaMobile').value;
    let alamat = document.getElementById('setAlamatMobile').value;
    let telp = document.getElementById('setTelpMobile').value;
    if(!nama || !alamat) return alert("⚠️ Nama Apotek dan Alamat wajib diisi!");

    profilApotek.nama = nama; profilApotek.alamat = alamat; profilApotek.telepon = telp;

    saveApotekDB('apotek_profilData', profilApotek);

    document.getElementById('namaApotekHeader').innerText = nama;
    tutupModalMobile('modalSetelanMobile');
    alert("✅ Profil Apotek berhasil diperbarui!");
}

// ==========================================
// 16. MESIN PEMINDAI SENSOR KARTU & BARCODE (VIRTUAL ID)
// ==========================================
let html5QrcodeScannerMobile = null; let targetScannerAktif = 'kasir';

function bukaScannerKameraMobile(target = 'kasir') {
    targetScannerAktif = target;
    const modalScan = document.getElementById('modalScannerKamera'); modalScan.classList.remove('hidden');
    html5QrcodeScannerMobile = new Html5Qrcode("readerMobile");
    const config = { fps: 10, qrbox: { width: 250, height: 100 }, aspectRatio: 1.0 };

    html5QrcodeScannerMobile.start({ facingMode: "environment" }, config, (decodedText) => {
        tutupKameraScannerMobile(); triggerHaptic(200);

                if (targetScannerAktif === 'tambah_qr' || targetScannerAktif === 'tambah_barcode') {
            let barangSudahAda = masterItems.find(m => m.barcode === decodedText || m.qrcode === decodedText);

            // CEK KERANJANG PENAMPUNGAN (Omniscient Scanner)
            let barangDiKeranjang = antreanKulakan.findIndex(k =>
                k.payload && (k.payload.barcode === decodedText || k.payload.qrcode === decodedText || k.payload.dnaInduk === decodedText)
            );

            if (barangSudahAda) {
                document.getElementById('tambahBarcodeMobile').value = ''; document.getElementById('tambahQrcodeMobile').value = '';
                munculkanAlertPencegatanMobile(barangSudahAda.nama, barangSudahAda.dnaInduk);
            } else if (barangDiKeranjang !== -1 && modeEditKeranjangIndex === null) {
                document.getElementById('tambahBarcodeMobile').value = ''; document.getElementById('tambahQrcodeMobile').value = '';
                tampilkanConfirmMobile("Barang ini sedang antre di Keranjang Penampungan!\n\nBuka keranjang untuk mengoreksi datanya?", function() {
                    tutupKameraScannerMobile();
                    tutupModalMobile('modalTambahObatMobile');
                    bukaModalAntreanKulakan();
                });
            } else {

                if(targetScannerAktif === 'tambah_qr') document.getElementById('tambahQrcodeMobile').value = decodedText;
                else document.getElementById('tambahBarcodeMobile').value = decodedText;

                // Ubah Visual Tombol Menjadi Hijau Terekam
                let btn = document.getElementById('btnUI_' + targetScannerAktif);
                let teks = document.getElementById('teksUI_' + targetScannerAktif);
                if(btn && teks) {
                    btn.className = "w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex flex-col items-center justify-center shrink-0 border-2 border-emerald-500 shadow-sm active:scale-95 transition-all gap-0.5";
                    teks.classList.remove('hidden');
                    teks.textContent = "TEREKAM";
                }

                alert("✅ Kode berhasil direkam ke sistem! Silakan lengkapi sisa data obat.");
            }
        } else if (targetScannerAktif === 'lacak') {
            let match = decodedText.match(/Trx:\s*(\d+)/);
            if(match && match[1]) { document.getElementById('inputLacakIDMobile').value = match[1]; prosesLacakIDMobile(); } else { alert("⚠️ QR Code bukan struk valid."); }
        } else {
                        let barangMaster = masterItems.find(m => m.barcode === decodedText || m.qrcode === decodedText);
            if(barangMaster) {
                let bEtalase = etalaseItems.find(e => e.dnaInduk === barangMaster.dnaInduk);
                if(bEtalase && bEtalase.stok > 0) {
      // Visual Animasi Hijau Scanner Kasir
                    let btnScan = document.getElementById('btnScannerKasir');
                    if(btnScan) {
                        btnScan.classList.remove('bg-orange-50', 'border-orange-200', 'hover:bg-orange-100', 'text-orange-500');
                        btnScan.classList.add('bg-emerald-500', 'border-emerald-600', 'text-white');
                        let separator = btnScan.querySelector('span');
                        if (separator) separator.classList.replace('text-orange-200/50', 'text-emerald-300');
                        setTimeout(() => {
                            btnScan.classList.remove('bg-emerald-500', 'border-emerald-600', 'text-white');
                            btnScan.classList.add('bg-orange-50', 'border-orange-200', 'hover:bg-orange-100', 'text-orange-500');
                            if (separator) separator.classList.replace('text-emerald-300', 'text-orange-200/50');
                        }, 800);
                    }
                    masukkanKeKeranjangMobile(bEtalase);
                } else { alert("⚠️ STOK KOSONG di Etalase!"); }
            } else { alert("⚠️ Barcode tidak terdaftar!"); }
        }
    }).catch(err => { alert("Kamera gagal diakses."); tutupKameraScannerMobile(); });
}

function munculkanAlertPencegatanMobile(namaBarang, dnaInduk) {
    document.getElementById('alertPencegatanNamaMobile').textContent = namaBarang;
    let batches = masterItems.filter(m => m.dnaInduk === dnaInduk); batches.sort((a, b) => a.idBatch.localeCompare(b.idBatch));

    let listHTML = batches.map((b, index) => {
        let expText = b.expired ? `Exp: ${b.expired}` : 'Tanpa Exp';
        return `<div class="bg-white border border-slate-200 p-2 rounded-xl mb-1.5 flex justify-between items-center shadow-sm"><span class="font-black text-slate-700">Batch ${index + 1}</span><span class="text-slate-500 font-medium">${expText} | Stok: <span class="font-black text-amber-600">${b.stok}</span></span></div>`;
    }).join('');

    document.getElementById('alertPencegatanListMobile').innerHTML = listHTML;
    document.getElementById('btnAlertPencegatanLanjutMobile').onclick = function() {
        document.getElementById('modalAlertPencegatanMobile').classList.add('hidden');
        tutupModalMobile('modalTambahObatMobile');
        if(batches.length > 0) setTimeout(() => { bukaModalEditMobile(batches[0].idBatch); }, 400);
    };

    document.getElementById('modalAlertPencegatanMobile').classList.remove('hidden');
    setTimeout(() => { document.getElementById('panelAlertPencegatanMobile').classList.remove('scale-90', 'opacity-0'); document.getElementById('panelAlertPencegatanMobile').classList.add('scale-100', 'opacity-100'); }, 10);
}

function tutupKameraScannerMobile() {
    if(html5QrcodeScannerMobile) { html5QrcodeScannerMobile.stop().then(() => { document.getElementById('modalScannerKamera').classList.add('hidden'); }).catch(e => console.log(e)); }
    else { document.getElementById('modalScannerKamera').classList.add('hidden'); }
}

let isSenterAktif = false;
function toggleSenterMobile() {
    if (html5QrcodeScannerMobile) {
        isSenterAktif = !isSenterAktif;
        html5QrcodeScannerMobile.applyVideoConstraints({
            advanced: [{ torch: isSenterAktif }]
        }).then(() => {
            let btn = document.getElementById('btnSenterMobile');
            if(isSenterAktif) {
                btn.innerHTML = '<i class="fa-solid fa-lightbulb text-emerald-400"></i> Matikan Senter';
                btn.classList.replace('bg-slate-800', 'bg-slate-700');
            } else {
                btn.innerHTML = '<i class="fa-solid fa-lightbulb text-amber-400"></i> Nyalakan Senter';
                btn.classList.replace('bg-slate-700', 'bg-slate-800');
            }
        }).catch(err => {
            isSenterAktif = !isSenterAktif; // Kembalikan status jika ditolak
            alert("⚠️ Gagal menyalakan senter! Browser di HP Anda mungkin memblokir fitur akses Senter demi aturan privasi, atau fiturnya tidak didukung.");
        });
    } else {
        alert("⚠️ Kamera belum aktif.");
    }
}

// ==========================================
// 17. MESIN UI/UX (CUSTOM ALERT & CONFIRM)
// ==========================================
const ALERT_STYLES = {
    success: {
        icon: 'w-16 h-16 mx-auto rounded-full bg-emerald-100 border-2 border-emerald-200 text-emerald-500 flex items-center justify-center text-3xl mb-3 shadow-inner',
        html: '<i class="fa-solid fa-check-circle"></i>',
        title: 'font-black text-emerald-700 text-xl tracking-tight mb-2',
        text: 'Sukses!',
        btn: 'w-full bg-emerald-500 text-white font-bold py-3.5 rounded-2xl shadow-md transition-transform active:scale-95'
    },
    error: {
        icon: 'w-16 h-16 mx-auto rounded-full bg-red-100 border-2 border-red-200 text-red-500 flex items-center justify-center text-3xl mb-3 shadow-inner animate-pulse',
        html: '<i class="fa-solid fa-triangle-exclamation"></i>',
        title: 'font-black text-red-700 text-xl tracking-tight mb-2',
        text: 'Perhatian!',
        btn: 'w-full bg-red-500 text-white font-bold py-3.5 rounded-2xl shadow-md transition-transform active:scale-95'
    },
    info: {
        icon: 'w-16 h-16 mx-auto rounded-full bg-blue-100 border-2 border-blue-200 text-blue-500 flex items-center justify-center text-3xl mb-3 shadow-inner',
        html: '<i class="fa-solid fa-bell"></i>',
        title: 'font-black text-blue-700 text-xl tracking-tight mb-2',
        text: 'Informasi',
        btn: 'w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl shadow-md transition-transform active:scale-95'
    }
};

window.alert = function(pesan) {
    const modal = document.getElementById('modalAlertMobile'); const panel = document.getElementById('panelAlertMobile');
    const icon = document.getElementById('iconAlertMobile'); const judul = document.getElementById('judulAlertMobile');
    const btn = document.getElementById('btnAlertMobile'); const teks = document.getElementById('teksAlertMobile');
    let strPesan = String(pesan).toLowerCase();

    let type = 'info';
    if (strPesan.includes('berhasil') || strPesan.includes('sukses') || strPesan.includes('✅')) type = 'success';
    else if (strPesan.includes('gagal') || strPesan.includes('wajib') || strPesan.includes('peringatan') || strPesan.includes('⚠️')) type = 'error';

    let s = ALERT_STYLES[type];
    icon.className = s.icon; icon.innerHTML = s.html;
    judul.className = s.title; judul.innerText = s.text;
    btn.className = s.btn;

    teks.innerText = pesan;
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); panel.classList.remove('scale-90'); }, 10);
};

function tutupAlertMobile() {
    const modal = document.getElementById('modalAlertMobile'); const panel = document.getElementById('panelAlertMobile');
    modal.classList.add('opacity-0'); panel.classList.add('scale-90'); setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

let aksiConfirmCallback = null;
function tampilkanConfirmMobile(pesan, callbackYa) {
    aksiConfirmCallback = callbackYa; document.getElementById('teksConfirmMobile').innerText = pesan;
    const modal = document.getElementById('modalConfirmMobile'); const panel = document.getElementById('panelConfirmMobile');
    modal.classList.remove('hidden'); setTimeout(() => { modal.classList.remove('opacity-0'); panel.classList.remove('scale-90'); }, 10);
}

function tutupConfirmMobile() {
    const modal = document.getElementById('modalConfirmMobile'); const panel = document.getElementById('panelConfirmMobile');
    modal.classList.add('opacity-0'); panel.classList.add('scale-90'); setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

function eksekusiConfirmMobile() { tutupConfirmMobile(); if(aksiConfirmCallback) setTimeout(() => { aksiConfirmCallback(); }, 300); }

// ==========================================
// 18. PELUNASAN KASBON & TUTUP BUKU
// ==========================================
let idsPelunasanMultiMobile = null;

function bukaModalPelunasanMobile(idsJoined, nama, totalTagihan) {
    idsPelunasanMultiMobile = idsJoined;
    document.getElementById('pelunasanNamaMobile').textContent = nama;
    document.getElementById('pelunasanTotalMobile').textContent = rupiah(totalTagihan);
    bukaModalMobile('modalPelunasanMobile', 'panelPelunasanMobile');
}

function eksekusiPelunasanMobile(metodePilihan) {
    // Kita panggil mesin eksekusi cerdas yang baru dibuat
    eksekusiPelunasanCerdas(metodePilihan);
}
// [CELAH 3] KANVAS WA DINAMIS KHUSUS TAGIHAN GABUNGAN PIUTANG
function tagihWAMultiPiutang(nama) {
    let notaHutang = cashierHistory.filter(t => t.metode === 'Debt' && !t.statusLunas && (t.pelanggan || '').trim().toUpperCase() === nama);

    if (notaHutang.length === 0) return alert("⚠️ Tidak ada tunggakan aktif untuk pelanggan ini.");
    let waTujuan = notaHutang.find(t => t.wa)?.wa;
    if (!waTujuan) return alert("⚠️ Nomor WhatsApp pelanggan tidak ditemukan di sistem!");

    let totalTagihan = 0;
    let rincianLines = [];

    notaHutang.forEach(n => {
        totalTagihan += n.total;
        rincianLines.push(`Tgl: ${n.tanggal} (${rupiah(n.total)})`);
        if(n.detailKeranjang && n.detailKeranjang.length > 0) {
            n.detailKeranjang.forEach(k => {
                // Gambar cerdas: Hanya menggambar sisa qty aktif yang menggantung
                let teks = ` - ${k.nama} x${k.qty}`;
                if(teks.length > 35) teks = teks.substring(0, 32) + "...";
                rincianLines.push(teks);
            });
        } else {
            let teks = ` - ${n.obat}`;
            if(teks.length > 35) teks = teks.substring(0, 32) + "...";
            rincianLines.push(teks);
        }
    });

    // Kalkulasi Tinggi Kanvas Anti-Overflow
    let canvasHeight = 300 + (rincianLines.length * 20);

    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    canvas.width = 400; canvas.height = canvasHeight;

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
    ctx.font = '900 24px monospace'; ctx.fillText(profilApotek.nama.toUpperCase().substring(0,25), 200, 45);
    ctx.font = '600 14px monospace'; ctx.fillText((profilApotek.alamat || '').substring(0,40), 200, 70);
    ctx.font = '14px monospace'; ctx.fillText('====================================', 200, 95);
    ctx.font = '900 18px monospace'; ctx.fillText('REKAP TAGIHAN PIUTANG', 200, 125);
    ctx.font = '14px monospace'; ctx.fillText('====================================', 200, 145);

    ctx.textAlign = 'left'; let y = 180; ctx.font = '600 14px monospace';
    ctx.fillText(`Yth. : ${nama}`, 25, y); y += 25;
    ctx.fillText(`Total: ${notaHutang.length} Nota Belum Lunas`, 25, y); y += 30;

    ctx.textAlign = 'center'; ctx.fillText('------------------------------------', 200, y); y += 25;
    ctx.textAlign = 'left';

    rincianLines.forEach(line => {
        if(line.startsWith('Tgl:')) {
            ctx.font = '900 13px monospace'; ctx.fillStyle = '#1e293b'; y += 5;
        } else {
            ctx.font = '500 13px monospace'; ctx.fillStyle = '#475569';
        }
        ctx.fillText(line, 25, y); y += 20;
    });

    y += 10;
    ctx.textAlign = 'center'; ctx.fillStyle = '#0f172a';
    ctx.font = '14px monospace'; ctx.fillText('------------------------------------', 200, y); y += 35;

    ctx.textAlign = 'left'; ctx.font = '900 18px monospace'; ctx.fillText('GRAND TOTAL:', 25, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#dc2626'; ctx.fillText(`${rupiah(totalTagihan)}`, 375, y); y += 45;

    ctx.fillStyle = '#64748b'; ctx.textAlign = 'center'; ctx.font = 'italic 12px monospace';
    ctx.fillText('Struk digital ini adalah rincian sah', 200, y); y += 20; ctx.fillText('dari ' + profilApotek.nama, 200, y);

    let noWA = waTujuan.toString().replace(/\D/g, ''); if (noWA.startsWith('0')) { noWA = '62' + noWA.substring(1); } else if (noWA.startsWith('8')) { noWA = '62' + noWA; }
    const pesanTeks = `Halo Bapak/Ibu *${nama}*, semoga hari ini sehat dan lancar selalu aktivitasnya ya. 😊\n\nKami dari *${profilApotek.nama}* memohon izin menyampaikan rincian sisa catatan kasbon yang belum diselesaikan sebesar *${rupiah(totalTagihan)}*.\n(Rincian sisa barang terlampir pada gambar struk di atas ya) 👆\n\nJika ada waktu luang, kami tunggu kedatangannya di Toko Obat kami untuk proses pelunasannya. Jangan sungkan untuk mampir kembali ya Pak/Bu kalau butuh vitamin, obat, atau sekadar periksa tensi. Kami selalu siap melayani dengan sepenuh hati! 🏥\n\nTerima kasih banyak atas kepercayaannya. Sehat dan berkah selalu! 🙏✨`;

    canvas.toBlob(async (blob) => {
        const namaFile = `Rekap_Tagihan_${nama.replace(/\s+/g, '_')}.png`; const fileGambar = new File([blob], namaFile, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [fileGambar] })) {
            try { await navigator.share({ files: [fileGambar], title: 'Tagihan Apotek', text: pesanTeks }); } catch (err) { console.log(err); }
        } else {
            alert("✅ Gambar rekap tagihan akan diunduh. Silakan kirim gambar tersebut ke WhatsApp yang terbuka otomatis.");
            const linkDownload = document.createElement('a'); linkDownload.href = URL.createObjectURL(blob); linkDownload.download = namaFile; linkDownload.click();
            setTimeout(() => { window.open(`https://api.whatsapp.com/send?phone=${noWA}&text=${encodeURIComponent(pesanTeks)}`, '_blank'); }, 800);
        }
    }, 'image/png');
}

function eksekusiTutupBukuMobile() {
    let saldoLaci = hitungSaldoLaciFisik();
    document.getElementById('tutupBukuSaldoAktif').textContent = rupiah(saldoLaci);
    document.getElementById('inputModalKembalian').value = '';

    // Menyimpan saldo aktif ke dalam tombol untuk dipanggil saat konfirmasi
    document.getElementById('btnKonfirmasiTutupBuku').dataset.saldo = saldoLaci;

    bukaModalMobile('modalTutupBukuMobile', 'panelTutupBukuMobile');
}

async function prosesKonfirmasiTutupBuku() {
    let saldoLaci = parseInt(document.getElementById('btnKonfirmasiTutupBuku').dataset.saldo) || 0;
    let disisakanRaw = document.getElementById('inputModalKembalian').value.replace(/\./g, '');
    let disisakan = parseFloat(disisakanRaw) || 0;

    if (disisakan > saldoLaci) {
        return alert("⚠️ Uang kembalian yang disisakan tidak boleh lebih besar dari total fisik laci (" + rupiah(saldoLaci) + ")");
    }

    let uangDitarik = saldoLaci - disisakan;

    let confirmTutup = await customConfirm(`Tarik tunai ${rupiah(uangDitarik)} dan sisakan ${rupiah(disisakan)} di laci untuk besok?\n\nSetelah ini, Siklus Progress Bar akan di-reset.`);
    if (confirmTutup) {

        // 1. EKSEKUSI AUTO-PRIVE (TARIK UANG LACI FISIK)
        if (uangDitarik > 0) {
            const waktu = new Date();
            const strWaktu = waktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            pengeluaranHistory.unshift({
                id: 'OUT-TUTUP-' + Date.now(),
                tanggal: getTanggalLokal(),
                waktu: strWaktu,
                kategori: 'Prive',
                nominal: uangDitarik,
                keterangan: 'Tarik Tunai Laci (Tutup Buku)',
                kasir: 'Sistem'
            });
            saveApotekDB('apotek_pengeluaranHistory', pengeluaranHistory);
        }

        // 2. EKSEKUSI RESET PROGRESS BAR (FUNGSI ASLI)
        let targetHutangLama = (siklusAktif.hutangAwal !== undefined ? siklusAktif.hutangAwal : (siklusAktif.modalAwal || 0)) + (siklusAktif.modalTambahan || 0);
        let tercapai = siklusAktif.uangMasuk || 0;
        let sudahUntung = tercapai > targetHutangLama;
        let sisaHutang = targetHutangLama - tercapai;
        if (sisaHutang < 0) sisaHutang = 0;

        let rekapAset = kalkulasiAsetFisik();
        let totalAsetFisikSekarang = rekapAset.totalAset;
        let totalQtyFisikSekarang = rekapAset.totalQty;
        let snapshotStok = {};
        masterItems.forEach(m => {
            if (m.nama !== '___SYSTEM_AUTH___' && m.kategori !== '⚠️ Barang Retur') {
                snapshotStok[m.dnaInduk] = (snapshotStok[m.dnaInduk] || 0) + m.stok;
            }
        });
        etalaseItems.forEach(e => {
            snapshotStok[e.dnaInduk] = (snapshotStok[e.dnaInduk] || 0) + e.stok;
        });

                if (sudahUntung) {
            siklusAktif = {
                modalAwal: totalAsetFisikSekarang, qtyAwal: totalQtyFisikSekarang,
                modalTambahan: 0, qtyTambahan: 0, uangMasuk: 0,
                qtyDihapus: 0, modalDihapus: 0,
                tanggalStart: getTanggalLokal(),
                isLikuidasi: true, isLanjutanDefisit: false, hutangAwal: 0,
                waktuStart: Date.now(), snapshotStok: snapshotStok
            };
        } else {
            siklusAktif = {
                modalAwal: totalAsetFisikSekarang, qtyAwal: totalQtyFisikSekarang,
                modalTambahan: 0, qtyTambahan: 0, uangMasuk: 0,
                qtyDihapus: 0, modalDihapus: 0,
                tanggalStart: getTanggalLokal(),
                isLikuidasi: false, isLanjutanDefisit: true, hutangAwal: sisaHutang,
                waktuStart: Date.now(), snapshotStok: snapshotStok
            };
        }

        saveApotekDB('apotek_siklusAktif', siklusAktif);

        tutupModalMobile('modalTutupBukuMobile');
        renderBerandaMobile();

        setTimeout(() => {
             if(sudahUntung) { alert(`✅ TUTUP BUKU BERHASIL!\nUang fisik ditarik sebesar ${rupiah(uangDitarik)}.\nMode Likuidasi Aktif.`); }
             else { alert(`✅ TUTUP BUKU BERHASIL!\nUang fisik ditarik sebesar ${rupiah(uangDitarik)}.\nMode Defisit Lanjutan diteruskan.`); }
         }, 500);
    }
}

// ==========================================
// MESIN KAS KELUAR (BIAYA OPERASIONAL & PRIVE)
// ==========================================
function toggleRiwayatPengeluaranMobile() {
    let containerRiwayat = document.getElementById('containerRiwayatPengeluaran');
    let containerInput = document.getElementById('containerInputPengeluaran');
    let footerInput = document.getElementById('footerInputPengeluaran');
    let btnToggle = document.getElementById('btnToggleRiwayatPengeluaran');

    if (containerRiwayat.classList.contains('hidden')) {
        // Show Riwayat
        containerRiwayat.classList.remove('hidden');
        containerInput.classList.add('hidden');
        if (footerInput) footerInput.classList.add('hidden');
        btnToggle.innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Baru';
        btnToggle.classList.replace('bg-white/20', 'bg-emerald-500/80');
        btnToggle.classList.replace('hover:bg-white/30', 'hover:bg-emerald-600/80');
        renderRiwayatPengeluaranMobile();
    } else {
        // Show Input Form
        containerRiwayat.classList.add('hidden');
        containerInput.classList.remove('hidden');
        if (footerInput) footerInput.classList.remove('hidden');
        btnToggle.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Riwayat & Edit';
        btnToggle.classList.replace('bg-emerald-500/80', 'bg-white/20');
        btnToggle.classList.replace('hover:bg-emerald-600/80', 'hover:bg-white/30');
    }
}

function renderRiwayatPengeluaranMobile() {
    let container = document.getElementById('containerRiwayatPengeluaran');
    let html = '';

    if (pengeluaranHistory.length === 0) {
        container.innerHTML = '<p class="text-center text-slate-400 text-xs mt-10">Belum ada riwayat pengeluaran.</p>';
        return;
    }

    pengeluaranHistory.forEach((p, idx) => {
        let isSistem = p.kasir === 'Sistem';
        let badgeSistem = isSistem ? '<span class="px-2 py-0.5 bg-slate-200 text-slate-500 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 w-max"><i class="fa-solid fa-lock"></i> Auto-Sistem</span>' : '';
        let btnAksi = '';

        if (!isSistem) {
            btnAksi = `
                <div class="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                    <button onclick="editPengeluaranMobile('${p.id}')" class="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-[10px] font-bold py-2 rounded-xl transition-colors">
                        <i class="fa-solid fa-pen-to-square"></i> Edit
                    </button>
                    <button onclick="hapusPengeluaranMobile('${p.id}')" class="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-bold py-2 rounded-xl transition-colors">
                        <i class="fa-solid fa-trash"></i> Hapus
                    </button>
                </div>
            `;
        }

        html += `
            <div class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 mb-3 flex flex-col gap-1 relative overflow-hidden group">
                <div class="flex justify-between items-start mb-1">
                    <div>
                        <p class="text-xs font-black text-slate-800">${p.kategori}</p>
                        <p class="text-[9px] font-bold text-slate-400">${p.tanggal} • ${p.waktu}</p>
                    </div>
                    <p class="text-sm font-black text-rose-600">-${rupiah(p.nominal)}</p>
                </div>
                <p class="text-[10px] text-slate-500 leading-tight">${p.keterangan || '-'}</p>
                ${badgeSistem}
                ${btnAksi}
            </div>
        `;
    });

    container.innerHTML = html;
}

async function editPengeluaranMobile(id) {
    let p = pengeluaranHistory.find(x => x.id === id);
    if (!p) return;

    let newNominalRaw = await customPrompt(`Edit Nominal Pengeluaran (Saat ini: ${rupiah(p.nominal)}):`, p.nominal);
    if (newNominalRaw === null) return;
    let newNominal = parseFloat(newNominalRaw.replace(/[^0-9]/g, ''));

    if (isNaN(newNominal) || newNominal <= 0) {
        return alert('⚠️ Nominal tidak valid.');
    }

    let delta = newNominal - p.nominal;

    if (delta > 0) {
        if (p.sumberDana === 'Tunai') {
            let saldoFisik = hitungSaldoLaciFisik();
            if (delta > saldoFisik) {
                return alert(`⚠️ AKSES DITOLAK!

Uang fisik di laci tidak cukup untuk menambah pengeluaran ini.
Sisa Laci: ${rupiah(saldoFisik)}
Kekurangan: ${rupiah(delta - saldoFisik)}`);
            }
        } else if (p.sumberDana === 'QRIS') {
            let saldoQRIS = hitungSaldoQRIS();
            if (delta > saldoQRIS) {
                return alert(`⚠️ AKSES DITOLAK!

Saldo Bank (QRIS) tidak cukup untuk menambah pengeluaran ini.
Sisa Bank: ${rupiah(saldoQRIS)}
Kekurangan: ${rupiah(delta - saldoQRIS)}`);
            }
        }
    }

    p.nominal = newNominal;
    saveApotekDB('apotek_pengeluaranHistory', pengeluaranHistory);
    renderRiwayatPengeluaranMobile();
    renderLaporanMobile();
    alert('✅ Pengeluaran berhasil diperbarui.');
}

function hapusPengeluaranMobile(id) {
    if (!confirm('Apakah Anda yakin ingin menghapus catatan pengeluaran ini? Uang akan kembali ke saldo.')) return;

    pengeluaranHistory = pengeluaranHistory.filter(x => x.id !== id);
    saveApotekDB('apotek_pengeluaranHistory', pengeluaranHistory);
    renderRiwayatPengeluaranMobile();
    renderLaporanMobile();
    alert('✅ Pengeluaran berhasil dihapus.');
}


function prosesSimpanPengeluaranMobile() {
    let kategori = document.getElementById('inputKategoriPengeluaran').value;
    let nominalRaw = document.getElementById('inputNominalPengeluaran').value.replace(/\./g, '');
    let nominal = parseFloat(nominalRaw) || 0;
    let keterangan = document.getElementById('inputKetPengeluaran').value.trim();
    let sumberDana = document.querySelector('input[name="sumberDanaPengeluaran"]:checked').value;

    if (nominal <= 0) return alert("⚠️ Nominal uang keluar tidak boleh kosong!");

    // --- 🔒 MESIN GEMBOK CERDAS GANDA ---
    if (sumberDana === 'Tunai') {
        let estimasiIsiLaci = hitungSaldoLaciFisik();
        if (nominal > estimasiIsiLaci) {
            triggerHaptic([100, 50, 100, 50]);
            return alert(`⚠️ AKSES DITOLAK!\n\nUang fisik di laci tidak cukup.\n\nSisa Laci: ${rupiah(estimasiIsiLaci)}\nAnda menarik: ${rupiah(nominal)}`);
        }
    } else if (sumberDana === 'QRIS') {
        let estimasiSaldoBank = hitungSaldoQRIS();
        if (nominal > estimasiSaldoBank) {
            triggerHaptic([100, 50, 100, 50]);
            return alert(`⚠️ AKSES DITOLAK!\n\nSaldo Bank (QRIS) di sistem tidak cukup.\n\nSisa Bank: ${rupiah(estimasiSaldoBank)}\nAnda menarik: ${rupiah(nominal)}`);
        }
    }
    // ------------------------------------------

    if (!keterangan) keterangan = kategori;
    let ketFinal = `[${sumberDana}] ${keterangan}`;

    const waktu = new Date();
    const strWaktu = waktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    pengeluaranHistory.unshift({
        id: 'OUT-' + Date.now(),
        tanggal: getTanggalLokal(),
        waktu: strWaktu,
        kategori: kategori,
        nominal: nominal,
        keterangan: ketFinal,
        kasir: 'Pemilik',
        sumberDana: sumberDana
    });

    saveApotekDB('apotek_pengeluaranHistory', pengeluaranHistory);

    document.getElementById('inputKategoriPengeluaran').value = '';
    document.getElementById('inputNominalPengeluaran').value = '';
    document.getElementById('inputKetPengeluaran').value = '';
    document.querySelector('input[name="sumberDanaPengeluaran"][value="Tunai"]').checked = true;

    const triggerText = document.getElementById('teksPilihPengeluaran');
    const triggerBtn = document.getElementById('btnTriggerPengeluaran');
    triggerText.textContent = 'Pilih pengeluaran...';
    triggerText.classList.remove('text-slate-800');
    triggerText.classList.add('text-slate-400');
    triggerBtn.classList.remove('bg-white', 'border-rose-300', 'shadow-sm');
    triggerBtn.classList.add('bg-slate-50', 'text-slate-400', 'border-slate-200', 'shadow-inner');

    tutupModalMobile('modalPengeluaranMobile');
    renderLaporanMobile();
    triggerHaptic([100, 50, 100]);
    alert(`✅ Berhasil! Saldo ${sumberDana} dipotong untuk ${kategori} senilai ${rupiah(nominal)}.`);
}



function toggleAkordeonLaporan(idElemen) {
    let el = document.getElementById(idElemen);
    let icon = document.getElementById('icon-' + idElemen);
    if(el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        if(icon) icon.style.transform = 'rotate(180deg)';
    } else {
        el.classList.add('hidden');
        if(icon) icon.style.transform = 'rotate(0deg)';
    }
}
// --- MESIN CUSTOM DROPDOWN PENGELUARAN ---
function toggleDropdownPengeluaran() {
    const menu = document.getElementById('menuKategoriPengeluaran');
    const icon = document.getElementById('iconDropdownPengeluaran');

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';
    } else {
        menu.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function pilihKategoriPengeluaran(nilaiKode, teksTampil) {
    // 1. Set nilai ke input tersembunyi
    document.getElementById('inputKategoriPengeluaran').value = nilaiKode;

    // 2. Ubah Teks dan Warna Tombol (Dari Buram menjadi Jelas)
    const triggerText = document.getElementById('teksPilihPengeluaran');
    const triggerBtn = document.getElementById('btnTriggerPengeluaran');

    triggerText.textContent = teksTampil;
    triggerText.classList.remove('text-slate-400');
    triggerText.classList.add('text-slate-800'); // Teks jadi gelap

    triggerBtn.classList.remove('bg-slate-50', 'text-slate-400', 'border-slate-200', 'shadow-inner');
    triggerBtn.classList.add('bg-white', 'border-rose-300', 'shadow-sm'); // Tombol jadi menonjol

    // 3. LOGIKA PENGUNCIAN SUMBER DANA (QRIS / LACI)
    const opsiQris = document.querySelector('input[name="sumberDanaPengeluaran"][value="QRIS"]');
    const opsiTunai = document.querySelector('input[name="sumberDanaPengeluaran"][value="Tunai"]');

    if (opsiQris && opsiTunai) {
        if (nilaiKode === 'Biaya Toko') {
            opsiTunai.checked = true; // Paksa titik pilihan kembali ke Tunai
            opsiQris.disabled = true; // Matikan fungsi tombol QRIS
            opsiQris.parentElement.classList.add('opacity-40', 'grayscale', 'pointer-events-none'); // Redupkan UI QRIS
        } else {
            opsiQris.disabled = false; // Hidupkan kembali fungsi tombol QRIS
            opsiQris.parentElement.classList.remove('opacity-40', 'grayscale', 'pointer-events-none'); // Terangkan UI QRIS
        }
    }

    // 4. Tutup Menu
    toggleDropdownPengeluaran();
}

// ==========================================
// 19. MESIN BLUETOOTH PRINTER (ESC/POS)
// ==========================================
let printerApotekTerhubung = null;

async function prosesCetakStrukMobile(idTransaksi, elemenTombol) {
    const trx = cashierHistory.find(t => t.id === idTransaksi);
    if(!trx) return alert("⚠️ Data transaksi tidak ditemukan!");

    const posTengah = (text) => { let str = text.substring(0, 32); let pad = Math.floor((32 - str.length) / 2); return " ".repeat(pad > 0 ? pad : 0) + str + " ".repeat(pad > 0 ? pad : 0) + "\n"; };

    let struk = "";
    struk += posTengah(profilApotek.nama.toUpperCase());
    struk += posTengah((profilApotek.alamat || '').substring(0,32));
    if(profilApotek.telepon) struk += posTengah("Telp: " + profilApotek.telepon);
    struk += "================================\n";
    struk += `Tgl   : ${trx.tanggal} ${trx.waktu}\n`;
    struk += `Kasir : ${trx.kasir}\n`;
    struk += "--------------------------------\n";
    struk += `${trx.obat}\n`;
    struk += `${trx.item} Item        Rp ${trx.total.toLocaleString('id-ID')}\n`;
    struk += "--------------------------------\n";
    struk += `TOTAL           : Rp ${trx.total.toLocaleString('id-ID')}\n`;
    struk += `PEMBAYARAN      : ${trx.metode.toUpperCase()}\n`;
    struk += "================================\n";
    struk += "  Terima Kasih & Semoga Sehat!  \n\n\n";

    const encoder = new TextEncoder(); let payloadAkhir = encoder.encode(struk);

    try {
        const teksAsli = elemenTombol.innerHTML; elemenTombol.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';

        if (!printerApotekTerhubung) {
            printerApotekTerhubung = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'] });
        }

        const server = await printerApotekTerhubung.gatt.connect(); const services = await server.getPrimaryServices();
        let writeCharacteristic = null;

        for (const service of services) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) { if (char.properties.write || char.properties.writeWithoutResponse) { writeCharacteristic = char; break; } }
            if (writeCharacteristic) break;
        }

        if (!writeCharacteristic) throw new Error("Printer tidak mendukung cetak");

        const CHUNK_SIZE = 100;
        for (let i = 0; i < payloadAkhir.length; i += CHUNK_SIZE) {
            let potonganData = payloadAkhir.slice(i, i + CHUNK_SIZE); await writeCharacteristic.writeValue(potonganData); await new Promise(resolve => setTimeout(resolve, 50));
        }

        elemenTombol.innerHTML = teksAsli; alert("✅ Cetak Berhasil! Struk dikeluarkan oleh printer.");
    } catch(error) {
        console.log("Error Printer:", error); printerApotekTerhubung = null; elemenTombol.innerHTML = '<i class="fa-solid fa-print"></i> Cetak';
        alert("⚠️ Gagal Mencetak! Pastikan Bluetooth HP menyala, lokasi diizinkan, dan Printer Thermal hidup.");
    }
}

// ==========================================
// 20. CLOUD SYNC & PENCARIAN
// ==========================================
const supabaseUrl = 'https://wlmcfyxccfofistofawt.supabase.co';
const supabaseKey = 'sb_publishable_KMnclwPOT_0npylv3SjBHw_s1ZdyQg9';
let supabaseClient = null;

try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    }
} catch (e) {
    console.log('Mode Offline: Koneksi Supabase tertunda.');
}

async function syncOfflineData() {
    if (!navigator.onLine || !supabaseClient) return;
    if (offlineQueue.length === 0) return;

    console.log('Mencoba push antrean offline ke Supabase...');
    const indikator = document.getElementById('indikatorCloudMobile'); const teks = document.getElementById('teksCloudMobile');
    if(indikator && teks) { indikator.classList.replace('bg-red-50', 'bg-emerald-50'); indikator.classList.replace('text-red-500', 'text-emerald-500'); indikator.classList.replace('border-red-100', 'border-emerald-100'); teks.innerText = 'SYNC QUEUE'; }

    try {
        let itemsToKeep = [];
        for (let i = 0; i < offlineQueue.length; i++) {
            const task = offlineQueue[i];
            let success = false;
            try {
                const { error } = await supabaseClient.from(task.table).upsert(task.payload, { onConflict: task.conflictKey });
                if (!error) {
                    success = true;
                } else {
                    console.error("Gagal push queue:", error);
                }
            } catch (err) {
                 console.error("Error catch queue:", err);
            }
            if (!success) {
                itemsToKeep.push(task);
            }
        }

        offlineQueue = itemsToKeep;
        saveApotekDB('arsyila_offline_queue', offlineQueue);
        if (offlineQueue.length === 0) {
           console.log('Semua antrean offline berhasil disinkronisasi.');
        }

    } catch (e) { console.log("Gagal sync offline", e); }

    setTimeout(() => { if(indikator && teks) { indikator.classList.replace('bg-emerald-50', 'bg-red-50'); indikator.classList.replace('text-emerald-500', 'text-red-500'); indikator.classList.replace('border-emerald-100', 'border-red-100'); teks.innerText = 'Live'; } }, 1500);
}

window.addEventListener('online', syncOfflineData);

async function sinkronKeAwanMobile() {
    if (!supabaseClient) {
        if (!navigator.onLine) {
            console.log('Sedang offline. Data aman di local storage.');
        }
        return;
    }

    // Pertama, jalankan sync queue dulu
    await syncOfflineData();

    const indikator = document.getElementById('indikatorCloudMobile'); const teks = document.getElementById('teksCloudMobile');

    if(indikator && teks) { indikator.classList.replace('bg-red-50', 'bg-emerald-50'); indikator.classList.replace('text-red-500', 'text-emerald-500'); indikator.classList.replace('border-red-100', 'border-emerald-100'); teks.innerText = 'SYNC'; }

    try {
        const injectToko = (arr) => arr.map(item => ({ ...item, kode_toko: activeStoreCode }));

        let payloadMaster = injectToko(masterItems);
        let payloadEtalase = injectToko(etalaseItems);
        let payloadCashier = injectToko(cashierHistory);
        let payloadPengeluaran = injectToko(pengeluaranHistory);

        if (!navigator.onLine) {
             // Jika pas mau sync ternyata putus, masuk queue aja
             if (masterItems.length > 0) offlineQueue.push({ table: 'master_items', payload: payloadMaster, conflictKey: 'nama' });
             if (etalaseItems.length > 0) offlineQueue.push({ table: 'etalase_items', payload: payloadEtalase, conflictKey: 'nama' });
             if (cashierHistory.length > 0) offlineQueue.push({ table: 'cashier_history', payload: payloadCashier, conflictKey: 'id' });
             if (pengeluaranHistory.length > 0) offlineQueue.push({ table: 'pengeluaran_history', payload: payloadPengeluaran, conflictKey: 'id' });

             saveApotekDB('arsyila_offline_queue', offlineQueue);
             return;
        }

        let failed = false;
        if (masterItems.length > 0) {
             const {error} = await supabaseClient.from('master_items').upsert(payloadMaster, { onConflict: 'nama' });
             if(error) failed = true;
        }
        if (etalaseItems.length > 0) {
             const {error} = await supabaseClient.from('etalase_items').upsert(payloadEtalase, { onConflict: 'nama' });
             if(error) failed = true;
        }
        if (cashierHistory.length > 0) {
             const {error} = await supabaseClient.from('cashier_history').upsert(payloadCashier, { onConflict: 'id' });
             if(error) failed = true;
        }
        if (pengeluaranHistory.length > 0) {
             const {error} = await supabaseClient.from('pengeluaran_history').upsert(payloadPengeluaran, { onConflict: 'id' });
             if(error) failed = true;
        }

        if (failed) throw new Error("Fetch failed");

    } catch (err) {
        console.log("Error syncing:", err);
        // Fallback to queue if the fetch fails
        let payloadMaster = injectToko(masterItems);
        let payloadEtalase = injectToko(etalaseItems);
        let payloadCashier = injectToko(cashierHistory);
        let payloadPengeluaran = injectToko(pengeluaranHistory);

        if (masterItems.length > 0) offlineQueue.push({ table: 'master_items', payload: payloadMaster, conflictKey: 'nama' });
        if (etalaseItems.length > 0) offlineQueue.push({ table: 'etalase_items', payload: payloadEtalase, conflictKey: 'nama' });
        if (cashierHistory.length > 0) offlineQueue.push({ table: 'cashier_history', payload: payloadCashier, conflictKey: 'id' });
        if (pengeluaranHistory.length > 0) offlineQueue.push({ table: 'pengeluaran_history', payload: payloadPengeluaran, conflictKey: 'id' });
        saveApotekDB('arsyila_offline_queue', offlineQueue);
    }

    setTimeout(() => { if(indikator && teks) { indikator.classList.replace('bg-emerald-50', 'bg-red-50'); indikator.classList.replace('text-emerald-500', 'text-red-500'); indikator.classList.replace('border-emerald-100', 'border-red-100'); teks.innerText = 'Live'; } }, 1500);
}

// TUGAS QW-3: CEGAH MEMORY LEAK INTERVAL CLOUD
let cloudSyncInterval = setInterval(() => {
    if (!supabaseClient) {
        clearInterval(cloudSyncInterval); // Matikan putaran interval 24 jam jika tidak ada koneksi/API Key
        return;
    }
    sinkronKeAwanMobile();
}, 10000);

document.getElementById('cariGudangMobile').addEventListener('input', (e) => { renderGudangMobile(e.target.value); });

// ==========================================
// 21. MESIN RESET TOTAL (NUKLIR CLOUD & LOKAL)
// ==========================================
function resetSistemMobile() {
    if (!navigator.onLine) {
        return alert("⚠️ AKSES DITOLAK!\n\nKoneksi internet terputus. Anda harus dalam keadaan Online agar sistem bisa memusnahkan data di server Supabase secara sinkron.");
    }

    tampilkanConfirmMobile("PERINGATAN BAHAYA!\n\nApakah Anda yakin ingin menghapus SEMUA DATA secara permanen? Data di HP dan di Cloud (Supabase) akan HANGUS TOTAL ke posisi 0.", async function() {

        if (supabaseClient && activeStoreCode) {
            try {
                await supabaseClient.from('cashier_history').delete().eq('kode_toko', activeStoreCode);
                await supabaseClient.from('pengeluaran_history').delete().eq('kode_toko', activeStoreCode);
                await supabaseClient.from('etalase_items').delete().eq('kode_toko', activeStoreCode);
                await supabaseClient.from('master_items').delete().eq('kode_toko', activeStoreCode);
            } catch (err) {
                console.log("Gagal memusnahkan data Cloud:", err);
                return alert("⚠️ TERJADI GANGGUAN PADA SERVER SUPABASE!\n\nProses reset dibatalkan otomatis untuk mencegah data pincang antara HP dan Cloud.");
            }
        }

        saveApotekDB('apotek_masterItems', []);
        saveApotekDB('apotek_etalaseItems', []);
        saveApotekDB('apotek_cashierHistory', []);
        saveApotekDB('apotek_siklusAktif', { modalAwal: 0, qtyAwal: 0, modalTambahan: 0, qtyTambahan: 0, uangMasuk: 0, tanggalStart: getTanggalLokal() });
        saveApotekDB('apotek_pengeluaranHistory', []);
        saveApotekDB('apotek_notifikasi', []);
        saveApotekDB('arsyila_offline_queue', []);

        alert("✅ NUKLIR AKTIF! Seluruh data di HP dan Cloud telah hangus tak bersisa. Memuat ulang...");
        setTimeout(() => { window.location.reload(); }, 1500);
    });
}

// ==========================================
// 22. MESIN SIDEBAR & NOTIFIKASI CHAT
// ==========================================
function bukaSidebarKiriMobile() {
    const overlay = document.getElementById('sidebarKiriOverlay'); const panel = document.getElementById('sidebarKiriMobile');
    overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); panel.classList.remove('-translate-x-full'); }, 10);
}

function tutupSidebarKiriMobile() {
    const overlay = document.getElementById('sidebarKiriOverlay'); const panel = document.getElementById('sidebarKiriMobile');
    overlay.classList.add('opacity-0'); panel.classList.add('-translate-x-full'); setTimeout(() => { overlay.classList.add('hidden'); }, 300);
}

function bukaNotifikasiMobile() {
    const overlay = document.getElementById('sidebarKananOverlay'); const panel = document.getElementById('sidebarKananMobile');
    overlay.classList.remove('hidden'); setTimeout(() => { overlay.classList.remove('opacity-0'); panel.classList.remove('translate-x-full'); }, 10);

    // Hilangkan titik merah alarm
    if(document.getElementById('badgeNotifPing')) document.getElementById('badgeNotifPing').classList.add('hidden');
    if(document.getElementById('badgeNotifSolid')) document.getElementById('badgeNotifSolid').classList.add('hidden');
    renderListNotifikasiMobile();
}

function tutupNotifikasiMobile() {
    const overlay = document.getElementById('sidebarKananOverlay'); const panel = document.getElementById('sidebarKananMobile');
    overlay.classList.add('opacity-0'); panel.classList.add('translate-x-full'); setTimeout(() => { overlay.classList.add('hidden'); batalSeleksiNotif(); }, 300);
}

// Logika Multi-Seleksi Hapus Notifikasi
let modeSeleksiNotifAktif = false;
let itemTerpilihNotif = [];
let timerLongPressNotif;

function mulaiTekanNotif(id) { if(modeSeleksiNotifAktif) return; timerLongPressNotif = setTimeout(() => { triggerHaptic(100); aktifkanModeSeleksiNotif(id); }, 500); }
function lepasTekanNotif() { clearTimeout(timerLongPressNotif); }
function klikItemNotif(id) { if(modeSeleksiNotifAktif) { togglePilihNotif(id); } }

function aktifkanModeSeleksiNotif(idPertama) {
    modeSeleksiNotifAktif = true; itemTerpilihNotif = [idPertama];
    document.getElementById('headerNormalNotif').classList.add('hidden'); document.getElementById('headerNormalNotif').classList.remove('flex');
    document.getElementById('headerSeleksiNotif').classList.remove('hidden'); document.getElementById('headerSeleksiNotif').classList.add('flex');
    renderListNotifikasiMobile();
}

function batalSeleksiNotif() {
    modeSeleksiNotifAktif = false; itemTerpilihNotif = [];
    document.getElementById('headerSeleksiNotif').classList.add('hidden'); document.getElementById('headerSeleksiNotif').classList.remove('flex');
    document.getElementById('headerNormalNotif').classList.remove('hidden'); document.getElementById('headerNormalNotif').classList.add('flex');
    renderListNotifikasiMobile();
}

function togglePilihNotif(id) {
    let idx = itemTerpilihNotif.indexOf(id);
    if(idx !== -1) itemTerpilihNotif.splice(idx, 1); else itemTerpilihNotif.push(id);
    if(itemTerpilihNotif.length === 0) batalSeleksiNotif(); else { document.getElementById('teksJumlahSeleksiNotif').textContent = itemTerpilihNotif.length + " Dipilih"; renderListNotifikasiMobile(); }
}

function pilihSemuaNotif() {
    itemTerpilihNotif = notifikasiHistori.map(n => n.id);
    document.getElementById('teksJumlahSeleksiNotif').textContent = itemTerpilihNotif.length + " Dipilih"; renderListNotifikasiMobile();
}

function prosesHapusMasalNotif() {
    if(itemTerpilihNotif.length === 0) return;
    tampilkanConfirmMobile("Hapus " + itemTerpilihNotif.length + " notifikasi yang dipilih?", function() {
        notifikasiHistori = notifikasiHistori.filter(n => !itemTerpilihNotif.includes(n.id));
        saveApotekDB('apotek_notifikasi', notifikasiHistori);
        batalSeleksiNotif(); triggerHaptic([100, 50, 100]);
    });
}

function kirimNotifikasiMobile(judul, pesan, tipe, nilaiUang) {
    const waktu = new Date(); const strWaktu = waktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    notifikasiHistori.unshift({ id: Date.now(), judul, pesan, tipe, uang: nilaiUang, waktu: strWaktu, tanggal: getTanggalLokal() });
    if(notifikasiHistori.length > 30) notifikasiHistori.pop(); // Batas maksimal 30 chat

    saveApotekDB('apotek_notifikasi', notifikasiHistori);

    // Nyalakan titik merah
    if(document.getElementById('badgeNotifPing')) document.getElementById('badgeNotifPing').classList.remove('hidden');
    if(document.getElementById('badgeNotifSolid')) document.getElementById('badgeNotifSolid').classList.remove('hidden');
    triggerHaptic([50, 100, 50]);
}

function renderListNotifikasiMobile() {
    const wadah = document.getElementById('wadahListNotifikasiMobile');
    if(notifikasiHistori.length === 0) {
        wadah.innerHTML = `<div class="text-center mt-10 opacity-40"><i class="fa-regular fa-bell-slash text-5xl mb-3 block"></i><p class="text-xs font-black uppercase tracking-widest">Belum Ada Notifikasi</p></div>`;
        return;
    }

    if(modeSeleksiNotifAktif) {
        document.getElementById('teksJumlahSeleksiNotif').textContent = itemTerpilihNotif.length + " Dipilih";
    }

    wadah.innerHTML = notifikasiHistori.map(n => {
        let warnaTema = '', icon = '';
        if(n.tipe === 'beli') { warnaTema = 'emerald'; icon = 'fa-solid fa-cash-register'; }
        else if(n.tipe === 'piutang') { warnaTema = 'red'; icon = 'fa-solid fa-book-open'; }
        else if(n.tipe === 'lunas') { warnaTema = 'blue'; icon = 'fa-solid fa-handshake'; }
        else if(n.tipe === 'batal') { warnaTema = 'amber'; icon = 'fa-solid fa-rotate-left'; }

        let isSelected = itemTerpilihNotif.includes(n.id);
        let bgCard = isSelected ? 'bg-red-50 border-red-300 shadow-md transform scale-[0.98]' : 'bg-white border-slate-200 shadow-sm';

        return `
        <div class="flex flex-col gap-1 w-full">
            <span class="text-[9px] font-bold text-slate-400 text-center mb-1 drop-shadow-sm">${n.tanggal === getTanggalLokal() ? 'Hari Ini' : n.tanggal}, ${n.waktu}</span>
            <div class="flex items-start gap-2">
                <div class="w-8 h-8 rounded-full bg-${warnaTema}-100 text-${warnaTema}-600 flex items-center justify-center shrink-0 border border-${warnaTema}-200 shadow-sm mt-1 z-10"><i class="${icon} text-[11px]"></i></div>
                <div onpointerdown="mulaiTekanNotif(${n.id})" onpointerup="lepasTekanNotif()" onpointerleave="lepasTekanNotif()" onclick="klikItemNotif(${n.id})" class="${bgCard} select-none cursor-pointer rounded-2xl rounded-tl-none p-3 flex-1 relative overflow-hidden transition-all group">
                    <div class="absolute top-0 right-0 w-10 h-10 bg-${warnaTema}-50 rounded-bl-full -z-0 opacity-50 pointer-events-none"></div>
                    <div class="relative z-10 pointer-events-none">
                        <h4 class="font-black text-${warnaTema}-700 text-xs mb-0.5 leading-tight">${n.judul}</h4>
                        <p class="text-[10px] text-slate-600 font-medium leading-relaxed">${n.pesan}</p>
                        <p class="text-xs font-black text-slate-800 mt-1.5 border-t border-slate-100 pt-1 border-dashed">${rupiah(n.uang)}</p>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// Override Fungsi Setelan Profil Untuk Mengubah Nama di Sidebar
const fungsiLamaSimpanSetelan = prosesSimpanSetelanMobile;
prosesSimpanSetelanMobile = function() {
    let namaBaru = document.getElementById('setNamaMobile').value;
    fungsiLamaSimpanSetelan();
    if(document.getElementById('namaApotekSidebar')) document.getElementById('namaApotekSidebar').innerText = namaBaru;
}

window.onload = () => {
    if (!activeStoreCode) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('appContent').classList.add('hidden');
        return;
    } else {
        initApp();
    }
};

function initApp() {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('appContent').classList.remove('hidden');

    loadApotekData();
    syncOfflineData();

    try {
        let p = JSON.parse(localStorage.getItem('apotek_profilData_' + activeStoreCode));
        if(p) {
            profilApotek = p;
            document.getElementById('namaApotekHeader').innerText = p.nama;
            if(document.getElementById('namaApotekSidebar')) document.getElementById('namaApotekSidebar').innerText = p.nama;
            document.getElementById('setNamaMobile').value = p.nama;
                    }
    } catch(e) {}
    renderBerandaMobile();
}

// ==========================================
// MESIN OTENTIKASI SUPABASE (ENTERPRISE)
// ==========================================
async function prosesLogin() {
    const emailInput = document.getElementById('loginEmail').value.trim();
    const passwordInput = document.getElementById('loginPassword').value;
    
    // PERBAIKAN: Cari tombol berdasarkan tipe submit, bukan onclick
    const btnOtorisasi = document.querySelector('button[type="submit"]');
    const teksAsli = btnOtorisasi ? btnOtorisasi.innerHTML : 'Otorisasi';

    // 1. Pencegat Kolom Kosong
    if (!emailInput || !passwordInput) {
        return alert('⚠️ Email dan Sandi Akses wajib diisi!');
    }

    // 2. Efek Loading Profesional (Aman dari Crash)
    if (btnOtorisasi) {
        btnOtorisasi.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-lg"></i> Memverifikasi...';
        btnOtorisasi.disabled = true;
    }

    try {
        // 3. Tembak Data ke Brankas Supabase
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: emailInput,
            password: passwordInput,
        });

        if (error) throw error;

        // 4. Logika Pengenalan Gerai Otomatis (Tanpa Pilihan Toko)
        let tokoTujuan = '';
        let emailChecker = emailInput.toLowerCase();
        
        if (emailChecker.includes('arsyila')) {
            tokoTujuan = 'ARSYILA';
        } else if (emailChecker.includes('anton')) {
            tokoTujuan = 'ANTON';
        } else {
            // Jika Anda menambah toko baru di masa depan
            tokoTujuan = 'UMUM'; 
        }

        // 5. Buka Gerbang Kasir
        loginSukses(tokoTujuan);

    } catch (error) {
        // Jika sandi salah atau email tidak terdaftar di Supabase
        alert('⛔ Akses Ditolak: Kredensial tidak valid atau salah sandi!');
    } finally {
        // Kembalikan Tombol ke Semula jika gagal
        if (btnOtorisasi) {
            btnOtorisasi.innerHTML = teksAsli;
            btnOtorisasi.disabled = false;
        }
    }
}


// ==========================================
// FITUR UI: BUKA/TUTUP SANDI (IKON MATA)
// ==========================================
function toggleSandi() {
    const inputSandi = document.getElementById('loginPassword');
    const ikonMata = document.getElementById('ikonMata');

    if (inputSandi.type === 'password') {
        inputSandi.type = 'text';
        ikonMata.classList.remove('fa-eye');
        ikonMata.classList.add('fa-eye-slash');
    } else {
        inputSandi.type = 'password';
        ikonMata.classList.remove('fa-eye-slash');
        ikonMata.classList.add('fa-eye');
    }
}

// ==========================================
// FITUR SEMENTARA (TOMBOL GOOGLE & LUPA SANDI)
// ==========================================
function lupaSandi() {
    alert("Protokol pemulihan sandi via email akan segera dikonfigurasi.");
}

function loginDenganGoogle() {
    alert("Sistem otentikasi Google sedang dipersiapkan untuk sinkronisasi.");
}

function loginSukses(toko) {
    activeStoreCode = toko;
    localStorage.setItem('apotek_active_store', toko);

    // Set default profile if not exists
    let p = JSON.parse(localStorage.getItem('apotek_profilData_' + toko));
    if (!p) {
        let defaultNama = toko === 'ARSYILA' ? 'TOKO OBAT ARSYILA' : 'TOKO OBAT ANTON';
        let defaultProfile = { nama: defaultNama, alamat: "Desa Bahari Dua, Buton Selatan", telepon: "081234567890" };
        localStorage.setItem('apotek_profilData_' + toko, JSON.stringify(defaultProfile));
    }

    initApp();
}

function prosesLogout() {
    localStorage.removeItem('apotek_active_store');
    window.location.reload();
}


// ==========================================
// 24. MESIN DETAIL TIGA SERANGKAI STOK (POPUP & RINCIAN)
// ==========================================
function tutupModalRingkasanMobile() {
    const modal = document.getElementById('modalRingkasanStokMobile');
    const panel = document.getElementById('panelRingkasanStokMobile');
    modal.classList.add('opacity-0'); panel.classList.add('scale-90');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

function bukaDetailTigaSerangkai(jenis) {
    let totalGudang = 0, totalEtalase = 0;
    let terjualTunai = 0, terjualQRIS = 0, terjualKasbon = 0;

    // Mesin Hitung Sisa
    masterItems.forEach(m => { if(m.nama !== '___SYSTEM_AUTH___' && m.kategori !== '⚠️ Barang Retur') totalGudang += m.stok; });
    etalaseItems.forEach(e => { totalEtalase += e.stok; });

    // Mesin Hitung Terjual
    let waktuMulai = siklusAktif.waktuStart || 0;
    cashierHistory.filter(t => (waktuMulai ? t.id >= waktuMulai : t.tanggal >= siklusAktif.tanggalStart) && !t.isPelunasan).forEach(trx => {
        let qty = 0;
        if(trx.detailKeranjang) { trx.detailKeranjang.forEach(i => qty += i.qty); } else { qty = trx.item || 1; }
        if(trx.metode === 'Tunai') terjualTunai += qty;
        else if(trx.metode === 'QRIS') terjualQRIS += qty;
        else if(trx.metode === 'Debt') terjualKasbon += qty;
    });

    let sisaTotal = totalGudang + totalEtalase;
    let terjualTotal = terjualTunai + terjualQRIS + terjualKasbon;
    let absolutTotal = siklusAktif.waktuStart ? (siklusAktif.qtyTambahan || 0) : (sisaTotal + terjualTotal);

    // --- LOMPATAN LOGIKA UNTUK TOTAL MODAL STOK ---
    if (jenis === 'total') {
        tampilkanConfirmMobile(`Modal Stok pembukuan Baru sebanyak ${absolutTotal} stok.\n\nCek rincian di Master Gudang?`, function() {
            bukaLayar('gudang');
        });
        return; // Hentikan fungsi di sini agar pop-up tengah tidak muncul
    }

    const icon = document.getElementById('iconRingkasanStok');
    const judul = document.getElementById('judulRingkasanStok');
    const subJudul = document.getElementById('subJudulRingkasanStok');
    const rincianArea = document.getElementById('areaRincianRingkasan');
    const totalAngka = document.getElementById('angkaRingkasanTotal');
    const btnLanjut = document.getElementById('btnLanjutRincianStok');

    // Desain Pop-up Tengah Dinamis (Pcs diganti Stok)
    if (jenis === 'sisa') {
        icon.innerHTML = '<i class="fa-solid fa-boxes-stacked"></i>';
        icon.className = 'h-16 w-16 rounded-full bg-blue-50 border-4 border-white shadow-sm flex items-center justify-center mb-3 relative z-10 text-blue-500 text-2xl';
        judul.textContent = "Sisa Stok (Tersedia)"; subJudul.textContent = "Gudang & Etalase";

        rincianArea.innerHTML = `
            <div class="flex justify-between items-center mb-3"><span class="text-xs font-bold text-slate-500 flex items-center gap-2"><i class="fa-solid fa-box text-slate-400 w-4 text-center"></i> Stok Gudang</span><span class="text-sm font-black text-slate-700">${totalGudang} Stok</span></div>
            <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-slate-500 flex items-center gap-2"><i class="fa-solid fa-store text-slate-400 w-4 text-center"></i> Stok Etalase</span><span class="text-sm font-black text-slate-700">${totalEtalase} Stok</span></div>
        `;
        totalAngka.textContent = sisaTotal; totalAngka.className = "text-3xl font-black text-blue-600 tracking-tighter drop-shadow-sm";
    } else if (jenis === 'terjual') {
        icon.innerHTML = '<i class="fa-solid fa-cart-arrow-down"></i>';
        icon.className = 'h-16 w-16 rounded-full bg-amber-50 border-4 border-white shadow-sm flex items-center justify-center mb-3 relative z-10 text-amber-500 text-2xl';
        judul.textContent = "Stok Terjual"; subJudul.textContent = "Berdasarkan Pembayaran";

        rincianArea.innerHTML = `
            <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-slate-500 flex items-center gap-2"><i class="fa-solid fa-money-bill-wave text-emerald-400 w-4 text-center"></i> Tunai</span><span class="text-sm font-black text-slate-700">${terjualTunai} Stok</span></div>
            <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-slate-500 flex items-center gap-2"><i class="fa-solid fa-qrcode text-blue-400 w-4 text-center"></i> QRIS</span><span class="text-sm font-black text-slate-700">${terjualQRIS} Stok</span></div>
            <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-slate-500 flex items-center gap-2"><i class="fa-solid fa-book-open text-red-400 w-4 text-center"></i> Kasbon</span><span class="text-sm font-black text-slate-700">${terjualKasbon} Stok</span></div>
        `;
        totalAngka.textContent = terjualTotal; totalAngka.className = "text-3xl font-black text-amber-500 tracking-tighter drop-shadow-sm";
    }

    // Sambungkan tombol Lanjut
    btnLanjut.setAttribute('onclick', `lanjutBukaDaftarRincian('${jenis}')`);

    // Tampilkan Modal Popup Tengah
    const modal = document.getElementById('modalRingkasanStokMobile');
    const panel = document.getElementById('panelRingkasanStokMobile');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); panel.classList.remove('scale-90'); }, 10);
}

// Transisi Halus dari Pop-up ke Layar Bawah
function lanjutBukaDaftarRincian(jenis) {
    tutupModalRingkasanMobile();
    setTimeout(() => {
        prosesRenderDetailTigaSerangkai(jenis);
    }, 250);
}

// Ini adalah proses Render Layar Bawah (Gambar 2)
function prosesRenderDetailTigaSerangkai(jenis) {
    const wadah = document.getElementById('wadahListDetailStok');
    const judul = document.getElementById('judulDetailStok');
    const subJudul = document.getElementById('subJudulDetailStok');

    let totalQty = 0; let totalNominal = 0; let htmlContent = '';

    const buatKotakTipis = (namaHtml, kategoriHtml, modal, jual, qty, warnaPita = 'bg-slate-300') => `
        <div class="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center justify-between shadow-sm relative overflow-hidden">
            <div class="absolute left-0 top-0 bottom-0 w-1 ${warnaPita}"></div>
            <div class="pl-2 flex-1">
                <div class="mb-1">${namaHtml}</div>
                ${kategoriHtml}
                <div class="text-[9px] font-bold text-slate-500 mt-1 flex gap-2">
                    <span>Beli: <span class="text-red-500">${rupiah(modal)}</span></span>
                    <span>Jual: <span class="text-emerald-600">${rupiah(jual)}</span></span>
                </div>
            </div>
            <div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 text-center shrink-0">
                <span class="block text-sm font-black text-corporate-700 leading-none">${qty}</span>
            </div>
        </div>`;

    const buatSubJudul = (teks, icon, warna) => `
        <div class="flex items-center gap-2 mt-4 mb-1.5 pl-1">
            <div class="w-5 h-5 rounded-md ${warna} flex items-center justify-center text-[10px]"><i class="${icon}"></i></div>
            <span class="text-[10px] font-black text-slate-600 uppercase tracking-widest">${teks}</span>
        </div>`;

        if (jenis === 'sisa') {
        judul.textContent = "Sisa Stok (Tersedia)"; subJudul.textContent = "Gudang & Etalase";
        let gabungan = {};

        masterItems.forEach(m => { if(m.nama !== '___SYSTEM_AUTH___' && m.kategori !== '⚠️ Barang Retur') {
            let kunci = m.dnaInduk; let namaLengkap = m.nama + (m.varian ? ` ${m.varian}` : '');
            if(!gabungan[kunci]) gabungan[kunci] = { dnaInduk: m.dnaInduk, namaAsli: m.nama, varian: m.varian, kategori: m.kategori, nama: namaLengkap, modal: m.modal, jual: m.jual, qty: 0 };
            gabungan[kunci].qty += m.stok;
        }});
        etalaseItems.forEach(e => {
            let kunci = e.dnaInduk || e.nama; let namaLengkap = e.nama + (e.varian ? ` ${e.varian}` : '');
            if(!gabungan[kunci]) gabungan[kunci] = { dnaInduk: e.dnaInduk, namaAsli: e.nama, varian: e.varian, kategori: e.kategori, nama: namaLengkap, modal: (e.antreanFIFO && e.antreanFIFO[0]?.modal) || 0, jual: e.jual, qty: 0 };
            gabungan[kunci].qty += e.stok;
        });

        Object.values(gabungan).forEach(item => {
            if(item.qty > 0) {
                totalQty += item.qty; totalNominal += (item.qty * item.jual);
                let infoFormat = formatNamaItemMaster(item.dnaInduk, item.namaAsli, item.varian, item.kategori, 'text-xs truncate pr-2');
                htmlContent += buatKotakTipis(infoFormat.namaHtml, infoFormat.kategoriHtml, item.modal, item.jual, item.qty, 'bg-blue-400');
            }
        });

    } else if (jenis === 'terjual') {
        judul.textContent = "Stok Terjual"; subJudul.textContent = "Dikelompokkan Berdasarkan Pembayaran";

        let jualTunai = {}, jualQRIS = {}, jualKasbon = {};
        let waktuMulai = siklusAktif.waktuStart || 0;

        cashierHistory.filter(t => (waktuMulai ? t.id >= waktuMulai : t.tanggal >= siklusAktif.tanggalStart) && !t.isPelunasan).forEach(trx => {
            let targetGroup = trx.metode === 'Tunai' ? jualTunai : (trx.metode === 'QRIS' ? jualQRIS : jualKasbon);

                        if(trx.detailKeranjang) {
                trx.detailKeranjang.forEach(item => {
                    let kunci = item.dnaInduk || item.nama;
                    let namaLengkap = item.nama + (item.varian ? ` ${item.varian}` : '');
                    if(!targetGroup[kunci]) targetGroup[kunci] = { dnaInduk: item.dnaInduk, namaAsli: item.nama, varian: item.varian, kategori: item.kategori, nama: namaLengkap, modal: item.hppSatuan || (item.jual*0.8), jual: item.jual, qty: 0 };
                    targetGroup[kunci].qty += item.qty;
                });
            } else {

                if(!targetGroup[trx.obat]) targetGroup[trx.obat] = { dnaInduk: null, namaAsli: trx.obat, varian: '', kategori: '', nama: trx.obat, modal: ((trx.total||0)-(trx.laba||0))/(trx.item||1), jual: (trx.total||0)/(trx.item||1), qty: 0 };
                targetGroup[trx.obat].qty += (trx.item||1);
            }
        });

        const prosesGrup = (grupData, pitaClass) => {
            let html = '';
            Object.values(grupData).forEach(item => {
                totalQty += item.qty; totalNominal += (item.qty * item.jual);
                let infoFormat = formatNamaItemMaster(item.dnaInduk, item.namaAsli, item.varian, item.kategori, 'text-xs truncate pr-2');
                html += buatKotakTipis(infoFormat.namaHtml, infoFormat.kategoriHtml, item.modal, item.jual, item.qty, pitaClass);
            });
            return html;
        };

        let htmlTunai = prosesGrup(jualTunai, 'bg-emerald-400');
        if(htmlTunai) htmlContent += buatSubJudul('Pembayaran Tunai', 'fa-solid fa-money-bill', 'bg-emerald-100 text-emerald-600') + htmlTunai;

        let htmlQRIS = prosesGrup(jualQRIS, 'bg-blue-400');
        if(htmlQRIS) htmlContent += buatSubJudul('Pembayaran Digital (QRIS)', 'fa-solid fa-qrcode', 'bg-blue-100 text-blue-600') + htmlQRIS;

        let htmlKasbon = prosesGrup(jualKasbon, 'bg-red-400');
        if(htmlKasbon) htmlContent += buatSubJudul('Tunggakan (Kasbon)', 'fa-solid fa-book-open', 'bg-red-100 text-red-600') + htmlKasbon;

    } else if (jenis === 'total') {
        judul.textContent = "Total Keseluruhan Stok"; subJudul.textContent = "Sisa Stok + Terjual";
        htmlContent = `<div class="p-6 text-center text-slate-500 mt-10"><i class="fa-solid fa-layer-group text-4xl mb-3 text-slate-300"></i><p class="text-xs font-bold leading-relaxed">Daftar Lengkap di Panel Spesifik<br><br>Silakan buka panel Sisa atau Terjual secara terpisah untuk melihat rincian daftarnya secara spesifik.</p></div>`;
        totalQty = parseInt(document.getElementById('panelStokTotal').textContent);
        totalNominal = 0;
    }

    if(!htmlContent && jenis !== 'total') htmlContent = `<div class="p-6 text-center text-slate-400 mt-4 text-xs font-bold">Data kosong.</div>`;

    document.getElementById('rekapQtyDetailStok').textContent = totalQty + " Pcs";
    document.getElementById('rekapNominalDetailStok').textContent = jenis === 'total' ? "-" : rupiah(totalNominal);
    wadah.innerHTML = htmlContent;
    bukaModalMobile('modalDetailStokMobile', 'panelDetailStokMobile');
}

// ==========================================
// MESIN EXPORT LAPORAN KE MICROSOFT WORD (A4 LANDSCAPE)
// ==========================================
function exportLaporanKeWord() {
    let dataPeriode = cashierHistory.filter(t => t.tanggal >= laporanTglAwal && t.tanggal <= laporanTglAkhir && t.tanggal !== '2000-01-01');
    let dataKeluar = pengeluaranHistory.filter(p => p.tanggal >= laporanTglAwal && p.tanggal <= laporanTglAkhir && p.tanggal !== '2000-01-01');

    if(dataPeriode.length === 0 && dataKeluar.length === 0) return alert("Data kosong! Belum ada transaksi pada rentang tanggal ini.");

    // 1. Kalkulasi Laba / Rugi (Income Statement)
    let lOmset = 0, lHPP = 0, omzetTunai = 0, omzetQRIS = 0, omzetDebt = 0;
    let htmlTabel = ""; let urut = 1;

    dataPeriode.forEach(t => {
        let hpp = 0, omzet = 0, laba = 0;
        let qty = t.item, namaObat = t.obat;

        if(!t.isPelunasan) {
            omzet = t.total; laba = t.laba; hpp = (t.total - t.laba);
            lOmset += omzet; lHPP += hpp;
            if(t.metode === 'Tunai') omzetTunai += omzet;
            else if(t.metode === 'QRIS') omzetQRIS += omzet;
            else if(t.metode === 'Debt') omzetDebt += omzet;

            if (t.detailKeranjang && t.detailKeranjang.length > 0) {
                namaObat = t.detailKeranjang.map(item => {
                    let infoFormat = formatNamaItemMaster(item.dnaInduk, item.nama, item.varian, item.kategori, '');
                    return infoFormat.namaLengkapTxt + ' [' + infoFormat.kategoriTxt + ']';
                }).join('<br>');
            } else {
                let infoFormat = formatNamaItemMaster(null, t.obat, '', '', '');
                namaObat = infoFormat.namaLengkapTxt + ' [' + infoFormat.kategoriTxt + ']';
            }
        } else {
            qty = "-"; namaObat = "PELUNASAN KASBON (" + (t.pelanggan || 'Pelanggan') + ")";
            omzet = t.total;
        }

        htmlTabel += `
            <tr>
                <td style="border: 1px solid #000; padding: 4px; text-align: center;">${urut++}</td>
                <td style="border: 1px solid #000; padding: 4px; text-align: center;">${t.tanggal} ${t.waktu}</td>
                <td style="border: 1px solid #000; padding: 4px;">${namaObat}</td>
                <td style="border: 1px solid #000; padding: 4px; text-align: center;">${qty}</td>
                <td style="border: 1px solid #000; padding: 4px; text-align: center;">${t.metode}</td>
                <td style="border: 1px solid #000; padding: 4px; text-align: right; font-family: monospace;">${hpp > 0 ? rupiah(Math.round(hpp)) : '-'}</td>
                <td style="border: 1px solid #000; padding: 4px; text-align: right; font-family: monospace;">${rupiah(Math.round(omzet))}</td>
                <td style="border: 1px solid #000; padding: 4px; text-align: right; font-family: monospace;">${laba > 0 ? rupiah(Math.round(laba)) : '-'}</td>
            </tr>`;
    });

    let bBiayaToko = 0;
    dataKeluar.forEach(p => { if (p.kategori === 'Biaya Toko') bBiayaToko += p.nominal; });
    let kerugianPenyusutan = siklusAktif.modalDihapus || 0;
    let labaBersihSejati = (lOmset - lHPP) - bBiayaToko - kerugianPenyusutan;
        // 2. Kalkulasi Neraca Kekayaan Lintas Waktu (Balance Sheet)
    let estimasiIsiLaci = hitungSaldoLaciFisik();
    let hartaQRIS = hitungSaldoQRIS();
    let hartaPiutang = 0, hutangMap = {};

    cashierHistory.forEach(t => {
        if(t.metode === 'Debt' || t.isPelunasan) {
            if(t.metode === 'Debt' && !t.statusLunas) hutangMap[t.id] = t.total;
            if(t.isPelunasan && t.idTerkait && hutangMap[t.idTerkait]) hutangMap[t.idTerkait] -= t.total;
        }
    });

    Object.values(hutangMap).forEach(v => { if(v > 0) hartaPiutang += v; });

    let rekapAset = kalkulasiAsetFisik();
    let sisaQtyReal = rekapAset.totalQty, sisaRpReal = rekapAset.totalAset;

    // 3. Kalkulasi Persediaan
    let terjualQtySiklus = 0, terjualRpSiklus = 0;
    let wMulai = siklusAktif.waktuStart || 0;
    cashierHistory.filter(t => (wMulai ? t.id >= wMulai : t.tanggal >= siklusAktif.tanggalStart) && !t.isPelunasan).forEach(t => {
        terjualQtySiklus += (t.item || 1); terjualRpSiklus += ((t.total || 0) - (t.laba || 0));
    });
    let totalQtyTersedia = (siklusAktif.qtyAwal || 0) + (siklusAktif.qtyTambahan || 0);
    let totalModalTersedia = (siklusAktif.modalAwal || 0) + (siklusAktif.modalTambahan || 0);

    let dNow = new Date();
    let strWaktuCetak = dNow.toLocaleDateString('id-ID') + " " + dNow.toLocaleTimeString('id-ID');

    // --- HTML WORD CONSTRUCTION ---
    let header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>";
    header += "<head><meta charset='utf-8'><title>Buku Besar Apotek</title>";
    header += `
    <style>
        @page WordSection1 { size: 841.95pt 595.35pt; mso-page-orientation: landscape; margin: 1cm; }
        div.WordSection1 { page: WordSection1; font-family: 'Arial', sans-serif; font-size: 10pt; color: #000; }
        table { border-collapse: collapse; width: 100%; }
        th { background-color: #e0e0e0; color: #000; border: 1px solid #000; padding: 6px; font-weight: bold; text-align: center; }
        td { border: 1px solid #000; padding: 4px; }
        .title { text-align: left; font-size: 18pt; font-weight: bold; text-transform: uppercase; margin-bottom: 2px;}
        .subtitle { text-align: left; font-size: 10pt; font-weight: bold; margin-bottom: 15px; }
        .info-table { border: none; margin-bottom: 15px; width: 60%; }
        .info-table td { border: none; padding: 2px; }
        .ledger-box { border: 1px solid #000; padding: 8px; vertical-align: top; }
        .l-title { font-weight: bold; background: #e0e0e0; text-align: center; padding: 4px; border-bottom: 1px solid #000; margin-bottom: 5px; text-transform: uppercase;}
        .r-val { text-align: right; font-family: monospace; font-weight: bold; }
    </style>
    </head><body><div class='WordSection1'>
    `;

    let content = `
    <div class="title">${profilApotek.nama}</div>
    <div class="subtitle">Buku Besar & Neraca Keuangan Komprehensif</div>

    <table class="info-table">
        <tr><td width="15%"><b>Periode</b></td><td width="35%">: ${laporanLabelVisual}</td><td width="15%"><b>Kasir</b></td><td width="35%">: Sistem Laporan</td></tr>
        <tr><td><b>Dicetak</b></td><td>: ${strWaktuCetak}</td><td><b>Trx</b></td><td>: ${urut - 1} Nota</td></tr>
    </table>

    <h3 style="font-size: 11pt; margin-bottom: 5px; text-transform: uppercase; border-bottom:1px solid #000;">A. Rincian Buku Harian Transaksi</h3>
    <table style="margin-bottom: 20px;">
        <thead>
            <tr><th width="4%">No</th><th width="12%">Waktu</th><th width="28%">Nama Obat / Keterangan</th><th width="6%">Qty</th><th width="10%">Metode</th><th width="13%">HPP Keluar</th><th width="13%">Omzet</th><th width="14%">Laba Kotor</th></tr>
        </thead>
        <tbody>${htmlTabel}</tbody>
    </table>

    <table style="width: 100%; border: none; margin-top: 10px;">
        <tr>
            <!-- BLOK I -->
            <td width="32%" class="ledger-box">
                <div class="l-title">I. Alur Modal Persediaan</div>
                <table style="border:none; width:100%;">
                    <tr><td style="border:none; padding:2px;">Modal Awal / Titik Nol</td><td class="r-val" style="border:none; padding:2px;">${siklusAktif.qtyAwal} Pcs</td></tr>
                    <tr><td style="border:none; padding:2px;"></td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(siklusAktif.modalAwal))}</td></tr>
                    <tr><td style="border:none; padding:2px;">(+) Suntikan Kulakan</td><td class="r-val" style="border:none; padding:2px;">${siklusAktif.qtyTambahan} Pcs</td></tr>
                    <tr><td style="border:none; padding:2px; border-bottom: 1px solid #000;"></td><td class="r-val" style="border:none; padding:2px; border-bottom: 1px solid #000;">${rupiah(Math.round(siklusAktif.modalTambahan))}</td></tr>
                                        <tr><td style="border:none; padding:2px; font-weight:bold;">Sedia Dijual</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(totalModalTersedia))}</td></tr>
                    <tr><td style="border:none; padding:2px;">(-) Terjual (HPP)</td><td class="r-val" style="border:none; padding:2px;">${terjualQtySiklus} Pcs</td></tr>
                    <tr><td style="border:none; padding:2px;"></td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(terjualRpSiklus))}</td></tr>
                    <tr><td style="border:none; padding:2px;">(-) Rusak / Hilang / Exp</td><td class="r-val" style="border:none; padding:2px;">${siklusAktif.qtyDihapus || 0} Pcs</td></tr>       <tr><td style="border:none; padding:2px; border-bottom: 1px solid #000;"></td><td class="r-val" style="border:none; padding:2px; border-bottom: 1px solid #000;">${rupiah(Math.round(siklusAktif.modalDihapus || 0))}</td></tr>
                    <tr><td style="border:none; padding:4px 2px; font-weight:bold;">ASET RAK SISA</td><td class="r-val" style="border:none; padding:4px 2px;">${rupiah(Math.round(sisaRpReal))}</td></tr>
                </table>
            </td>
            <td width="2%" style="border:none;"></td>
            <!-- BLOK II -->
            <td width="32%" class="ledger-box">
                <div class="l-title">II. Kinerja Laba Rugi</div>
                <table style="border:none; width:100%;">
                    <tr><td style="border:none; padding:2px;">Omzet Tunai</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(omzetTunai))}</td></tr>
                    <tr><td style="border:none; padding:2px;">Omzet QRIS</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(omzetQRIS))}</td></tr>
                    <tr><td style="border:none; padding:2px; border-bottom: 1px solid #000;">Omzet Piutang</td><td class="r-val" style="border:none; padding:2px; border-bottom: 1px solid #000;">${rupiah(Math.round(omzetDebt))}</td></tr>
                    <tr><td style="border:none; padding:2px; font-weight:bold;">Total Omzet</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(lOmset))}</td></tr>
                    <tr><td style="border:none; padding:2px;">(-) HPP Keluar</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(lHPP))}</td></tr>
                    <tr><td style="border:none; padding:2px;">(-) Biaya Toko</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(bBiayaToko))}</td></tr>
                    <tr><td style="border:none; padding:2px; border-bottom: 1px solid #000;">(-) Brg Rusak/Exp</td><td class="r-val" style="border:none; padding:2px; border-bottom: 1px solid #000;">${rupiah(Math.round(kerugianPenyusutan))}</td></tr>
                    <tr><td style="border:none; padding:4px 2px; font-weight:bold;">LABA BERSIH</td><td class="r-val" style="border:none; padding:4px 2px;">${rupiah(Math.round(labaBersihSejati))}</td></tr>    </table>
            </td>
            <td width="2%" style="border:none;"></td>
            <!-- BLOK III -->
            <td width="32%" class="ledger-box">
                <div class="l-title">III. Neraca Kekayaan</div>
                <table style="border:none; width:100%;">
                    <tr><td style="border:none; padding:2px;">1. Harta Tunai Laci</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(estimasiIsiLaci))}</td></tr>
                    <tr><td style="border:none; padding:2px;">2. Harta Bank QRIS</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(hartaQRIS))}</td></tr>
                    <tr><td style="border:none; padding:2px;">3. Harta Piutang</td><td class="r-val" style="border:none; padding:2px;">${rupiah(Math.round(hartaPiutang))}</td></tr>
                    <tr><td style="border:none; padding:2px; border-bottom: 1px solid #000;">4. Harta Stok Barang</td><td class="r-val" style="border:none; padding:2px; border-bottom: 1px solid #000;">${rupiah(Math.round(sisaRpReal))}</td></tr>
                    <tr><td style="border:none; padding:4px 2px; font-weight:bold;">TOTAL ASET KESELURUHAN</td><td class="r-val" style="border:none; padding:4px 2px;">${rupiah(Math.round(estimasiIsiLaci + hartaQRIS + hartaPiutang + sisaRpReal))}</td></tr>
                </table>
            </td>
        </tr>
    </table>
    `;

    let footer = "</div></body></html>";
    let fullHTML = header + content + footer;

    let blob = new Blob(['\ufeff', fullHTML], { type: 'application/msword' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "BukuBesar_" + laporanLabelVisual.replace(/\s/g, '_') + ".doc";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    alert("✅ File Laporan Word berhasil diunduh ke perangkat Anda!");
}

function toggleDropdownExportPDF() {
    const panel = document.getElementById('panelExportPDF');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
    } else {
        panel.classList.add('hidden');
    }
}

function exportPDFHarian() {
    let tglHariIni = getTanggalLokal(new Date());
    exportLaporanKePDFInternal(tglHariIni, tglHariIni, "Laporan Harian", false);
}

function exportPDFBulanan() {
    let tglHariIni = getTanggalLokal(new Date());
    exportLaporanKePDFInternal(siklusAktif.tanggalStart, tglHariIni, "Laporan Bulanan/Siklus", false);
}

function exportPDFArsip() {
    exportLaporanKePDFInternal('2000-01-01', '2000-01-01', "LAPORAN ARSIP AKUMULASI MASA LALU", true);
}

// ==========================================
// MESIN CETAK LAPORAN KE PDF (A4 LANDSCAPE STRICT LEDGER)
// ==========================================
function exportLaporanKePDFInternal(tglAwal, tglAkhir, judulPDF, isArsip) {
    let dataPeriode = cashierHistory.filter(t => t.tanggal >= tglAwal && t.tanggal <= tglAkhir && (isArsip ? t.tanggal === '2000-01-01' : t.tanggal !== '2000-01-01'));
    let dataKeluar = pengeluaranHistory.filter(p => p.tanggal >= tglAwal && p.tanggal <= tglAkhir && (isArsip ? p.tanggal === '2000-01-01' : p.tanggal !== '2000-01-01'));
    let dataPenyusutan = historiPenyusutan.filter(p => p.tanggal >= tglAwal && p.tanggal <= tglAkhir && (isArsip ? p.tanggal === '2000-01-01' : p.tanggal !== '2000-01-01'));

    if(dataPeriode.length === 0 && dataKeluar.length === 0 && dataPenyusutan.length === 0) return alert("Data kosong! Belum ada transaksi pada rentang tanggal ini.");

    // 1. Kalkulasi Laba / Rugi (Income Statement)
    let lOmset = 0, lHPP = 0, omzetTunai = 0, omzetQRIS = 0, omzetDebt = 0;

    // Grouping transactions
    let groupedSales = {};
    let lunasList = [];

    dataPeriode.forEach(t => {
        if(!t.isPelunasan) {
            let omzet = t.total;
            let laba = t.laba;
            let hpp = (t.total - t.laba);

            lOmset += omzet; lHPP += hpp;
            if(t.metode === 'Tunai') omzetTunai += omzet;
            else if(t.metode === 'QRIS') omzetQRIS += omzet;
            else if(t.metode === 'Debt') omzetDebt += omzet;

            if (t.detailKeranjang && t.detailKeranjang.length > 0) {
                t.detailKeranjang.forEach(item => {
                    let infoFormat = formatNamaItemMaster(item.dnaInduk, item.nama, item.varian, item.kategori, '');
                    let namaLengkap = infoFormat.namaLengkapTxt + (infoFormat.kategoriTxt ? ' [' + infoFormat.kategoriTxt + ']' : '');

                    let key = namaLengkap + '|' + t.metode;
                    if(!groupedSales[key]) {
                        groupedSales[key] = { nama: namaLengkap, metode: t.metode, qty: 0, hpp: 0, omzet: 0, laba: 0 };
                    }
                    let itemHpp = item.hppTotalModal !== undefined ? item.hppTotalModal : ((item.hppSatuan || (item.jual * 0.8)) * item.qty);
                    let itemOmzet = (item.jual || 0) * item.qty;

                    groupedSales[key].qty += item.qty;
                    groupedSales[key].hpp += itemHpp;
                    groupedSales[key].omzet += itemOmzet;
                    groupedSales[key].laba += (itemOmzet - itemHpp);
                });
            } else {
                let infoFormat = formatNamaItemMaster(null, t.obat, '', '', '');
                let namaLengkap = infoFormat.namaLengkapTxt + (infoFormat.kategoriTxt ? ' [' + infoFormat.kategoriTxt + ']' : '');

                let key = namaLengkap + '|' + t.metode;
                if(!groupedSales[key]) {
                    groupedSales[key] = { nama: namaLengkap, metode: t.metode, qty: 0, hpp: 0, omzet: 0, laba: 0 };
                }
                groupedSales[key].qty += t.item;
                groupedSales[key].hpp += hpp;
                groupedSales[key].omzet += omzet;
                groupedSales[key].laba += laba;
            }
        } else {
            lunasList.push(t);
        }
    });

    let isiTabelHTML = "";
    let urut = 1;
    for (let key in groupedSales) {
        let g = groupedSales[key];
        isiTabelHTML += `<tr>
            <td class="text-center">${urut++}</td>
            <td>${g.nama}</td>
            <td class="text-center">${g.metode}</td>
            <td class="text-center">${g.qty}</td>
            <td class="text-right t-num">${rupiah(Math.round(g.hpp))}</td>
            <td class="text-right t-num">${rupiah(Math.round(g.omzet))}</td>
            <td class="text-right t-num">${rupiah(Math.round(g.laba))}</td>
        </tr>`;
    }

    lunasList.forEach(t => {
        isiTabelHTML += `<tr>
            <td class="text-center">${urut++}</td>
            <td>Pelunasan Kasbon: ${t.keterangan || '-'}</td>
            <td class="text-center">Tunai</td>
            <td class="text-center">-</td>
            <td class="text-right t-num">Rp 0</td>
            <td class="text-right t-num">${rupiah(Math.round(t.total))}</td>
            <td class="text-right t-num">${rupiah(Math.round(t.laba))}</td>
        </tr>`;
        lOmset += t.total;
        omzetTunai += t.total;
    });

    if(urut === 1) isiTabelHTML = `<tr><td colspan="7" class="text-center">Belum ada transaksi</td></tr>`;

    let isiTabelRusakHTML = "";
    let urutRusak = 1;
    let totalKerugianTabel = 0;

    dataPenyusutan.forEach(p => {
        let kerugian = p.totalKerugian || 0;
        totalKerugianTabel += kerugian;
        isiTabelRusakHTML += `<tr>
            <td class="text-center">${urutRusak++}</td>
            <td>${p.namaLengkap} ${p.kategori ? '['+p.kategori+']' : ''}</td>
            <td>${p.jenisMasalah} ${p.keteranganMasalah ? '- ' + p.keteranganMasalah : ''}</td>
            <td class="text-center">${p.qtyDibuang}</td>
            <td class="text-right t-num">${rupiah(Math.round(kerugian))}</td>
        </tr>`;
    });

    if(urutRusak === 1) isiTabelRusakHTML = `<tr><td colspan="5" class="text-center">Belum ada barang rusak/kedaluwarsa</td></tr>`;

    let bBiayaToko = 0;
    dataKeluar.forEach(p => { if (p.kategori === 'Biaya Toko') bBiayaToko += p.nominal; });
    let kerugianPenyusutan = totalKerugianTabel;
    let labaBersihSejati = (lOmset - lHPP) - bBiayaToko - kerugianPenyusutan;
    // 2. Kalkulasi Neraca Kekayaan Lintas Waktu (Balance Sheet)
    let estimasiIsiLaci = hitungSaldoLaciFisik();
    let hartaQRIS = hitungSaldoQRIS();
    let hartaPiutang = 0, hutangMap = {};

    cashierHistory.forEach(t => {
        if(t.metode === 'Debt' || t.isPelunasan) {
            if(t.metode === 'Debt' && !t.statusLunas) hutangMap[t.id] = t.total;
            if(t.isPelunasan && t.idTerkait && hutangMap[t.idTerkait]) hutangMap[t.idTerkait] -= t.total;
        }
    });

    Object.values(hutangMap).forEach(v => { if(v > 0) hartaPiutang += v; });

    let rekapAset = kalkulasiAsetFisik();
    let sisaQtyReal = rekapAset.totalQty, sisaRpReal = rekapAset.totalAset;

    // 3. Kalkulasi Persediaan
    let terjualQtySiklus = 0, terjualRpSiklus = 0;
    let wMulai = siklusAktif.waktuStart || 0;
    cashierHistory.filter(t => (wMulai ? t.id >= wMulai : t.tanggal >= siklusAktif.tanggalStart) && !t.isPelunasan).forEach(t => {
        terjualQtySiklus += (t.item || 1); terjualRpSiklus += ((t.total || 0) - (t.laba || 0));
    });
    let totalQtyTersedia = (siklusAktif.qtyAwal || 0) + (siklusAktif.qtyTambahan || 0);
    let totalModalTersedia = (siklusAktif.modalAwal || 0) + (siklusAktif.modalTambahan || 0);

    // --- SUNTIK DATA KE DOM HTML CETAK ---
    let dNow = new Date();
    document.getElementById('p-waktu-cetak').innerText = dNow.toLocaleDateString('id-ID') + " " + dNow.toLocaleTimeString('id-ID');
    document.getElementById('p-nama-apotek').innerText = profilApotek.nama.toUpperCase();
    document.getElementById('p-owner').innerText = profilApotek.nama;
    document.getElementById('p-tgl').innerText = judulPDF;
    document.getElementById('p-trx').innerText = (urut - 1) + " Nota";

    // Ubah main title jika ada
    let titleEl = document.querySelector('.brand-text h1');
    if (titleEl) {
        if (isArsip) {
            titleEl.dataset.originalTitle = titleEl.innerText;
            titleEl.innerText = "LAPORAN ARSIP AKUMULASI MASA LALU";
        } else if (titleEl.dataset.originalTitle) {
            titleEl.innerText = titleEl.dataset.originalTitle;
        }
    }

    // Tabel Trx
    document.getElementById('p-tabel-body').innerHTML = isiTabelHTML;
    let elTabelRusak = document.getElementById('p-tabel-rusak-body');
    if (elTabelRusak) elTabelRusak.innerHTML = isiTabelRusakHTML;
    document.getElementById('p-tot-hpp').innerText = rupiah(Math.round(lHPP));
    document.getElementById('p-tot-omzet').innerText = rupiah(Math.round(lOmset)); // Total omzet kotor tanpa pelunasan
    document.getElementById('p-tot-laba').innerText = rupiah(Math.round(lOmset - lHPP));

        // BLOK 1
    document.getElementById('p-qty-awal').innerText = siklusAktif.qtyAwal + " Pcs";
    document.getElementById('p-rp-awal').innerText = rupiah(Math.round(siklusAktif.modalAwal));
    document.getElementById('p-qty-tambah').innerText = siklusAktif.qtyTambahan + " Pcs";
    document.getElementById('p-rp-tambah').innerText = rupiah(Math.round(siklusAktif.modalTambahan));
    document.getElementById('p-rp-siap').innerText = rupiah(Math.round(totalModalTersedia));
    document.getElementById('p-qty-jual').innerText = terjualQtySiklus + " Pcs";
    document.getElementById('p-rp-jual').innerText = rupiah(Math.round(terjualRpSiklus));
    document.getElementById('p-qty-hapus').innerText = (siklusAktif.qtyDihapus || 0) + " Pcs";
    document.getElementById('p-rp-hapus').innerText = rupiah(Math.round(siklusAktif.modalDihapus || 0));
    document.getElementById('p-rp-akhir').innerText = rupiah(Math.round(sisaRpReal));

// BLOK 2
    document.getElementById('p-omzet-tunai').innerText = rupiah(Math.round(omzetTunai));
    document.getElementById('p-omzet-qris').innerText = rupiah(Math.round(omzetQRIS));
    document.getElementById('p-omzet-debt').innerText = rupiah(Math.round(omzetDebt));
    document.getElementById('p-omzet-total').innerText = rupiah(Math.round(lOmset));
    document.getElementById('p-beban-hpp').innerText = rupiah(Math.round(lHPP));
    document.getElementById('p-beban-biaya').innerText = rupiah(Math.round(bBiayaToko));
    if(document.getElementById('p-beban-rugi')) document.getElementById('p-beban-rugi').innerText = rupiah(Math.round(kerugianPenyusutan));
    document.getElementById('p-laba-bersih').innerText = rupiah(Math.round(labaBersihSejati));
    // BLOK 3
    document.getElementById('p-harta-tunai').innerText = rupiah(Math.round(estimasiIsiLaci));
    document.getElementById('p-harta-qris').innerText = rupiah(Math.round(hartaQRIS));
    document.getElementById('p-harta-piutang').innerText = rupiah(Math.round(hartaPiutang));
    document.getElementById('p-harta-barang').innerText = rupiah(Math.round(sisaRpReal));
    document.getElementById('p-harta-total').innerText = rupiah(Math.round(estimasiIsiLaci + hartaQRIS + hartaPiutang + sisaRpReal));

    // Cetak
    setTimeout(() => { window.print(); }, 300);
}

function exportPDFMasterGudang() {
    let htmlTabel = "";
    let urut = 1;
    let grandTotalAwal = 0, grandTotalLaku = 0, grandTotalSisa = 0, grandTotalOmzet = 0;

    const renderRp = (angka) => {
        let str = rupiah(Math.round(angka));
        let numStr = str.replace(/Rp\s?/i, '').trim();
        return `<div style="display: flex; justify-content: space-between; width: 100%;"><span>Rp</span><span>${numStr}</span></div>`;
    };

    let today = new Date();
    today.setHours(0,0,0,0);

    let grouped = {};
    masterItems.forEach(m => {
        if(m.nama === '___SYSTEM_AUTH___' || m.kategori === '⚠️ Barang Retur') return;
        if(!grouped[m.dnaInduk]) {
            grouped[m.dnaInduk] = {
                dnaInduk: m.dnaInduk, namaLengkap: m.nama + (m.varian ? ` ${m.varian}` : ''),
                kategori: m.kategori || 'Umum', jual: m.jual || 0, batches: []
            };
        }
        grouped[m.dnaInduk].batches.push(m);
    });

    Object.values(grouped).sort((a,b) => a.namaLengkap.localeCompare(b.namaLengkap)).forEach(induk => {
        let indukAwal = 0, indukLaku = 0, indukSisa = 0, indukOmzet = 0;
        let anakData = [];
        let bEtalase = etalaseItems.find(e => e.dnaInduk === induk.dnaInduk);

        induk.batches.sort((a,b) => a.idBatch.localeCompare(b.idBatch)).forEach((b, idxBatch) => {
            let listKulakan = b.kulakan_keuangan || [{
                tanggalNota: b.riwayatAsal ? 'Data Awal' : '-', hpp: b.modal, stokAwal: b.stok, sisaGudang: b.stok, sisaEtalase: 0, stokRusak: b.stokRusak || 0, expired: b.expired || b.kadaluarsa || null
            }];

            let stokEtalaseFisik = 0;
            if (bEtalase && bEtalase.antreanFIFO) {
                let fEtalase = bEtalase.antreanFIFO.find(x => x.idBatch === b.idBatch);
                if (fEtalase) stokEtalaseFisik = parseInt(fEtalase.stok) || 0;
            }
            let sisaEtalaseTersedia = stokEtalaseFisik;

            listKulakan.forEach((f, idxKulakan) => {
                let totalKapasitas = parseInt(f.sisaGudang || 0) + parseInt(f.sisaEtalase || 0);
                let eceranAlokasi = 0;
                if (sisaEtalaseTersedia >= totalKapasitas) { eceranAlokasi = totalKapasitas; sisaEtalaseTersedia -= totalKapasitas; }
                else { eceranAlokasi = sisaEtalaseTersedia; sisaEtalaseTersedia = 0; }

                let sisaFisik = (f.sisaGudang || 0) + eceranAlokasi;
                let stokAwal = f.stokAwal || sisaFisik;
                let rusak = f.stokRusak || 0;
                let laku = stokAwal - sisaFisik - rusak;
                if(laku < 0) laku = 0;

                let hpp = f.hpp || b.modal || 0;
                let omzet = laku * induk.jual;

                indukAwal += stokAwal; indukLaku += laku; indukSisa += sisaFisik; indukOmzet += omzet;

                // LOGIKA CERDAS: Ambil data expired dari level Induk Batch (b)
                let expDateStr = b.expired || b.kadaluarsa || f.expired || f.kadaluarsa;
                let isExpired = expDateStr ? (new Date(expDateStr) <= today) : false;

                anakData.push({
                    namaBatch: `Batch ${idxBatch+1}`,
                    tglKulakan: f.tanggalNota || '-',
                    expTeks: expDateStr ? expDateStr : '-',               expColor: isExpired ? "red" : "#222",
                    hpp: hpp, stokAwal: stokAwal, laku: laku, sisaFisik: sisaFisik, omzet: omzet
                });
            });
        });

        grandTotalAwal += indukAwal; grandTotalLaku += indukLaku; grandTotalSisa += indukSisa; grandTotalOmzet += indukOmzet;

        let rowHtml = "";
        let rowCount = anakData.length;
        let borderStyle = "border: 1px solid #444; padding: 4px;";

        anakData.forEach((d, index) => {
            if (index === 0) {
                rowHtml += `
                <tr>
                    <td rowspan="${rowCount}" class="text-center" style="vertical-align: middle; ${borderStyle}">${urut}</td>
                    <td rowspan="${rowCount}" style="vertical-align: middle; ${borderStyle}"><b>${induk.namaLengkap}</b> <br><span style="font-size:7pt; color:#666;">[${induk.kategori}]</span></td>
                    <td class="text-center" style="vertical-align: middle; font-size:8pt; ${borderStyle} color:${d.expColor}; font-style: ${d.expColor === 'red' ? 'italic' : 'normal'};">${d.expTeks}</td>
                    <td class="text-center" style="vertical-align: middle; font-size:8pt; ${borderStyle}">${d.namaBatch}<br><span style="font-size:7pt;">(${d.tglKulakan})</span></td>
                    <td class="text-right t-num" style="vertical-align: middle; font-size:8pt; ${borderStyle}">${renderRp(d.hpp)}</td>
                    <td rowspan="${rowCount}" class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${renderRp(induk.jual)}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${d.stokAwal}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${d.laku}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${d.sisaFisik}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${renderRp(d.omzet)}</td>
                </tr>`;
            } else {
                rowHtml += `
                <tr>
                    <td class="text-center" style="vertical-align: middle; font-size:8pt; ${borderStyle} color:${d.expColor}; font-style: ${d.expColor === 'red' ? 'italic' : 'normal'};">${d.expTeks}</td>
                    <td class="text-center" style="vertical-align: middle; font-size:8pt; ${borderStyle}">${d.namaBatch}<br><span style="font-size:7pt;">(${d.tglKulakan})</span></td>
                    <td class="text-right t-num" style="vertical-align: middle; font-size:8pt; ${borderStyle}">${renderRp(d.hpp)}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${d.stokAwal}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${d.laku}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${d.sisaFisik}</td>
                    <td class="text-right t-num" style="vertical-align: middle; ${borderStyle}">${renderRp(d.omzet)}</td>
                </tr>`;
            }
        });

        htmlTabel += `
        <tbody style="page-break-inside: avoid;">
            ${rowHtml}
        </tbody>`;
        urut++;
    });

    if(urut === 1) htmlTabel = `<tbody><tr><td colspan="10" class="text-center" style="border: 1px solid #444;">Gudang Kosong</td></tr></tbody>`;
    else htmlTabel += `
        <tbody style="page-break-inside: avoid;">
            <tr style="background-color: #e0e0e0; font-weight: 900;">
                <td colspan="6" class="text-right" style="padding: 6px; border: 1px solid #444;">GRAND TOTAL KESELURUHAN</td>
                <td class="text-right t-num" style="padding: 6px; border: 1px solid #444;">${grandTotalAwal}</td>
                <td class="text-right t-num" style="padding: 6px; border: 1px solid #444;">${grandTotalLaku}</td>
                <td class="text-right t-num" style="padding: 6px; border: 1px solid #444;">${grandTotalSisa}</td>
                <td class="text-right t-num" style="padding: 6px; border: 1px solid #444;">${renderRp(grandTotalOmzet)}</td>
            </tr>
        </tbody>`;

    let dNow = new Date();
    document.getElementById('p-waktu-cetak').innerText = dNow.toLocaleDateString('id-ID') + " " + dNow.toLocaleTimeString('id-ID');
    document.getElementById('p-nama-apotek').innerText = profilApotek.nama.toUpperCase();
    document.getElementById('p-owner').innerText = profilApotek.nama;
    document.getElementById('p-tgl').innerText = "AUDIT MASTER GUDANG (DETAIL BATCH)";
    document.getElementById('p-trx').innerText = (urut - 1) + " Item Induk";

    let titleEl = document.querySelector('.brand-text h1');
    let subtitleEl = document.querySelector('.brand-text p');
    let originalTitle = titleEl.innerText; let originalSub = subtitleEl.innerText;
    titleEl.innerText = "DAFTAR OBAT";
    subtitleEl.innerText = "Rincian Stok, Modal, Omzet per Batch Kulakan";

    let originalTable = document.querySelector('.table-cetak');
    let auditTable = document.createElement('table');
    auditTable.className = 'table-cetak'; auditTable.id = 'temp-audit-table';
    auditTable.style.fontSize = '8.5pt'; auditTable.style.borderCollapse = 'collapse'; auditTable.style.width = '100%';

    let thStyle = "border: 1px solid #444; vertical-align: middle; padding: 6px;";
    auditTable.innerHTML = `
        <thead style="display: table-header-group; background-color: #f3f4f6;">
            <tr>
                <th rowspan="2" width="3%" style="${thStyle}">No</th>
                <th rowspan="2" width="23%" style="${thStyle}">Nama Obat / Varian & Kategori</th>
                <th rowspan="2" width="11%" style="${thStyle}">Batch Kadaluarsa</th>
                <th rowspan="2" width="11%" style="${thStyle}">Kulakan</th>
                <th rowspan="2" width="10%" style="${thStyle}">Modal/HPP</th>
                <th rowspan="2" width="10%" style="${thStyle}">Harga Jual</th>
                <th colspan="3" width="15%" class="text-center" style="${thStyle}">Total Stok</th>
                <th rowspan="2" width="12%" style="${thStyle}">Omzet</th>
            </tr>
            <tr>
                <th class="text-center" style="${thStyle}">Awal</th>
                <th class="text-center" style="${thStyle}">Laku</th>
                <th class="text-center" style="${thStyle}">Sisa</th>
            </tr>
        </thead>
        ${htmlTabel}
    `;

    originalTable.parentNode.insertBefore(auditTable, originalTable);
    originalTable.style.display = 'none';

    let sectionTitle = document.querySelector('.section-title');
    let bottomGrid = document.querySelector('.bottom-grid');
    let tabelRusak = document.getElementById('p-tabel-rusak-body');

    if (sectionTitle) sectionTitle.style.display = 'none';
    if (bottomGrid) bottomGrid.style.display = 'none';
    if (tabelRusak) {
        tabelRusak.closest('table').style.display = 'none';
        tabelRusak.closest('table').previousElementSibling.style.display = 'none';
    }

    setTimeout(() => {
        window.print();
        setTimeout(() => {
            titleEl.innerText = originalTitle; subtitleEl.innerText = originalSub;
            auditTable.remove(); originalTable.style.display = 'table';
            if (sectionTitle) sectionTitle.style.display = 'block';
            if (bottomGrid) bottomGrid.style.display = 'grid';
            if (tabelRusak) {
                tabelRusak.closest('table').style.display = 'table';
                tabelRusak.closest('table').previousElementSibling.style.display = 'block';
            }
        }, 1000);
    }, 400);
}

// ==========================================
// MESIN KALKULATOR KONVERSI EDIT BATCH
// ==========================================
function kalkulatorEditBatchMobile() {
    let isGrosir = document.getElementById('editToggleGrosir') ? document.getElementById('editToggleGrosir').checked : false;
    let jumlahBeli = parseFloat(document.getElementById('editQtyBeli').value) || 0;
    let isiPerBox = parseFloat(document.getElementById('editIsiPerBox').value) || 1;

    let modalRaw = document.getElementById('editModalKotor').value.replace(/\./g, '');
    let modalKotor = parseFloat(modalRaw) || 0;

    let satEcer = document.getElementById('editSatuanEceran').value || 'Pcs';
    let satBesar = document.getElementById('editSatuanBesar').value || 'Box';

    let wadahGrosir = document.getElementById('wadahIsiPerBoxEdit');
    let labelModalKotor = document.getElementById('labelModalKotorEdit');
    let labelMultiplier = document.getElementById('labelMultiplierEdit');
    const knob = document.querySelector('#editToggleGrosir ~ label .toggle-knob');

    if(isGrosir) {
        if(wadahGrosir) wadahGrosir.classList.remove('hidden');
        if(labelMultiplier) labelMultiplier.textContent = `1 ${satBesar} isi brp ${satEcer}?`;
        if(labelModalKotor) labelModalKotor.textContent = `Modal Beli (per ${satBesar})`;
        if(knob) knob.style.transform = 'translateX(20px)';
    } else {
        if(wadahGrosir) { wadahGrosir.classList.add('hidden'); isiPerBox = 1; }
        if(labelModalKotor) labelModalKotor.textContent = `Modal Beli (per ${satEcer})`;
        if(knob) knob.style.transform = 'translateX(0px)';
    }

    let totalStokEceran = isGrosir ? (jumlahBeli * isiPerBox) : jumlahBeli;
    let hppEceran = isGrosir ? (modalKotor / (isiPerBox || 1)) : modalKotor;

    let inputStok = document.getElementById('editStokMobile');
    let inputModal = document.getElementById('editModalMobile');

    if(inputStok && jumlahBeli > 0) inputStok.value = totalStokEceran;
    if(inputModal && modalKotor > 0) inputModal.value = Math.round(hppEceran);

    let infoText = document.getElementById('infoKalkulasiEdit');
    if(infoText) {
        if(jumlahBeli > 0 || modalKotor > 0) {
            infoText.innerHTML = `Otomatis Hitung: Masuk <b class="text-emerald-600">${totalStokEceran} ${satEcer}</b> | HPP: <b class="text-red-500">${rupiah(Math.round(hppEceran))}</b> / ${satEcer}`;
        } else {
            infoText.innerHTML = `Nyalakan saklar jika beli dlm bentuk Grosir (Box/Dos)`;
        }
    }
}

// ==========================================
// MESIN POP-UP DETAIL OBAT (MASTER GUDANG)
// ==========================================
function bukaDetailObatMobile(dnaInduk) {
    let batches = masterItems.filter(i => i.dnaInduk === dnaInduk);
    if (batches.length === 0) return;

    batches.sort((a, b) => a.idBatch.localeCompare(b.idBatch));
    let referensi = batches[batches.length - 1];

    // --- 🩺 MESIN PENYELARAS (AUTO-HEALER) kulakan KEUANGAN ---
    // Menyelaraskan data masa lalu yang tersangkut agar sinkron 100% dengan fisik
    batches.forEach(b => {
        let bEtalase = etalaseItems.find(e => e.dnaInduk === dnaInduk || e.nama === b.nama);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) {
            let fEtalase = bEtalase.antreanFIFO.find(x => x.idBatch === b.idBatch);
            if (fEtalase) stokEtalaseFisik = parseInt(fEtalase.stok) || 0;
        }

        if (b.kulakan_keuangan) {
            let sisaEtalaseTersedia = stokEtalaseFisik;

            b.kulakan_keuangan.forEach(f => {
                let totalKapasitaskulakan = parseInt(f.sisaGudang || 0) + parseInt(f.sisaEtalase || 0);

                if (sisaEtalaseTersedia >= totalKapasitaskulakan) {
                    f.sisaEtalase = totalKapasitaskulakan;
                    f.sisaGudang = 0;
                    sisaEtalaseTersedia -= totalKapasitaskulakan;
                } else {
                    f.sisaEtalase = sisaEtalaseTersedia;
                    f.sisaGudang = totalKapasitaskulakan - sisaEtalaseTersedia;
                    sisaEtalaseTersedia = 0;
                }
            });
        }
    });
    saveApotekDB('apotek_masterItems', masterItems);
    // -------------------------------------------------------

    document.getElementById('detailObatNamaTitle').textContent = referensi.nama.toUpperCase();

    // VARIABEL AKUMULASI NERACA MIKRO (HELIKOPTER VIEW)
    let totalStokKeseluruhan = 0;
    let totalModalTertanamKeseluruhan = 0;
    let totalModalDikeluarkanKeseluruhan = 0;
    let htmlBatches = '';

    batches.forEach((b, indexBatch) => {
        let listkulakan = b.kulakan_keuangan || [{
            idkulakan: "F-MIGRASI", tanggalNota: b.riwayatAsal ? 'Data Awal' : '-', hpp: b.modal, stokAwal: b.stok, sisaGudang: b.stok, sisaEtalase: 0, modalKeluar: (b.totalModal !== undefined ? b.totalModal : (b.modal * b.stok))
        }];

        // VARIABEL SIKLUS MODAL PERPETUAL (PER BATCH)
        let sisaStokBatchIni = 0;
        let terjualBatchIni = 0;
        let totalModalBatch = 0;
        let modalTertanamBatch = 0;

        let pendapatanBatchIni = 0;
        let hppKeluarBatchIni = 0;
        let labaBatchIni = 0;

        let htmlkulakan = '';

        listkulakan.forEach((f, indexkulakan) => {
            let sisaGudang = f.sisaGudang || 0;
            let sisaEtalase = f.sisaEtalase || 0;
            let sisakulakanIni = sisaGudang + sisaEtalase;
            let stokAwalkulakan = f.stokAwal || sisakulakanIni;
            let hppkulakan = f.hpp || 0;

            let rusakKulakan = f.stokRusak || 0;
            let terjualkulakan = stokAwalkulakan - sisakulakanIni - rusakKulakan; // [PERBAIKAN] Cegah jadi hantu Terjual di rincian
            if (terjualkulakan < 0) terjualkulakan = 0;
            // KALKULASI FINANSIAL SPESIFIK kulakan INI
            let totalModalkulakanIni = stokAwalkulakan * hppkulakan;
            let omsetkulakan = terjualkulakan * referensi.jual;
            let hppKeluarkulakan = terjualkulakan * hppkulakan;
            let labakulakan = omsetkulakan - hppKeluarkulakan;

            // AKUMULASI KE BATCH
            sisaStokBatchIni += sisakulakanIni;
            terjualBatchIni += terjualkulakan;
            totalModalBatch += totalModalkulakanIni;
            modalTertanamBatch += (sisakulakanIni * hppkulakan);

            pendapatanBatchIni += omsetkulakan;
            hppKeluarBatchIni += hppKeluarkulakan;
            labaBatchIni += labakulakan;

                        // RENDERING HEADER KULAKAN kulakan (DESAIN GRID 5 KOLOM SEJAJAR & ANTI-TURUN BARIS)
            let riwayat = f.riwayatAsal || b.riwayatAsal;
            let htmlKulakankulakan = '';

            if(riwayat) {
                let namaSatuan = riwayat.satuanEcer || 'Pcs';
                if(riwayat.isGrosir) {
                    let hargaPerBox = hppkulakan * riwayat.isiPerBox;
                    htmlKulakankulakan = `
                    <div class="bg-indigo-50/40 border-b border-indigo-100/60 p-3.5">
                        <!-- Header Tanpa Ikon (Ruang Diperlebar) -->
                        <div class="flex flex-col mb-3">
                            <p class="text-[12px] font-black text-indigo-900 uppercase tracking-widest leading-none">KULAKAN GROSIR</p>
                            <p class="text-[10px] font-bold text-slate-600 uppercase tracking-wide mt-1 flex flex-wrap gap-1">
                                Pembelian: ${riwayat.qtyBeli} ${riwayat.satuanBesar} <span class="text-indigo-300">|</span> <span>@ ${riwayat.isiPerBox} ${namaSatuan}</span>
                            </p>
                        </div>

                        <!-- Box Detail Harga (Grid 5 Kolom: Rata Presisi Titik Dua, Rp, & Angka) -->
                        <div class="bg-white border border-indigo-100/50 rounded-xl p-3.5 shadow-[0px_2px_10px_-3px_rgba(0,0,0,0.06)] overflow-hidden">
                            <div class="grid grid-cols-[max-content_max-content_1fr_max-content_max-content] gap-x-1.5 items-center w-full text-[10px] whitespace-nowrap">

                                <!-- BARIS 1: HARGA DOS -->
                                <div class="font-bold text-indigo-900 uppercase tracking-wide">Harga / ${riwayat.satuanBesar}</div>
                                <div class="font-black text-indigo-900">:</div>
                                <div class="w-full"></div>
                                <div class="font-bold text-indigo-900">Rp</div>
                                <div class="font-black text-indigo-900 text-right text-[12px] sm:text-[14px] tracking-tight">${Math.round(hargaPerBox).toLocaleString('id-ID')}</div>

                                <!-- BARIS 2: MODAL BELI kulakan -->
                                <div class="font-bold text-indigo-900 uppercase tracking-wide mt-3">Modal Beli kulakan</div>
                                <div class="font-black text-indigo-900 mt-3">:</div>
                                <div class="w-full mt-3"></div>
                                <div class="font-bold text-indigo-900 mt-3">Rp</div>
                                <div class="font-black text-indigo-900 text-right text-[12px] sm:text-[14px] tracking-tight mt-3">${Math.round(totalModalkulakanIni).toLocaleString('id-ID')}</div>

                                <!-- BARIS 3: HPP -->
                                <div class="font-bold text-indigo-900 uppercase tracking-wide mt-3">HPP</div>
                                <div class="font-black text-indigo-900 mt-3">:</div>
                                <div class="w-full mt-3"></div>
                                <div class="font-bold text-indigo-900 mt-3">Rp</div>
                                <div class="font-black text-indigo-900 text-right text-[12px] sm:text-[14px] tracking-tight mt-3">${Math.round(hppkulakan).toLocaleString('id-ID')}</div>

                            </div>
                        </div>
                    </div>`;
                } else {
                    htmlKulakankulakan = `
                    <div class="bg-indigo-50/40 border-b border-indigo-100/60 p-3.5">
                        <div class="flex flex-col mb-3">
                            <p class="text-[12px] font-black text-indigo-900 uppercase tracking-widest leading-none">KULAKAN ECERAN</p>
                            <p class="text-[10px] font-bold text-slate-600 uppercase tracking-wide mt-1">
                                SATUAN UNIT: ${riwayat.qtyBeli} ${namaSatuan}
                            </p>
                        </div>

                        <div class="bg-white border border-indigo-100/50 rounded-xl p-3.5 shadow-[0px_2px_10px_-3px_rgba(0,0,0,0.06)] overflow-hidden">
                            <div class="grid grid-cols-[max-content_max-content_1fr_max-content_max-content] gap-x-1.5 items-center w-full text-[10px] whitespace-nowrap">

                                <div class="font-bold text-indigo-900 uppercase tracking-wide">Modal Beli kulakan</div>
                                <div class="font-black text-indigo-900">:</div>
                                <div class="w-full"></div>
                                <div class="font-bold text-indigo-900">Rp</div>
                                <div class="font-black text-indigo-900 text-right text-[12px] sm:text-[14px] tracking-tight">${Math.round(totalModalkulakanIni).toLocaleString('id-ID')}</div>

                                <div class="font-bold text-indigo-900 uppercase tracking-wide mt-3">HPP</div>
                                <div class="font-black text-indigo-900 mt-3">:</div>
                                <div class="w-full mt-3"></div>
                                <div class="font-bold text-indigo-900 mt-3">Rp</div>
                                <div class="font-black text-indigo-900 text-right text-[12px] sm:text-[14px] tracking-tight mt-3">${Math.round(hppkulakan).toLocaleString('id-ID')}</div>

                            </div>
                        </div>
                    </div>`;
                }
            } else {
                htmlKulakankulakan = `
                <div class="bg-slate-50/80 border-b border-slate-100 p-3.5">
                    <div class="flex flex-col mb-3">
                        <p class="text-[12px] font-black text-slate-700 uppercase tracking-widest leading-none">Data Awal / Migrasi</p>
                        <p class="text-[10px] font-bold text-slate-500 mt-1">Migrasi database lama</p>
                    </div>

                    <div class="bg-white border border-slate-200/70 rounded-xl p-3.5 shadow-[0px_2px_10px_-3px_rgba(0,0,0,0.06)] overflow-hidden">
                        <div class="grid grid-cols-[max-content_max-content_1fr_max-content_max-content] gap-x-1.5 items-center w-full text-[10px] whitespace-nowrap">

                            <div class="font-bold text-slate-600 uppercase tracking-wide">Modal kulakan</div>
                            <div class="font-black text-slate-600">:</div>
                            <div class="w-full"></div>
                            <div class="font-bold text-slate-600">Rp</div>
                            <div class="font-black text-slate-600 text-right text-[12px] sm:text-[14px] tracking-tight">${Math.round(totalModalkulakanIni).toLocaleString('id-ID')}</div>

                            <div class="font-bold text-slate-600 uppercase tracking-wide mt-3">Harga Modal (HPP)</div>
                            <div class="font-black text-slate-600 mt-3">:</div>
                            <div class="w-full mt-3"></div>
                            <div class="font-bold text-slate-600 mt-3">Rp</div>
                            <div class="font-black text-slate-800 text-right text-[12px] sm:text-[14px] tracking-tight mt-3">${Math.round(hppkulakan).toLocaleString('id-ID')}</div>

                        </div>
                    </div>
                </div>`;
            }

            let iskulakanHabis = sisakulakanIni <= 0;

            // --- PEMBARUAN VISUAL KARTU kulakan (ELEGAN & TERPISAH TEGAS) ---
            let cardWrapperStyle = iskulakanHabis
                ? 'bg-slate-50 border border-slate-200 border-l-[5px] border-l-slate-300 rounded-xl mb-4 shadow-sm opacity-80'
                : 'bg-white border border-slate-200 border-l-[5px] border-l-indigo-500 rounded-xl mb-4 shadow-md';

            let teksStokkulakan = iskulakanHabis ? 'text-slate-400' : 'text-emerald-600';
            let headerkulakanStyle = iskulakanHabis ? 'bg-slate-100/60 text-slate-400' : 'bg-slate-100 text-slate-600';
            let iconkulakanStyle = iskulakanHabis ? 'text-slate-300' : 'text-indigo-400';

            htmlkulakan += `
            <div class="${cardWrapperStyle} transition-all relative overflow-hidden flex flex-col">

                <!-- HEADER kulakan (LEBIH MENONJOL & TEGAS) -->
                <div class="flex justify-between items-center ${headerkulakanStyle} px-3 py-2 border-b border-slate-200">
                    <span class="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <i class="fa-solid fa-layer-group ${iconkulakanStyle}"></i> kulakan ${indexkulakan + 1}
                    </span>
                    <span class="text-[9px] font-bold text-slate-500 bg-white/80 px-2 py-0.5 rounded border border-slate-200/70 shadow-sm">${f.tanggalNota || '-'}</span>
                </div>

                <!-- BLOK KULAKAN & HPP (PENGGABUNGAN BARU) -->
                ${htmlKulakankulakan}

                <!-- BLOK UTAMA (STOK AWAL - SISA STOK - TERJUAL) -->
                <div class="p-2.5">
                    <div class="flex items-stretch justify-between bg-slate-50/70 p-2 rounded-xl border border-slate-200/60 shadow-inner mb-3">
                        <!-- KIRI: STOK AWAL -->
                        <div class="flex flex-col items-center justify-center w-1/4">
                            <p class="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider mb-1">Awal</p>
                            <p class="text-sm font-black text-slate-600 leading-none">${stokAwalkulakan}</p>
                        </div>

                        <!-- TENGAH: SISA STOK & RINCIAN -->
                        <div class="flex flex-col items-center justify-center flex-1 border-x border-slate-200/70 px-2">
                            <p class="text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">Sisa Stok</p>
                            <p class="text-xl font-black ${teksStokkulakan} leading-none drop-shadow-sm mb-1.5">${sisakulakanIni}</p>
                            <div class="flex flex-col w-full gap-1">
                                <div class="flex items-center justify-between text-[8px] font-bold text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-sm">
                                    <span class="flex items-center gap-1"><i class="fa-solid fa-box text-slate-400"></i> Gudang</span>
                                    <span class="font-black text-slate-700">${sisaGudang}</span>
                                </div>
                                <div class="flex items-center justify-between text-[8px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shadow-sm">
                                    <span class="flex items-center gap-1"><i class="fa-solid fa-store text-emerald-400"></i> Etalase</span>
                                    <span class="font-black">${sisaEtalase}</span>
                                </div>
                            </div>
                        </div>

                        <!-- KANAN: TERJUAL -->
                        <div class="flex flex-col items-center justify-center w-1/4">
                            <p class="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider mb-1">Terjual</p>
                            <p class="text-sm font-black text-amber-500 leading-none drop-shadow-sm">${terjualkulakan}</p>
                        </div>
                    </div>

                    <!-- MINI DASHBOARD FINANSIAL kulakan -->
                    <div class="grid grid-cols-3 gap-1.5 bg-slate-50/50 p-1.5 rounded-lg border border-slate-100/50">
                        <div class="bg-white rounded p-1.5 border border-blue-100 shadow-sm text-center">
                            <p class="text-[7.5px] font-black text-blue-500 uppercase tracking-widest mb-0.5">Omset</p>
                            <p class="text-[9px] font-black text-blue-700">${rupiah(Math.round(omsetkulakan))}</p>
                        </div>
                        <div class="bg-white rounded p-1.5 border border-rose-100 shadow-sm text-center">
                            <p class="text-[7.5px] font-black text-rose-500 uppercase tracking-widest mb-0.5">HPP Keluar</p>
                            <p class="text-[9px] font-black text-rose-700">${rupiah(Math.round(hppKeluarkulakan))}</p>
                        </div>
                            <div class="bg-emerald-50 rounded p-1.5 border border-emerald-200 shadow-sm text-center">
                            <p class="text-[7.5px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Laba kulakan</p>
                            <p class="text-[9px] font-black text-emerald-700">${rupiah(Math.round(labakulakan))}</p>
                        </div>
                    </div>
                </div>
            </div>`;
        });


        // AKUMULASI KE NERACA KESELURUHAN (GLOBAL)
        totalStokKeseluruhan += sisaStokBatchIni;
        totalModalTertanamKeseluruhan += modalTertanamBatch;
        totalModalDikeluarkanKeseluruhan += totalModalBatch;

        let htmlFinansialBatch = `
        <div class="mt-3 pt-3 border-t border-slate-200 border-dashed">
            <p class="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 pl-1 text-center"><i class="fa-solid fa-calculator text-slate-400 mr-1"></i> Total Performa Batch</p>

            <!-- SUNTIKAN RINCIAN MODAL BATCH -->
            <div class="flex justify-between items-center text-[8.5px] font-bold text-slate-500 mb-2 px-1">
                <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"><i class="fa-solid fa-sack-dollar text-slate-400 mr-1"></i>Modal: <span class="text-slate-700">${rupiah(Math.round(totalModalBatch))}</span></span>
                <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"><i class="fa-solid fa-box-archive text-slate-400 mr-1"></i>Tertanam: <span class="text-slate-700">${rupiah(Math.round(modalTertanamBatch))}</span></span>
            </div>

            <div class="grid grid-cols-3 gap-1.5">
                <div class="bg-blue-50/70 rounded-lg p-2 border border-blue-100 text-center flex flex-col justify-center">
                    <p class="text-[7.5px] font-black text-blue-600 uppercase tracking-widest mb-0.5">T. Omset</p>
                    <p class="text-[11px] font-black text-blue-800">${rupiah(Math.round(pendapatanBatchIni))}</p>
                </div>
                <div class="bg-rose-50/70 rounded-lg p-2 border border-rose-100 text-center flex flex-col justify-center">
                    <p class="text-[7.5px] font-black text-rose-600 uppercase tracking-widest mb-0.5">T. HPP</p>
                    <p class="text-[11px] font-black text-rose-800">${rupiah(Math.round(hppKeluarBatchIni))}</p>
                </div>
                <div class="bg-emerald-50/70 rounded-lg p-2 border border-emerald-100 text-center shadow-inner flex flex-col justify-center">
                    <p class="text-[7.5px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">T. Laba</p>
                    <p class="text-[11px] font-black text-emerald-700">${rupiah(Math.round(labaBatchIni))}</p>
                </div>
            </div>
            <p class="text-[8px] font-bold text-slate-400 text-center mt-2 italic">*Kalkulasi presisi perpetual dari akumulasi ${terjualBatchIni} stok terjual pada Batch ini.</p>
        </div>`;

        let isBatchHabis = sisaStokBatchIni <= 0;
        let pitaBatch = isBatchHabis ? 'bg-slate-300' : 'bg-blue-400';
        let bgHeaderBatch = isBatchHabis ? 'bg-slate-100' : 'bg-blue-50';
        let teksHeaderBatch = isBatchHabis ? 'text-slate-500' : 'text-blue-700';
        let expTeks = b.expired ? `<span class="${isBatchHabis ? 'text-slate-400' : 'text-red-500'} font-bold">${b.expired}</span>` : `<span class="text-slate-400 font-medium">Tanpa Exp</span>`;

        htmlBatches += `
        <div class="bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm mb-4 relative overflow-hidden group">
            <div class="absolute left-0 top-0 bottom-0 w-1.5 ${pitaBatch}"></div>
            <div class="pl-3 pr-1 py-1">
                <div class="${bgHeaderBatch} rounded-xl px-3 py-2 flex justify-between items-center mb-3 border border-slate-100">
                    <span class="text-[11px] font-black ${teksHeaderBatch} uppercase tracking-widest">BATCH ${indexBatch + 1}</span>
                    <span class="text-[10px] font-bold text-slate-600">Exp: ${expTeks}</span>
                </div>
                <div class="pl-0.5 pr-1.5 pb-1">
                    ${htmlkulakan}
                    ${htmlFinansialBatch}
                </div>
            </div>
        </div>`;
    });

    let barcodeHTML = '';
    if(referensi.barcode || referensi.qrcode) {
        barcodeHTML = `
        <div class="flex justify-between items-center border-t border-slate-50 pt-2 mt-2">
            <span class="text-xs font-semibold text-slate-500"><i class="fa-solid fa-barcode text-slate-400 w-4 text-center mr-1"></i> Barcode / QR</span>
            <span class="text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">${referensi.barcode || referensi.qrcode}</span>
        </div>`;
    }

    let html = `
    <div class="space-y-3 pb-4">

        <!-- INFORMASI PRODUK INDUK -->
        <div class="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm mt-2 relative overflow-hidden">
            <div class="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -z-0 opacity-50 pointer-events-none"></div>
            <div class="relative z-10">
                <div class="flex justify-between items-center mb-3 border-b border-slate-100 pb-2">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Informasi Etalase</p>
                    <span class="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 shadow-sm">${referensi.kategori || '-'}</span>
                </div>
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs font-semibold text-slate-500">Varian / Kemasan</span>
                    <span class="text-xs font-bold text-slate-800">${referensi.varian || '-'}</span>
                </div>
                <div class="flex justify-between items-center border-t border-slate-50 pt-2">
                    <span class="text-xs font-semibold text-slate-500">Harga Jual (Satu Nyawa)</span>
                    <span class="text-base font-black text-emerald-600">${rupiah(referensi.jual)}</span>
                </div>
                ${barcodeHTML}
            </div>
        </div>

        <div class="mt-5 mb-2 flex items-center gap-2 pl-1 border-l-2 border-corporate-500">
            <i class="fa-solid fa-book-open-reader text-corporate-500 ml-2"></i>
            <h4 class="text-[11px] font-black text-slate-700 uppercase tracking-wider">Buku Rekening Obat (Batch & kulakan)</h4>
        </div>

        ${htmlBatches}

        <!-- KOTAK BIRU REKAPITULASI TOTAL ASET -->
        <div class="bg-gradient-to-br from-corporate-700 to-corporate-900 text-white p-5 rounded-2xl mt-4 relative overflow-hidden shadow-lg border border-corporate-600">
            <i class="fa-solid fa-vault absolute -right-6 -bottom-6 text-7xl text-corporate-500 opacity-20 transform -rotate-12"></i>
            <p class="text-[10px] font-black text-corporate-200 uppercase tracking-widest mb-3 relative z-10 border-b border-corporate-600 pb-2 flex justify-between items-center">
                <span>Neraca Mikro Keseluruhan</span>
                <i class="fa-solid fa-chart-pie opacity-70"></i>
            </p>

            <div class="flex justify-between items-center mb-3 relative z-10">
                <span class="text-xs font-medium text-corporate-100">Total Sisa Stok:</span>
                <span class="text-base font-black text-white drop-shadow-sm">${totalStokKeseluruhan} Biji</span>
            </div>

            <div class="flex justify-between items-center mb-3 relative z-10">
                <span class="text-[11px] font-medium text-corporate-200">Modal Dikeluarkan:</span>
                <span class="text-sm font-bold text-corporate-100">${rupiah(Math.round(totalModalDikeluarkanKeseluruhan))}</span>
            </div>

            <div class="flex justify-between items-end relative z-10 border-t border-corporate-600/50 pt-3">
                <span class="text-xs font-bold text-corporate-100">Aset Modal Tersisa:</span>
                <span class="text-2xl font-black text-amber-400 drop-shadow-md">${rupiah(Math.round(totalModalTertanamKeseluruhan))}</span>
            </div>
        </div>

    </div>
    `;

    document.getElementById('bodyDetailObatMobile').innerHTML = html;
    bukaModalMobile('modalDetailObatMobile', 'panelDetailObatMobile');
}

// ============================================================================
// MODUL PENYUSUTAN (BARANG RUSAK / HILANG / EXPIRED) - 100% ISOLATED MODULE
// ============================================================================

let penyusutanKeranjang = {}; // format { idBatch: qtyBuang }
let dnaIndukPenyusutanAktif = null;

function bukaModalPenyusutanMobile() {
    document.getElementById('inputCariPenyusutan').value = '';
    document.getElementById('wadahListPenyusutan').innerHTML = `
        <div class="text-center p-6 text-slate-400 font-medium text-xs">
            <i class="fa-solid fa-box-open text-3xl mb-2 text-slate-300"></i><br>Ketik nama obat atau scan barcode...
        </div>`;
    document.getElementById('areaFormPenyusutan').classList.add('hidden');
    document.getElementById('footerPenyusutan').classList.add('hidden');
    penyusutanKeranjang = {};
    dnaIndukPenyusutanAktif = null;

    bukaModalMobile('modalPenyusutanMobile', 'panelPenyusutanMobile');
    setTimeout(() => document.getElementById('inputCariPenyusutan').focus(), 400);
}

function cariObatPenyusutan() {
    let keyword = document.getElementById('inputCariPenyusutan').value.toLowerCase();
    let wadah = document.getElementById('wadahListPenyusutan');

    if (keyword.length < 2) {
        wadah.innerHTML = `<div class="text-center p-4 text-slate-400 text-xs">Ketik minimal 2 huruf...</div>`;
        return;
    }

    let grouped = {};
    masterItems.forEach(m => {
        let bEtalase = etalaseItems.find(e => e.dnaInduk === m.dnaInduk);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) {
            let f = bEtalase.antreanFIFO.find(x => x.idBatch === m.idBatch);
            if (f) stokEtalaseFisik = f.stok;
        }
        let totalFisikValid = m.stok + stokEtalaseFisik;

        if (totalFisikValid > 0 && m.nama !== '___SYSTEM_AUTH___' && m.kategori !== '⚠️ Barang Retur') {
            if (m.nama.toLowerCase().includes(keyword) || (m.barcode && m.barcode.toLowerCase() === keyword) || (m.qrcode && m.qrcode.toLowerCase() === keyword)) {
                if (!grouped[m.dnaInduk]) {
                    grouped[m.dnaInduk] = { dnaInduk: m.dnaInduk, nama: m.nama, varian: m.varian, kategori: m.kategori, totalStok: 0 };
                }
                grouped[m.dnaInduk].totalStok += totalFisikValid;
            }
        }
    });

    let hasil = Object.values(grouped);

    if (hasil.length === 0) {
        wadah.innerHTML = `<div class="text-center p-4 text-red-400 text-xs font-bold">Obat tidak ditemukan atau stok gudang kosong.</div>`;
        return;
    }

        wadah.innerHTML = hasil.map(g => {
        let badgeKategori = g.kategori ? `<span class="text-[8px] bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded font-black uppercase tracking-widest ml-2">${g.kategori}</span>` : '';
        return `
        <div onclick="pilihObatPenyusutan('${g.dnaInduk}')" class="bg-white border border-slate-200 p-3.5 rounded-2xl flex justify-between items-center active:scale-95 transition-transform cursor-pointer shadow-sm hover:border-rose-300 group">
            <div class="flex-1 pr-2">
                <div class="flex items-center flex-wrap leading-tight mb-1">
                    <span class="font-bold text-slate-800 text-sm">${g.nama}</span>
                    ${g.varian ? `<span class="text-[10px] italic text-slate-400 ml-1">${g.varian}</span>` : ''}
                </div>
                <div class="flex items-center mt-0.5">
                    <span class="text-[10px] font-black text-emerald-600">Total Gudang: ${g.totalStok}</span>
                    ${badgeKategori}
                </div>
            </div>
            <button class="bg-rose-50 text-rose-600 border border-rose-100 px-3 py-1.5 rounded-xl text-[10px] font-bold group-hover:bg-rose-500 group-hover:text-white transition-colors shrink-0"><i class="fa-solid fa-arrow-right"></i> Proses</button>
        </div>`;
    }).join('');
}

function pilihObatPenyusutan(dnaInduk) {
    let batches = masterItems.filter(m => {
        if (m.dnaInduk !== dnaInduk) return false;
        let bEtalase = etalaseItems.find(e => e.dnaInduk === m.dnaInduk);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) {
            let f = bEtalase.antreanFIFO.find(x => x.idBatch === m.idBatch);
            if (f) stokEtalaseFisik = f.stok;
        }
        return (m.stok + stokEtalaseFisik) > 0;
    });
    if (batches.length === 0) return;

    batches.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));
    dnaIndukPenyusutanAktif = dnaInduk;
    penyusutanKeranjang = {}; // Reset keranjang khusus obat ini
    let referensi = batches[0];

    document.getElementById('penyu_nama_induk').innerText = referensi.nama + (referensi.varian ? ` (${referensi.varian})` : '');
    document.getElementById('penyu_kategori').innerText = referensi.kategori || 'Tanpa Kategori';

    renderBatchesPenyusutan(batches);
    kalkulasiRealTimePenyusutan();

    document.getElementById('wadahListPenyusutan').innerHTML = '';
    document.getElementById('inputCariPenyusutan').value = '';
    document.getElementById('areaFormPenyusutan').classList.remove('hidden');
    document.getElementById('footerPenyusutan').classList.remove('hidden');
}

function renderBatchesPenyusutan(batches) {
    let wadah = document.getElementById('wadahBatchPenyusutan');
    let tglHariIni = new Date(getTanggalLokal());

    wadah.innerHTML = batches.map((b, idx) => {
        let statusWarna = 'emerald';
        let statusIkon = 'fa-check-circle';
        let statusTeks = 'Aman';
        let expDate = b.expired ? new Date(b.expired) : null;

        if (expDate) {
            let diffTime = expDate - tglHariIni;
            let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 0) {
                statusWarna = 'red'; statusIkon = 'fa-calendar-xmark'; statusTeks = 'EXPIRED';
            } else if (diffDays <= 30) {
                statusWarna = 'amber'; statusIkon = 'fa-triangle-exclamation'; statusTeks = 'KRITIS';
            }
        }

        let qtyDibuang = penyusutanKeranjang[b.idBatch] || 0;
        let bEtalase = etalaseItems.find(e => e.dnaInduk === b.dnaInduk);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) {
            let f = bEtalase.antreanFIFO.find(x => x.idBatch === b.idBatch);
            if (f) stokEtalaseFisik = f.stok;
        }
        let qtyMax = b.stok + stokEtalaseFisik;
        let cardBg = qtyDibuang > 0 ? 'bg-rose-50 border-rose-300 shadow-md transform scale-[0.98]' : 'bg-white border-slate-200 shadow-sm';   let btnMinusClass = qtyDibuang > 0 ? 'bg-white text-slate-700 shadow-sm active:bg-slate-100' : 'bg-slate-100 text-slate-300 pointer-events-none';
        let btnPlusClass = qtyDibuang < qtyMax ? 'bg-rose-100 text-rose-700 shadow-sm active:bg-rose-200' : 'bg-slate-100 text-slate-300 pointer-events-none';

        return `
        <div class="border rounded-2xl p-3 flex justify-between items-center transition-all ${cardBg}">
            <div class="flex-1 pr-2">
                <div class="flex items-center gap-2 mb-1.5">
                    <span class="font-black text-slate-800 text-[11px] uppercase tracking-widest">Batch ${idx + 1}</span>
                    <span class="text-[8px] font-black text-${statusWarna}-600 bg-${statusWarna}-50 px-1.5 py-0.5 rounded border border-${statusWarna}-100 flex items-center gap-1 uppercase tracking-widest"><i class="fa-solid ${statusIkon}"></i> ${statusTeks}</span>
                </div>
                <p class="text-[10px] text-slate-500 font-bold">Stok Max: <span class="text-slate-800 font-black">${qtyMax}</span> | Exp: <span class="${statusWarna === 'red' ? 'text-red-500 font-black' : 'text-slate-600'}">${b.expired || 'Tanpa Exp'}</span></p>
            </div>

            <div class="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-1 shrink-0 shadow-inner">
                <button type="button" onclick="ubahQtyPenyusutan('${b.idBatch}', -1, ${qtyMax})" class="w-8 h-8 rounded-lg font-black text-base flex items-center justify-center transition-colors ${btnMinusClass}">-</button>
                <span onclick="ubahQtyPenyusutanPrompt('${b.idBatch}', ${qtyMax}, ${qtyDibuang})" class="w-6 text-center font-black text-slate-800 text-sm cursor-pointer underline decoration-dashed decoration-slate-400 underline-offset-2">${qtyDibuang}</span>
                <button type="button" onclick="ubahQtyPenyusutan('${b.idBatch}', 1, ${qtyMax})" class="w-8 h-8 rounded-lg font-black text-base flex items-center justify-center transition-colors ${btnPlusClass}">+</button>
            </div>
        </div>`;
    }).join('');
}

function ubahQtyPenyusutan(idBatch, delta, max) {
    let curr = penyusutanKeranjang[idBatch] || 0;
    let next = curr + delta;

    if (next < 0) next = 0;
    if (next > max) next = max;

    if (next === 0) delete penyusutanKeranjang[idBatch];
    else penyusutanKeranjang[idBatch] = next;

    let batches = masterItems.filter(m => {
        if (m.dnaInduk !== dnaIndukPenyusutanAktif) return false;
        let bEtalase = etalaseItems.find(e => e.dnaInduk === m.dnaInduk);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) { let f = bEtalase.antreanFIFO.find(x => x.idBatch === m.idBatch); if (f) stokEtalaseFisik = f.stok; }
        return (m.stok + stokEtalaseFisik) > 0;
    });
    batches.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));
    renderBatchesPenyusutan(batches);
    kalkulasiRealTimePenyusutan();
    triggerHaptic(50);
}

function ceklisSemuaExpiredPenyusutan() {
    let batches = masterItems.filter(m => {
        if (m.dnaInduk !== dnaIndukPenyusutanAktif) return false;
        let bEtalase = etalaseItems.find(e => e.dnaInduk === m.dnaInduk);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) { let f = bEtalase.antreanFIFO.find(x => x.idBatch === m.idBatch); if (f) stokEtalaseFisik = f.stok; }
        return (m.stok + stokEtalaseFisik) > 0;
    });
    let tglHariIni = new Date(getTanggalLokal());
    let adaExpired = false;

    batches.forEach(b => {
        if (b.expired) {
            let diffTime = new Date(b.expired) - tglHariIni;
            let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) {
                let bEtalase = etalaseItems.find(e => e.dnaInduk === b.dnaInduk);
                let stokEtalaseFisik = 0;
                if (bEtalase && bEtalase.antreanFIFO) { let f = bEtalase.antreanFIFO.find(x => x.idBatch === b.idBatch); if (f) stokEtalaseFisik = f.stok; }
                penyusutanKeranjang[b.idBatch] = b.stok + stokEtalaseFisik; // Pukul rata isi ke max stok
                adaExpired = true;
            }
        }
    });

    if (!adaExpired) {
        alert("Informasi: Tidak ada Batch yang terdeteksi Expired (Kadaluarsa) pada obat ini.");
        return;
    }

    batches.sort((a, b) => new Date(a.expired || '2099-12-31') - new Date(b.expired || '2099-12-31'));
    renderBatchesPenyusutan(batches);
    kalkulasiRealTimePenyusutan();
    triggerHaptic([50, 100]);
    showToast("✅ Seluruh batch Expired telah dimasukkan ke keranjang.");
}

function batalPilihPenyusutan() {
    dnaIndukPenyusutanAktif = null;
    penyusutanKeranjang = {};
    document.getElementById('areaFormPenyusutan').classList.add('hidden');
    document.getElementById('footerPenyusutan').classList.add('hidden');
    document.getElementById('penyu_catatan').value = '';
    let expRadio = document.querySelector('input[name="penyu_jenis"][value="Expired"]'); if(expRadio) expRadio.checked = true;
    document.getElementById('inputCariPenyusutan').focus();
}

function kalkulasiRealTimePenyusutan() {
    let totalLoss = 0;
    let idBatches = Object.keys(penyusutanKeranjang);

    idBatches.forEach(id => {
        let qtyBuang = penyusutanKeranjang[id];
        let batch = masterItems.find(m => m.idBatch === id);

        if (batch) {
            let sisaBuang = qtyBuang;
            // Simulasi Membelah Kulakan FIFO untuk akurasi kerugian antarmuka
            if (batch.kulakan_keuangan) {
                for (let f of batch.kulakan_keuangan) {
                    if (sisaBuang <= 0) break;
                    let stokKulakan = (f.sisaGudang || 0) + (f.sisaEtalase || 0);
                    if (stokKulakan > 0) {
                        let ambil = Math.min(sisaBuang, stokKulakan);
                        totalLoss += (ambil * (f.hpp || batch.modal));
                        sisaBuang -= ambil;
                    }
                }
            }
            // Fallback jaring pengaman
            if (sisaBuang > 0) {
                totalLoss += (sisaBuang * (batch.modal || 0));
            }
        }
    });

    document.getElementById('penyu_totalKerugian').textContent = rupiah(Math.round(totalLoss));
}

function eksekusiPenyusutanCerdas() {
    let idBatches = Object.keys(penyusutanKeranjang);
    if (idBatches.length === 0) {
        return alert("⚠️ Anda belum memasukkan jumlah barang yang akan dimusnahkan. Gunakan tombol [+] pada masing-masing batch.");
    }

    let jenisMasalah = document.querySelector('input[name="penyu_jenis"]:checked').value;
    let catatan = document.getElementById('penyu_catatan').value.trim() || '-';

    let totalQtyDibuangGlobal = 0;
    let totalKerugianGlobal = 0;

    tampilkanConfirmMobile(`🚨 KONFIRMASI PEMUSNAHAN\n\nMasalah: ${jenisMasalah}\nData: Akan mengeksekusi ${idBatches.length} Batch.\n\nSistem akan memotong aset dan mencatatnya sebagai Kerugian di Buku Besar secara otomatis. Lanjutkan?`, function() {

        // --- 1. SISTEM SATPAM (VALIDASI FISIK MUTLAK DI AWAL) ---
        for (let i = 0; i < idBatches.length; i++) {
            let idBatch = idBatches[i];
            let qtyBuang = penyusutanKeranjang[idBatch];
            let batchMaster = masterItems.find(m => m.idBatch === idBatch);
            if (!batchMaster) return;

            let bEtalase = etalaseItems.find(e => e.dnaInduk === batchMaster.dnaInduk);
            let stokEtalaseFisik = 0;
            if (bEtalase && bEtalase.antreanFIFO) {
                let f = bEtalase.antreanFIFO.find(x => x.idBatch === idBatch);
                if (f) stokEtalaseFisik = f.stok;
            }
            let totalFisikNyata = (batchMaster.stok || 0) + stokEtalaseFisik;

            if (qtyBuang > totalFisikNyata) {
                tutupConfirmMobile();
                return setTimeout(() => alert(`⚠️ AKSES DITOLAK (SATPAM SISTEM)!\n\nAnda mencoba memusnahkan ${qtyBuang} stok dari Batch yang hanya memiliki sisa fisik nyata ${totalFisikNyata} (Gudang + Etalase).\n\nSistem memblokir perintah minus. Silakan batalkan pilihan dan ulangi.`), 400);
            }
        }

        // --- 2. EKSEKUSI AMAN (SISTEM TEMBOK BESI) ---
        idBatches.forEach(idBatch => {
            let qtyBuang = penyusutanKeranjang[idBatch];
            if (qtyBuang <= 0) return;

            let batchMaster = masterItems.find(m => m.idBatch === idBatch);
            if (!batchMaster) return;

            let bEtalase = etalaseItems.find(e => e.dnaInduk === batchMaster.dnaInduk);
            let stokEtalaseFisik = 0;
            if (bEtalase && bEtalase.antreanFIFO) {
                let f = bEtalase.antreanFIFO.find(x => x.idBatch === idBatch);
                if (f) stokEtalaseFisik = f.stok;
            }

            // TEMBOK BESI: Hitung Jatah Potong Fisik Gudang & Etalase
            let potongGudangAsli = Math.min(qtyBuang, (batchMaster.stok || 0));
            let sisaKebutuhanBuang = qtyBuang - potongGudangAsli;
            let potongEtalaseAsli = Math.min(sisaKebutuhanBuang, stokEtalaseFisik);

            // Variabel Kalkulator Kerugian Finansial (HPP)
            let sisaBuangHPP = qtyBuang;
            let kerugianBatchIni = 0;
            let kerugianModalGudang = 0;
            let kerugianModalEtalase = 0;

            // A. MESIN PEMBELAH KULAKAN (FIFO SPLITTER KHUSUS FINANSIAL)
            if (batchMaster.kulakan_keuangan) {
                for (let f of batchMaster.kulakan_keuangan) {
                    if (sisaBuangHPP <= 0) break;

                    // Tarik HPP dari Bayangan Gudang
                    if (f.sisaGudang > 0) {
                        let ambilGudangHPP = Math.min(sisaBuangHPP, f.sisaGudang);
                        f.sisaGudang -= ambilGudangHPP;
                        sisaBuangHPP -= ambilGudangHPP;
                        let nilaiRugiG = ambilGudangHPP * (f.hpp || batchMaster.modal);
                        kerugianBatchIni += nilaiRugiG;
                        kerugianModalGudang += nilaiRugiG; // Alokasi kerugian Gudang
                        f.stokRusak = (f.stokRusak || 0) + ambilGudangHPP; // Stempel rusak
                    }

                    // Tarik HPP dari Bayangan Etalase
                    if (sisaBuangHPP > 0 && f.sisaEtalase > 0) {
                        let ambilEtalaseHPP = Math.min(sisaBuangHPP, f.sisaEtalase);
                        f.sisaEtalase -= ambilEtalaseHPP;
                        sisaBuangHPP -= ambilEtalaseHPP;
                        let nilaiRugiE = ambilEtalaseHPP * (f.hpp || batchMaster.modal);
                        kerugianBatchIni += nilaiRugiE;
                        kerugianModalEtalase += nilaiRugiE; // Alokasi kerugian Etalase
                        f.stokRusak = (f.stokRusak || 0) + ambilEtalaseHPP; // Stempel rusak
                    }
                }
            }

            // Fallback (Jaring Pengaman Jika Data Bayangan Hancur)
            if (sisaBuangHPP > 0) {
                let nilaiFallback = sisaBuangHPP * (batchMaster.modal || 0);
                kerugianBatchIni += nilaiFallback;
                kerugianModalGudang += nilaiFallback; // Pukul rata beban ke Gudang
            }

            // B. EKSEKUSI POTONG FISIK & ASET NEGARA (GUDANG VS ETALASE)
            // Negara Gudang:
            batchMaster.stok -= potongGudangAsli; // Fisik aman! (Kunci Tembok Besi)
            if (batchMaster.totalModal !== undefined) batchMaster.totalModal -= kerugianModalGudang; // Aset aman!
            batchMaster.stokRusak = (batchMaster.stokRusak || 0) + qtyBuang; // Lindungi 5 Batang Emas

            // Negara Etalase:
            if (potongEtalaseAsli > 0 && bEtalase) {
                bEtalase.stok -= potongEtalaseAsli;
                if (bEtalase.antreanFIFO) {
                    let fifo = bEtalase.antreanFIFO.find(x => x.idBatch === idBatch);
                    if (fifo) {
                        fifo.stok -= potongEtalaseAsli;
                        if (fifo.totalModal !== undefined) fifo.totalModal -= kerugianModalEtalase;
                    }
                    // Pembasmian bungkus kosong
                    bEtalase.antreanFIFO = bEtalase.antreanFIFO.filter(b => b.stok > 0);
                }
                if (bEtalase.stok <= 0) {
                    etalaseItems = etalaseItems.filter(e => e.dnaInduk !== batchMaster.dnaInduk);
                }
            }

            // C. CATAT KE BUKU HISTORI PENYUSUTAN
            let rekamJejak = {
                idPenyusutan: 'SHR-' + Date.now() + Math.floor(Math.random() * 100),
                tanggal: getTanggalLokal(),
                idBatch: batchMaster.idBatch,
                namaLengkap: batchMaster.nama + (batchMaster.varian ? ` ${batchMaster.varian}` : ''),
                kategori: batchMaster.kategori,
                jenisMasalah: jenisMasalah,
                qtyDibuang: qtyBuang,
                hppPerItem: Math.round(kerugianBatchIni / qtyBuang),
                totalKerugian: Math.round(kerugianBatchIni),
                catatan: catatan
            };
            historiPenyusutan.unshift(rekamJejak);

            totalQtyDibuangGlobal += qtyBuang;
            totalKerugianGlobal += kerugianBatchIni;
        });

        // --- 3. SUNTIK KERUGIAN KE BUKU BESAR (SIKLUS AKTIF) ---
        catatMutasiSiklus('PENYUSUTAN_TAMBAH', totalKerugianGlobal, totalQtyDibuangGlobal);

// --- 4. SIMPAN SEMUA MEMORI TERINTEGRASI ---
        saveApotekDB('apotek_penyusutan', historiPenyusutan);     saveApotekDB('apotek_masterItems', masterItems);
        saveApotekDB('apotek_etalaseItems', etalaseItems);
        saveApotekDB('apotek_siklusAktif', siklusAktif);

        tutupModalMobile('modalPenyusutanMobile');

        // --- 5. RENDER ULANG UI ---
        let searchInput = document.getElementById('cariGudangMobile');
        renderGudangMobile(searchInput ? searchInput.value : '');
        renderBerandaMobile();

        triggerHaptic([100, 50, 100]);

        setTimeout(() => {
            alert(`✅ EKSEKUSI SELESAI!\n\n${totalQtyDibuangGlobal} item telah dimusnahkan dengan perlindungan Tembok Besi.\nTotal kerugian ${rupiah(Math.round(totalKerugianGlobal))} telah direkam ke Buku Besar.`);
        }, 350);
    });
}
// ============================================================================
// 25. BUKU CATATAN DEFECTA (LOST SALES / PR BELANJA)
// ============================================================================
function bukaModalBukuCatatan() {
    renderBukuCatatan();
    document.getElementById('inputBukuCatatan').value = '';
    bukaModalMobile('modalBukuCatatan', 'panelBukuCatatan');
    setTimeout(() => document.getElementById('inputBukuCatatan').focus(), 400);
}

function tutupModalBukuCatatan() {
    tutupModalMobile('modalBukuCatatan');
}

function simpanBukuCatatan() {
    const inputEl = document.getElementById('inputBukuCatatan');
    const teks = inputEl.value.trim();
    if (!teks) return alert("Catatan tidak boleh kosong!");

    bukuCatatan.unshift({
        id: Date.now(),
        tanggal: getTanggalLokal(),
        waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        teks: teks,
        selesai: false
    });

    saveApotekDB('apotek_bukuCatatan', bukuCatatan);
    inputEl.value = '';
    renderBukuCatatan();
    triggerHaptic(50);
}

function toggleSelesaiCatatan(id) {
    let catatan = bukuCatatan.find(c => c.id === id);
    if(catatan) {
        catatan.selesai = !catatan.selesai;
        saveApotekDB('apotek_bukuCatatan', bukuCatatan);
        renderBukuCatatan();
        triggerHaptic(50);
    }
}

function hapusCatatan(id) {
    bukuCatatan = bukuCatatan.filter(c => c.id !== id);
    saveApotekDB('apotek_bukuCatatan', bukuCatatan);
    renderBukuCatatan();
}

function renderBukuCatatan() {
    const wadah = document.getElementById('wadahListBukuCatatan');
    if (bukuCatatan.length === 0) {
        wadah.innerHTML = `<div class="text-center p-6 opacity-30 mt-10"><i class="fa-solid fa-pen-nib text-3xl mb-2 text-slate-400"></i><p class="text-[10px] font-medium text-slate-500 italic">Belum ada coretan...</p></div>`;
        return;
    }

    wadah.innerHTML = bukuCatatan.map(c => {
        let opasitas = c.selesai ? 'opacity-50' : 'opacity-100';
        let coret = c.selesai ? 'line-through text-blue-900/50' : 'text-blue-900';
        let iconCheck = c.selesai ? '<i class="fa-solid fa-check-double text-blue-900"></i>' : '<i class="fa-solid fa-check text-slate-300 hover:text-blue-900"></i>';

        return `
        <div class="flex items-start gap-2 min-h-[32px] group transition-all ${opasitas} -ml-2 mb-1">
            <button onclick="toggleSelesaiCatatan(${c.id})" class="w-6 h-6 flex items-center justify-center shrink-0 mt-1 transition-colors text-xs">
                ${iconCheck}
            </button>
            <div class="flex-1 pt-1.5 pb-1">
                <p class="text-sm italic font-medium ${coret} leading-snug break-words">${c.teks}</p>
            </div>
            <button onclick="hapusCatatan(${c.id})" class="w-6 h-6 flex items-center justify-center shrink-0 mt-1 text-slate-300 hover:text-rose-500 transition-colors text-xs"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join('');
}


// ============================================================================
// 26. RADAR PENJUALAN (ANALITIK & JEJAK LAKU)
// ============================================================================
let trafikTglAwal = getTanggalLokal();
let trafikTglAkhir = getTanggalLokal();
let trafikLabelVisual = "Hari Ini";
let modeUrutRadar = 'laris';
let kalenderTerbuka = null;

function ubahUrutanRadar(mode) {
    modeUrutRadar = mode;
    ['Laris', 'Cuan', 'Sisa'].forEach(k => {
        let btn = document.getElementById('btnUrut' + k);
        if(btn) btn.className = "shrink-0 bg-slate-50 text-slate-500 border border-slate-200 px-3 py-1.5 rounded-full text-[10px] font-black transition-all active:scale-95";
    });

    let btnAktif = null;
    if(mode === 'laris') btnAktif = document.getElementById('btnUrutLaris');
    else if(mode === 'cuan') btnAktif = document.getElementById('btnUrutCuan');
    else if(mode === 'sisa_dikit') btnAktif = document.getElementById('btnUrutSisa');

    if(btnAktif) {
        if(mode === 'laris') btnAktif.className = "shrink-0 bg-orange-500 text-white border border-orange-600 px-3 py-1.5 rounded-full text-[10px] font-black transition-all shadow-md active:scale-95";
        else if(mode === 'cuan') btnAktif.className = "shrink-0 bg-emerald-500 text-white border border-emerald-600 px-3 py-1.5 rounded-full text-[10px] font-black transition-all shadow-md active:scale-95";
        else if(mode === 'sisa_dikit') btnAktif.className = "shrink-0 bg-red-500 text-white border border-red-600 px-3 py-1.5 rounded-full text-[10px] font-black transition-all shadow-md active:scale-95";
    }
    renderTrafikAnalitik();
}

// ============================================================================
// 27. GESTURE ENGINE (MESIN DRAG & SNAP-BACK SIDEBAR)
// ============================================================================
function bukaSidebarTrafik() {
    const overlay = document.getElementById('sidebarTrafikOverlay');
    const panel = document.getElementById('sidebarTrafikMobile');
    overlay.classList.remove('hidden');
    renderTrafikAnalitik();
    setTimeout(() => { overlay.classList.remove('opacity-0'); panel.classList.remove('translate-x-full'); }, 10);
    if(typeof triggerHaptic === 'function') triggerHaptic([50, 100]);
}

function tutupSidebarTrafik() {
    const overlay = document.getElementById('sidebarTrafikOverlay');
    const panel = document.getElementById('sidebarTrafikMobile');
    overlay.classList.add('opacity-0');
    panel.classList.add('translate-x-full');
    
    // --- SENSOR RESET AKORDEON ---
    // Membunuh ingatan akordeon yang terbuka agar kembali rapi saat dibuka lagi
    kalenderTerbuka = null; 
    // -----------------------------
    
    setTimeout(() => { overlay.classList.add('hidden'); }, 300);
}

// ----------------------------------------------------------------------------
// SENSOR TOUCH REAL-TIME (HANYA AKTIF UNTUK MENUTUP PANEL)
// ----------------------------------------------------------------------------
const gPanel = document.getElementById('sidebarTrafikMobile');
const gOverlay = document.getElementById('sidebarTrafikOverlay');
let isDragging = false;
let sX = 0, sY = 0, cX = 0, cY = 0;
let isPanelTerbuka = false;

document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    sX = e.touches[0].clientX;
    sY = e.touches[0].clientY;
    if (!gPanel || !gOverlay) return;

    isPanelTerbuka = !gPanel.classList.contains('translate-x-full');

    if (isPanelTerbuka) {
        isDragging = true;
    }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!isDragging || !gPanel) return;
    cX = e.touches[0].clientX;
    cY = e.touches[0].clientY;
    let dX = cX - sX;
    let dY = cY - sY;

    if (isPanelTerbuka && Math.abs(dY) > Math.abs(dX)) {
        isDragging = false;
        gPanel.style.transition = '';
        gOverlay.style.transition = '';
        return;
    }

    let pWidth = gPanel.offsetWidth;

    if (isPanelTerbuka) {
        if (dX > 0) {
            if (gPanel.style.transition !== 'none') {
                gPanel.style.transition = 'none';
                gOverlay.style.transition = 'none';
            }
            gPanel.style.transform = `translateX(${dX}px)`;
            gOverlay.style.opacity = Math.max(1 - (dX / pWidth), 0).toString();
        }
    }
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (!isDragging || !gPanel) return;
    isDragging = false;

    gPanel.style.transition = '';
    gOverlay.style.transition = '';
    gPanel.style.transform = '';
    gOverlay.style.opacity = '';

    if (cX === 0) return;
    let dX = cX - sX;

    if (isPanelTerbuka) {
        if (dX > 60) {
            tutupSidebarTrafik();
        } else {
            gPanel.classList.remove('translate-x-full');
            gOverlay.classList.remove('opacity-0');
        }
    }
    sX = 0; sY = 0; cX = 0; cY = 0;
});

// MENDENGARKAN GESTURE SWIPE GLOBAL & PERISAI (HANYA UNTUK TUTUP)
let swipeGlobalStartX = 0;
let swipeGlobalStartY = 0;

document.addEventListener('touchstart', (e) => {
    swipeGlobalStartX = e.touches[0].clientX;
    swipeGlobalStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
    let deltaX = swipeGlobalStartX - e.changedTouches[0].clientX;
    let deltaY = Math.abs(swipeGlobalStartY - e.changedTouches[0].clientY);

    if (deltaY > 40) return;

    let panelTrafik = document.getElementById('sidebarTrafikOverlay');
    let isTrafikTerbuka = panelTrafik && !panelTrafik.classList.contains('hidden');

    if (isTrafikTerbuka) {
        if (deltaX < -60) {
            tutupSidebarTrafik();
        }
    }
});

function toggleDropdownTrafik() {
    const menu = document.getElementById('panelFilterTrafik');
    const icon = document.getElementById('iconDropdownTrafik');
    const backdrop = document.getElementById('backdropFilterTrafik');
    if(menu.classList.contains('hidden')) {
        menu.classList.remove('hidden'); 
        if(backdrop) backdrop.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';
    } else {
        menu.classList.add('hidden'); 
        if(backdrop) backdrop.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function setFilterTrafik(tipe) {
    let tglSkrg = new Date();
    if (tipe === 'hari_ini') {
        trafikTglAwal = getTanggalLokal(tglSkrg); trafikTglAkhir = getTanggalLokal(tglSkrg);
        trafikLabelVisual = "Hari Ini";
    } else if (tipe === '7_hari') {
        let tglLalu = new Date(); tglLalu.setDate(tglLalu.getDate() - 6);
        trafikTglAwal = getTanggalLokal(tglLalu); trafikTglAkhir = getTanggalLokal(tglSkrg);
        trafikLabelVisual = "7 Hari Terakhir";
    } else if (tipe === '30_hari') {
        let tglLalu = new Date(); tglLalu.setDate(tglLalu.getDate() - 29);
        trafikTglAwal = getTanggalLokal(tglLalu); trafikTglAkhir = getTanggalLokal(tglSkrg);
        trafikLabelVisual = "Bulan Ini (30 Hari)";
    } else if (tipe === 'semua') {
        trafikTglAwal = "2000-01-01"; trafikTglAkhir = "2099-12-31";
        trafikLabelVisual = "Semua Waktu";
    } else if (tipe === 'manual') {
        let awal = document.getElementById('filterTrafikAwal').value;
        let akhir = document.getElementById('filterTrafikAkhir').value;
        if(!awal || !akhir) return alert("⚠️ Pilih tanggal Dari dan Sampai!");
        trafikTglAwal = awal; trafikTglAkhir = akhir;
        trafikLabelVisual = awal === akhir ? formatTanggalPendek(awal) : `${formatTanggalPendek(awal)} - ${formatTanggalPendek(akhir)}`;
    }

    document.getElementById('teksFilterTrafikUi').textContent = trafikLabelVisual;
    toggleDropdownTrafik();
    renderTrafikAnalitik();
}

function renderTrafikAnalitik() {
    let dataGabungan = {};
    let tglHariIni = new Date(getTanggalLokal());
    let tglBatas30 = new Date(); tglBatas30.setDate(tglBatas30.getDate() - 30); let strBatas30 = getTanggalLokal(tglBatas30);

    masterItems.forEach(m => {
        if(m.nama !== '___SYSTEM_AUTH___' && m.kategori !== '⚠️ Barang Retur') {
            if(!dataGabungan[m.dnaInduk]) {
                dataGabungan[m.dnaInduk] = { dnaInduk: m.dnaInduk, nama: m.nama + (m.varian ? ` ${m.varian}` : ''), stokRak: 0, qtyJualGlobal: 0, qtyJualFiltered: 0, qtyJual30Hari: 0, labaKotor: 0, modal: 0, expTerdekat: '2099-12-31' };
            }
            dataGabungan[m.dnaInduk].stokRak += m.stok;
            dataGabungan[m.dnaInduk].modal = m.modal || 0;
            if (m.expired && m.stok > 0 && m.expired < dataGabungan[m.dnaInduk].expTerdekat) {
                dataGabungan[m.dnaInduk].expTerdekat = m.expired;
            }
        }
    });
    etalaseItems.forEach(e => {
        let dna = e.dnaInduk || e.nama;
        if(dataGabungan[dna]) { dataGabungan[dna].stokRak += e.stok; }
    });

    cashierHistory.filter(t => !t.isPelunasan).forEach(trx => {
        let isDalamFilter = trx.tanggal >= trafikTglAwal && trx.tanggal <= trafikTglAkhir;

        if(trx.detailKeranjang) {
            trx.detailKeranjang.forEach(item => {
                let dna = item.dnaInduk || item.nama;
                if(!dataGabungan[dna]) dataGabungan[dna] = { dnaInduk: dna, nama: item.nama + (item.varian ? ` ${item.varian}` : ''), stokRak: 0, qtyJualGlobal: 0, qtyJualFiltered: 0, qtyJual30Hari: 0, labaKotor: 0, modal: 0, expTerdekat: '2099-12-31' };

                dataGabungan[dna].qtyJualGlobal += item.qty;
                if (trx.tanggal >= strBatas30) dataGabungan[dna].qtyJual30Hari += item.qty;

                if (isDalamFilter) {
                    let labaItem = (item.jual * item.qty) - ((item.hppSatuan || (item.jual * 0.8)) * item.qty);
                    dataGabungan[dna].qtyJualFiltered += item.qty;
                    dataGabungan[dna].labaKotor += labaItem;
                }
            });
        } else {
            let dna = trx.obat;
            if(!dataGabungan[dna]) dataGabungan[dna] = { dnaInduk: dna, nama: trx.obat, stokRak: 0, qtyJualGlobal: 0, qtyJualFiltered: 0, qtyJual30Hari: 0, labaKotor: 0, modal: 0, expTerdekat: '2099-12-31' };


            let qtyTrx = trx.item || 1;
            dataGabungan[dna].qtyJualGlobal += qtyTrx;
            if (trx.tanggal >= strBatas30) dataGabungan[dna].qtyJual30Hari += qtyTrx;

            if (isDalamFilter) {
                let lItem = trx.laba || (trx.total * 0.2);
                dataGabungan[dna].qtyJualFiltered += qtyTrx;
                dataGabungan[dna].labaKotor += lItem;
            }
        }
    });

    let arrLaku = []; let arrMati = [];
    Object.values(dataGabungan).forEach(item => {
        if(item.qtyJualFiltered > 0) arrLaku.push(item);
        else if (item.stokRak > 0 && item.qtyJualFiltered === 0) arrMati.push(item);
    });

    if (modeUrutRadar === 'laris') {
        arrLaku.sort((a, b) => b.qtyJualFiltered - a.qtyJualFiltered);
    } else if (modeUrutRadar === 'cuan') {
        arrLaku.sort((a, b) => b.labaKotor - a.labaKotor);
    } else if (modeUrutRadar === 'sisa_dikit') {
        arrLaku = arrLaku.filter(a => a.stokRak <= 2);
        arrLaku.sort((a, b) => a.stokRak - b.stokRak);
    }

    arrMati.sort((a, b) => (b.stokRak * b.modal) - (a.stokRak * a.modal));

    let htmlLaku = arrLaku.map((item) => {
        let stikerKulakan = item.stokRak <= 2 ? `<span class="bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest"><i class="fa-solid fa-cart-arrow-down"></i> Waktunya Kulakan</span>` : '';
        let stikerExp = '';
        if (item.expTerdekat !== '2099-12-31') {
            let diffDays = Math.ceil((new Date(item.expTerdekat) - tglHariIni) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) stikerExp = `<span class="bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest"><i class="fa-solid fa-skull"></i> Dekat Expired</span>`;
        }
        let stikerGabung = (stikerKulakan || stikerExp) ? `<div class="flex gap-1 mt-1.5">${stikerKulakan}${stikerExp}</div>` : '';
        let isExpanded = kalenderTerbuka === item.dnaInduk;

        return `
        <div class="bg-white border ${isExpanded ? 'border-corporate-400 shadow-md' : 'border-slate-200 shadow-sm'} rounded-2xl mb-2.5 overflow-hidden transition-all duration-300">
            <div onclick="toggleKalenderTermal('${item.dnaInduk}')" class="p-3 flex justify-between items-center cursor-pointer active:bg-slate-50">
                <div class="flex-1 pr-2">
                    <h4 class="text-xs font-black text-slate-800 leading-tight">${item.nama}</h4>
                    ${stikerGabung}
                </div>
                <div class="text-right shrink-0">
                    <p class="text-[10px] font-bold text-slate-400 leading-none mb-1">Laku: <span class="text-corporate-600 font-black text-sm">${item.qtyJualFiltered}</span></p>
                    <p class="text-[9px] font-bold text-slate-500 leading-none">Sisa Rak: <span class="${item.stokRak <= 2 ? 'text-red-500' : 'text-slate-800'} font-black">${item.stokRak}</span></p>
                </div>
                <i class="fa-solid fa-chevron-${isExpanded ? 'up text-corporate-500' : 'down text-slate-300'} ml-2 text-[10px] transition-transform"></i>
            </div>
            <div id="wadahKalender-${item.dnaInduk}" class="${isExpanded ? 'block' : 'hidden'} bg-slate-50 border-t border-slate-100 p-3"></div>
        </div>`;
    }).join('');

    let htmlMati = arrMati.map(item => {
        let uangMati = item.stokRak * item.modal;
        let stikerExp = '';
        if (item.expTerdekat !== '2099-12-31') {
            let diffDays = Math.ceil((new Date(item.expTerdekat) - tglHariIni) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) stikerExp = `<span class="bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest mt-1 inline-block"><i class="fa-solid fa-skull"></i> Dekat Expired</span>`;
        }

        let badgeKonteks = '';
        if (item.qtyJual30Hari > 0) {
            badgeKonteks = `<span class="bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest mt-1.5 inline-block shadow-sm"><i class="fa-solid fa-fire-flame-curved"></i> Laku ${item.qtyJual30Hari}x Bulan Ini</span>`;
        } else {
            badgeKonteks = `<span class="bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest mt-1.5 inline-block"><i class="fa-solid fa-snowflake"></i> Beku (0 Laku Sebulan)</span>`;
        }

        return `
        <div class="anim-stagger-item opacity-0 translate-y-8 transition-all duration-700 ease-out bg-white border border-rose-200 rounded-xl p-3 flex justify-between items-center mb-2 shadow-sm relative overflow-hidden">
            <div class="absolute left-0 top-0 bottom-0 w-1 bg-rose-400"></div>
            <div class="pl-2 flex-1">
                <h4 class="text-xs font-bold text-slate-700 leading-tight mb-0.5 truncate">${item.nama}</h4>
                <p class="text-[9px] font-black text-rose-500">Modal Nyangkut: ${rupiah(uangMati)}</p>
                ${badgeKonteks}
                ${stikerExp}
            </div>
            <div class="text-right shrink-0 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                <p class="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Sisa Rak</p>
                <p class="text-sm font-black text-slate-700 leading-none">${item.stokRak}</p>
            </div>
        </div>`;
    }).join('');

    let teksKosongLaku = modeUrutRadar === 'sisa_dikit' ? "Hebat! Tidak ada obat dengan stok menipis (<=2)." : "Tidak ada data penjualan sesuai filter ini.";
    document.getElementById('wadahTrafikLaku').innerHTML = htmlLaku || `<div class="text-center p-4 text-slate-400 text-xs font-bold border border-dashed border-slate-200 rounded-2xl">${teksKosongLaku}</div>`;
    document.getElementById('wadahTrafikMati').innerHTML = htmlMati || `<div class="text-center p-4 text-emerald-400 text-xs font-bold bg-emerald-50 rounded-2xl border border-emerald-100">Bagus! Tidak ada barang tidur.</div>`;

    if (kalenderTerbuka) renderIsiKalenderTermal(kalenderTerbuka);

    let panelTrafik = document.getElementById('sidebarTrafikMobile');
    if (panelTrafik && !panelTrafik.classList.contains('translate-x-full')) {
        if(typeof jalankanAnimasiStagger === 'function') jalankanAnimasiStagger(10);
    }
}

function toggleKalenderTermal(dnaInduk) {
    if (kalenderTerbuka === dnaInduk) { kalenderTerbuka = null; }
    else { kalenderTerbuka = dnaInduk; }
    renderTrafikAnalitik();
}

function renderIsiKalenderTermal(dnaInduk) {
    let wadah = document.getElementById('wadahKalender-' + dnaInduk);
    if (!wadah) return;

    let jejak30Hari = [];
    let hariIni = new Date();
    hariIni.setHours(0, 0, 0, 0);

    for (let i = 29; i >= 0; i--) {
        let tglMundur = new Date(hariIni);
        tglMundur.setDate(hariIni.getDate() - i);
        let strTanggal = getTanggalLokal(tglMundur);
        jejak30Hari.push({ tglStr: strTanggal, dateNum: tglMundur.getDate(), qtyLaku: 0 });
    }

    let tglBatasBawah = jejak30Hari[0].tglStr;
    let tglBatasAtas = jejak30Hari[29].tglStr;

    let trxObatIni = cashierHistory.filter(t => t.tanggal >= tglBatasBawah && t.tanggal <= tglBatasAtas && !t.isPelunasan);

    trxObatIni.forEach(trx => {
        let lakuHariIni = 0;
        if (trx.detailKeranjang) {
            trx.detailKeranjang.forEach(item => {
                let idItem = item.dnaInduk || item.nama;
                if (idItem === dnaInduk) lakuHariIni += item.qty;
            });
        } else {
            let bMaster = masterItems.find(m => m.dnaInduk === dnaInduk);
            let targetNama = bMaster ? bMaster.nama : dnaInduk;
            if (trx.obat.includes(targetNama)) lakuHariIni += (trx.item || 1);
        }

        if (lakuHariIni > 0) {
            let indeksHari = jejak30Hari.findIndex(h => h.tglStr === trx.tanggal);
            if (indeksHari !== -1) jejak30Hari[indeksHari].qtyLaku += lakuHariIni;
        }
    });

    let htmlKotak = jejak30Hari.map(h => {
        let bgWarna = 'bg-slate-200/60';
        let teksWarna = 'text-transparent';
        if (h.qtyLaku >= 6) { bgWarna = 'bg-emerald-600 shadow-sm border-emerald-700'; teksWarna = 'text-white'; }
        else if (h.qtyLaku >= 3) { bgWarna = 'bg-emerald-400 shadow-sm border-emerald-500'; teksWarna = 'text-white'; }
        else if (h.qtyLaku >= 1) { bgWarna = 'bg-emerald-200 border-emerald-300'; teksWarna = 'text-emerald-800'; }

        let funcKlik = `document.getElementById('tooltipKalender-${dnaInduk}').innerHTML = '📅 <b>Tanggal ${h.tglStr}:</b> Laku <b class=\\'text-emerald-600\\'>${h.qtyLaku} Pcs</b>'`;

        return `
        <div onclick="${funcKlik}" class="aspect-square rounded-md ${bgWarna} relative flex items-center justify-center cursor-pointer transition-transform active:scale-90 border group">
            <span class="absolute top-[2px] left-1 text-[6px] font-black ${h.qtyLaku > 0 ? 'text-white/70' : 'text-slate-400'}">${h.dateNum}</span>
            <span class="text-[11px] font-black ${teksWarna}">${h.qtyLaku > 0 ? h.qtyLaku : ''}</span>
        </div>`;
    }).join('');

    wadah.innerHTML = `
        <p class="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><i class="fa-solid fa-calendar-days text-corporate-500"></i> Jejak Laku 30 Hari</p>
        <div class="grid grid-cols-7 gap-1.5 mb-2">
            ${htmlKotak}
        </div>
        <p id="tooltipKalender-${dnaInduk}" class="text-[9px] text-slate-600 bg-white border border-slate-200 rounded-lg p-2 text-center shadow-sm">Ketuk kotak warna di atas untuk melihat detail per hari.</p>
    `;
}

// ===================================================================
// MESIN DRILL-DOWN ANALYTICS (DIPERBARUI DENGAN KALKULATOR MASTER & OPSI B)
// ===================================================================
function bukaRincianPantauan(jenisKartu) {
    let judul = document.getElementById('judulDetailStok');
    let subJudul = document.getElementById('subJudulDetailStok');
    if(judul) judul.innerText = "Audit: " + jenisKartu;
    if(subJudul) subJudul.innerText = "Rincian Data Aktual & Finansial";

    let modal = document.getElementById('modalDetailStokMobile');
    let panel = document.getElementById('panelDetailStokMobile');
    if(modal && panel) {
        modal.classList.remove('hidden');
        setTimeout(() => { panel.classList.remove('translate-y-full'); }, 10);
    }

    // PANGGIL POHON DATA DARI SATPAM ARSIP
    let pohonData = KalkulatorMasterObat();
    let dataArray = Object.values(pohonData);


    const buatKartuBarang = (kategoriHtml, namaHtml, awal, laku, sisa, jual, tglExp = "", isSudahExpired = false) => {
        let badgeExpired = '';
        if (tglExp) {
            if (isSudahExpired) {
                badgeExpired = `<span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md ml-2 border border-red-700 shadow-md animate-pulse"><i class="fa-solid fa-skull"></i> TELAH EXPIRED: ${tglExp}</span>`;
            } else {
                badgeExpired = `<span class="bg-red-50 text-red-600 text-[10px] font-black px-2 py-0.5 rounded-md ml-2 border border-red-200 shadow-sm"><i class="fa-solid fa-triangle-exclamation"></i> EXP: ${tglExp}</span>`;
            }
        }

        let bgCard = isSudahExpired ? 'bg-red-50 border-red-500 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-white border-slate-200 shadow-sm';
        let txtNama = isSudahExpired ? 'text-red-700' : 'text-slate-800';
        let txtKat = isSudahExpired ? 'bg-red-100 text-red-700 border-red-200' : 'bg-blue-50 text-blue-600 border-blue-100';
        let bgBox1 = isSudahExpired ? 'bg-white/60 border-red-200/60' : 'bg-slate-50 border-slate-200/60';
        let txtLabel1 = isSudahExpired ? 'text-red-500' : 'text-slate-500';
        let txtVal1 = isSudahExpired ? 'text-red-800' : 'text-slate-700';
        let txtValSisa = isSudahExpired ? 'text-red-700' : 'text-emerald-600';
        let bgBox2 = isSudahExpired ? 'bg-red-100/50 border-red-300/60' : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200/60';
        let txtLabel2 = isSudahExpired ? 'text-red-600' : 'text-orange-800';
        let txtVal2 = isSudahExpired ? 'text-red-700' : 'text-orange-600';

        return `
        <div class="${bgCard} p-4 rounded-2xl border mb-3 relative overflow-hidden transition-all duration-300">
            <div class="absolute top-0 right-0 ${txtKat} text-[9px] font-black px-3 py-1 rounded-bl-xl border-b border-l uppercase tracking-widest shadow-sm">
                ${kategoriHtml}
            </div>
            <div class="pr-20 mb-3 flex items-center flex-wrap gap-y-1">
                <div class="${txtNama}">${namaHtml}</div>
                ${badgeExpired}
            </div>
            <div class="grid grid-cols-2 gap-3 border-t ${isSudahExpired ? 'border-red-200' : 'border-slate-100'} pt-3">
                <div class="${bgBox1} rounded-xl p-2.5 border shadow-inner">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[9px] font-bold ${txtLabel1} uppercase">Stok Awal Pagi</span>
                        <span class="text-[10px] font-black ${txtVal1}">${awal}</span>
                    </div>
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[9px] font-bold ${txtLabel1} uppercase">Terjual H.Ini</span>
                        <span class="text-[10px] font-black text-rose-600">- ${laku}</span>
                    </div>
                    <div class="flex justify-between items-center pt-1.5 mt-1 border-t ${isSudahExpired ? 'border-red-200' : 'border-slate-200'}">
                        <span class="text-[9px] font-black ${isSudahExpired ? 'text-red-700' : 'text-slate-700'} uppercase">Sisa Fisik</span>
                        <span class="text-[12px] font-black ${txtValSisa}">${sisa}</span>
                    </div>
                </div>
                <div class="${bgBox2} rounded-xl p-2.5 border flex flex-col justify-center items-center shadow-inner h-full">
                    <span class="text-[10px] font-black ${txtLabel2} uppercase mb-1">Harga Jual</span>
                    <span class="text-[16px] sm:text-lg font-black ${txtVal2} drop-shadow-sm">${jual}</span>
                </div>
            </div>
        </div>
        `;
    };

    let htmlList = '';
    let totalQty = 0;
    let totalNominal = 0;
    let formatRp = (angka) => "Rp " + Number(angka || 0).toLocaleString('id-ID');
    let batas30Hari = new Date();
    batas30Hari.setDate(new Date().getDate() + 30);

    let dataDifilter = dataArray.filter(obj => {
        // KUNCI FILTER: OPSI B (MURNI HARI INI & KALENDER)
        if (jenisKartu === 'Obat Terjual') return obj.lakuHariIni > 0;
        if (jenisKartu === 'Stok Kritis') return obj.sisaFisikTotal <= 2;
        if (jenisKartu === 'Kedaluwarsa') {
            if (obj.expTerdekat === '2099-12-31' || obj.sisaFisikTotal <= 0) return false;
            let tglExp = new Date(obj.expTerdekat);
            return tglExp <= batas30Hari;
        }
        return true; // Mode 'Jenis Obat'
    });

    if (jenisKartu === 'Obat Terjual') {
        dataDifilter.sort((a,b) => b.lakuHariIni - a.lakuHariIni);
    } else {
        dataDifilter.sort((a,b) => a.namaLengkap.localeCompare(b.namaLengkap));
    }

    dataDifilter.forEach(obj => {
        let lakuTampil = obj.lakuHariIni;
        // RUMUS PATEN PAGI HARI
        let awalTampil = obj.sisaFisikTotal + lakuTampil;

        let stringTgl = "";
        let isSudahExpired = false;

        if (jenisKartu === 'Kedaluwarsa' && obj.expTerdekat !== '2099-12-31') {
            let d = new Date(obj.expTerdekat);
            stringTgl = d.toLocaleDateString('id-ID', {day: '2-digit', month: 'short', year: 'numeric'});

            // Sensor penentu warna merah berdenyut
            let diffHari = Math.floor((d - new Date()) / (1000 * 60 * 60 * 24));
            if (diffHari <= 0) {
                isSudahExpired = true;
            }
        }

        let infoFormat = formatNamaItemMaster(obj.dnaInduk, obj.namaLengkap, '', obj.kategori, 'text-[15px]');
        htmlList += buatKartuBarang(
            infoFormat.kategoriTxt, infoFormat.namaHtml, awalTampil, lakuTampil,
            obj.sisaFisikTotal, formatRp(obj.hargaJual), stringTgl, isSudahExpired
        );

        if (jenisKartu === 'Obat Terjual') {
            totalQty += lakuTampil;
            totalNominal += (lakuTampil * obj.hargaJual);
        } else {
            totalQty += obj.sisaFisikTotal;
            totalNominal += (obj.sisaFisikTotal * obj.hargaJual);
        }
    });

    if(htmlList === '') {
        htmlList = `
        <div class="p-6 text-center bg-white rounded-2xl border border-slate-200 shadow-sm mt-4">
            <div class="w-16 h-16 mx-auto bg-slate-50 rounded-full flex items-center justify-center text-slate-400 text-3xl mb-3"><i class="fa-solid fa-box-open"></i></div>
            <p class="text-sm font-black text-slate-700 mb-1">Aman & Terkendali</p>
            <p class="text-[10px] font-bold text-slate-500 leading-tight">Belum ada data barang yang masuk dalam kriteria ini.</p>
        </div>`;
    }

    let wadah = document.getElementById('wadahListDetailStok');
    if(wadah) wadah.innerHTML = htmlList;

    let headerQty = document.getElementById('rekapQtyDetailStok');
    let headerNominal = document.getElementById('rekapNominalDetailStok');
    if(headerQty) headerQty.innerText = totalQty + " Pcs";
    if(headerNominal) headerNominal.innerText = formatRp(totalNominal);
}

// ============================================================================
// 28. THE MASTER ENGINE (SATPAM ARSIP) - ARSITEKTUR "SATU PINTU" POHON DATA
// ============================================================================
function KalkulatorMasterObat() {
    let pohonData = {};
    let tglHariIni = getTanggalLokal();
    let waktuMulai = siklusAktif.waktuStart || 0;

    // FASE 1: TANAM AKAR DARI GUDANG MASTER
    masterItems.forEach(m => {
        if (m.nama === '___SYSTEM_AUTH___' || m.kategori === '⚠️ Barang Retur') return;
        let kunci = m.dnaInduk;
        if (!pohonData[kunci]) {
            pohonData[kunci] = {
                dnaInduk: kunci, namaLengkap: m.nama + (m.varian ? ` ${m.varian}` : ''),
                kategori: m.kategori || 'Umum', hargaJual: m.jual || 0,
                sisaGudang: 0, sisaEtalase: 0, sisaFisikTotal: 0,
                lakuShiftIni: 0, lakuHariIni: 0, lakuGlobal: 0,
                omzetShiftIni: 0, labaShiftIni: 0,
                rusakExpTotal: 0, modalAsetTersisa: 0,
                batches: [], expTerdekat: '2099-12-31'
            };
        }
        let sisaGudangBatch = m.stok || 0; let rusakBatch = m.stokRusak || 0;
        pohonData[kunci].sisaGudang += sisaGudangBatch; pohonData[kunci].rusakExpTotal += rusakBatch;

        // SENSOR GABUNGAN: Membaca total fisik Gudang + Etalase untuk Expired
        let bEtalase = etalaseItems.find(e => e.dnaInduk === m.dnaInduk);
        let stokEtalaseFisik = 0;
        if (bEtalase && bEtalase.antreanFIFO) {
            let f = bEtalase.antreanFIFO.find(x => x.idBatch === m.idBatch);
            if (f) stokEtalaseFisik = f.stok;
        }
        let totalFisikValid = sisaGudangBatch + stokEtalaseFisik;

        if (m.expired && totalFisikValid > 0 && m.expired < pohonData[kunci].expTerdekat) {
            pohonData[kunci].expTerdekat = m.expired;
        }

        let modalBatchIni = 0;
        if (m.kulakan_keuangan) { m.kulakan_keuangan.forEach(f => { modalBatchIni += ((f.sisaGudang || 0) + (f.sisaEtalase || 0)) * (f.hpp || m.modal || 0); }); }
        else { modalBatchIni = sisaGudangBatch * (m.modal || 0); }
        pohonData[kunci].modalAsetTersisa += modalBatchIni;
        pohonData[kunci].batches.push(m);
    });

    // FASE 2: TANAM RANTING DARI ETALASE FISIK
    etalaseItems.forEach(e => {
        let kunci = e.dnaInduk || e.nama;
        if (!pohonData[kunci]) {
            pohonData[kunci] = {
                dnaInduk: kunci, namaLengkap: e.nama + (e.varian ? ` ${e.varian}` : ''), kategori: e.kategori || 'Umum', hargaJual: e.jual || 0,
                sisaGudang: 0, sisaEtalase: 0, sisaFisikTotal: 0, lakuShiftIni: 0, lakuHariIni: 0, lakuGlobal: 0, omzetShiftIni: 0, labaShiftIni: 0,
                rusakExpTotal: 0, modalAsetTersisa: 0, batches: [], expTerdekat: '2099-12-31'
            };
        }
        pohonData[kunci].sisaEtalase += (e.stok || 0);
        if (pohonData[kunci].batches.length === 0 && e.antreanFIFO) { e.antreanFIFO.forEach(f => { pohonData[kunci].modalAsetTersisa += (f.stok * (f.modal || 0)); }); }
    });

    Object.values(pohonData).forEach(item => { item.sisaFisikTotal = item.sisaGudang + item.sisaEtalase; });

    // FASE 3: PANEN BUAH TERJUAL DARI RIWAYAT
    cashierHistory.forEach(trx => {
        if (trx.isPelunasan) return; // SENSOR SILUMAN: Utang tidak boleh merusak fisik

        let isShiftIni = (trx.id >= waktuMulai);
        let isHariIni = (trx.tanggal === tglHariIni);

        if (trx.detailKeranjang && trx.detailKeranjang.length > 0) {
            trx.detailKeranjang.forEach(item => {
                let kunci = item.dnaInduk || item.nama;
                if (!pohonData[kunci]) {
                    pohonData[kunci] = {
                        dnaInduk: kunci, namaLengkap: item.nama + (item.varian ? ` ${item.varian}` : ''), kategori: item.kategori || 'Barang Dihapus', hargaJual: item.jual || 0,
                        sisaGudang: 0, sisaEtalase: 0, sisaFisikTotal: 0, lakuShiftIni: 0, lakuHariIni: 0, lakuGlobal: 0, omzetShiftIni: 0, labaShiftIni: 0,
                        rusakExpTotal: 0, modalAsetTersisa: 0, batches: [], expTerdekat: '2099-12-31'
                    };
                }
                                                let qtyLaku = item.qty || 0; pohonData[kunci].lakuGlobal += qtyLaku;
                if (isShiftIni) { 
                    pohonData[kunci].lakuShiftIni += qtyLaku; 
                    pohonData[kunci].omzetShiftIni += (qtyLaku * (item.jual || 0)); 
                    let modalMutlak = item.hppTotalModal !== undefined ? item.hppTotalModal : (qtyLaku * (item.hppSatuan || (item.jual * 0.8)));
                    pohonData[kunci].labaShiftIni += ((qtyLaku * (item.jual || 0)) - modalMutlak); 
                }
                if (isHariIni) { pohonData[kunci].lakuHariIni += qtyLaku; }
            });

        } else {
            let kunci = trx.obat;
            if (!pohonData[kunci]) {
                pohonData[kunci] = {
                    dnaInduk: kunci, namaLengkap: kunci, kategori: 'Data Lama', hargaJual: 0, sisaGudang: 0, sisaEtalase: 0, sisaFisikTotal: 0,
                    lakuShiftIni: 0, lakuHariIni: 0, lakuGlobal: 0, omzetShiftIni: 0, labaShiftIni: 0, rusakExpTotal: 0, modalAsetTersisa: 0, batches: [], expTerdekat: '2099-12-31'
                };
            }
            let qtyLaku = trx.item || 1; pohonData[kunci].lakuGlobal += qtyLaku;
            if (isShiftIni) { pohonData[kunci].lakuShiftIni += qtyLaku; pohonData[kunci].omzetShiftIni += (trx.total || 0); pohonData[kunci].labaShiftIni += (trx.laba || 0); }
            if (isHariIni) { pohonData[kunci].lakuHariIni += qtyLaku; }
        }
    });
    return pohonData;
}



// ==========================================
// MESIN RENDER: BUKU BARANG RUSAK (SIKLUS BERJALAN)
// ==========================================
function renderBukuRusakMobile() {
    const wadah = document.getElementById('daftarBukuRusakMobile');

    // Filter by siklusAktif (waktuMulai)
    // idPenyusutan format: 'SHR-' + Date.now() + Math.floor(Math.random() * 100)
    // We can extract timestamp from idPenyusutan OR use tanggal if it matches siklusAktif.tanggalStart
    // But since we want to be precise, we extract timestamp.
    let waktuMulai = siklusAktif.waktuStart || 0;

    let dataPeriode = historiPenyusutan.filter(h => {
        let valid = false;
        if (h.idPenyusutan && h.idPenyusutan.startsWith('SHR-')) {
            let part = h.idPenyusutan.substring(4);
            let timestamp = parseInt(part.substring(0, 13));
            if (!isNaN(timestamp) && timestamp >= waktuMulai) {
                valid = true;
            }
        }
        // Fallback
        if(!valid && !h.idPenyusutan) {
           valid = h.tanggal >= siklusAktif.tanggalStart;
        }
        return valid;
    });

    let totalQty = 0;
    let totalRugi = 0;

    if (dataPeriode.length === 0) {
        wadah.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm mt-4"><i class="fa-solid fa-dumpster-fire text-4xl text-slate-300 mb-3 block"></i><p class="font-bold text-slate-600">Tidak ada barang rusak/susut di siklus ini.</p></div>`;
    } else {
        wadah.innerHTML = dataPeriode.map((r, index) => {
            totalQty += (r.qtyDibuang || 0);
            totalRugi += (r.totalKerugian || 0);

            // Re-use formatNamaItemMaster for consistency
            // Note: historiPenyusutan structure: {namaLengkap, kategori, jenisMasalah, qtyDibuang, hppPerItem, totalKerugian}
            let infoFormat = formatNamaItemMaster(r.idBatch, r.namaLengkap, '', r.kategori, 'text-sm');

            return `
            <div class="bg-white border border-red-200 rounded-2xl p-4 shadow-sm flex items-start gap-3 relative overflow-hidden">
                <div class="absolute top-0 right-0 w-16 h-16 bg-red-50 rounded-bl-full -z-0 opacity-50"></div>
                <div class="w-7 h-7 rounded-full bg-red-100 text-red-500 flex items-center justify-center font-black text-xs shrink-0 border border-red-200 relative z-10">${index + 1}</div>
                <div class="flex-1 relative z-10">
                    <div class="mb-2">
                        ${infoFormat.namaHtml}
                        <div class="mt-1">${infoFormat.kategoriHtml}</div>
                    </div>
                    <p class="text-[11px] font-bold text-slate-600 leading-relaxed">
                        <span class="bg-red-50 px-2 py-0.5 rounded text-red-700">${r.qtyDibuang} Pcs</span> <span class="text-slate-300 mx-0.5">|</span>
                        Total Rugi: <span class="text-red-600">${rupiah(r.totalKerugian)}</span>
                    </p>
                    <p class="text-[10px] text-slate-500 mt-1 italic"><i class="fa-solid fa-triangle-exclamation text-red-400"></i> ${r.jenisMasalah}${r.catatan && r.catatan !== '-' && r.catatan !== '- -' ? ' - ' + r.catatan : ''}</p>
                    <div class="mt-3 flex gap-2 border-t border-red-100 pt-3">
                        <button onclick="prosesBatalPenyusutan('${r.idPenyusutan}')" class="flex-1 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold py-1.5 rounded-lg shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-rotate-left mr-1"></i> Batal (Undo)</button>
                        <button onclick="prosesHapusRiwayatPenyusutan('${r.idPenyusutan}')" class="flex-1 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold py-1.5 rounded-lg shadow-sm active:scale-95 transition-all hover:bg-red-100"><i class="fa-solid fa-trash mr-1"></i> Hapus Histori</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    if (document.getElementById('bukuRusakTotalQty')) document.getElementById('bukuRusakTotalQty').textContent = totalQty + " Pcs";
    if (document.getElementById('bukuRusakTotalRugi')) document.getElementById('bukuRusakTotalRugi').textContent = rupiah(totalRugi);
}


async function prosesHapusRiwayatPenyusutan(idPenyusutan) {
    let r = historiPenyusutan.find(h => h.idPenyusutan === idPenyusutan);
    if (!r) return;

    let confirm = await customConfirm("Apakah Anda yakin ingin menghapus histori ini?\n\n(Ini hanya membersihkan histori, stok dan uang tidak akan dikembalikan)");
    if (!confirm) return;

    historiPenyusutan = historiPenyusutan.filter(h => h.idPenyusutan !== idPenyusutan);
    saveApotekDB('apotek_penyusutan', historiPenyusutan);
    renderBukuRusakMobile();
}

async function prosesBatalPenyusutan(idPenyusutan) {
    let r = historiPenyusutan.find(h => h.idPenyusutan === idPenyusutan);
    if (!r) return;

    let confirm = await customConfirm(`Apakah Anda yakin ingin MEMBATALKAN penyusutan ini?\n\nStok (${r.qtyDibuang} Pcs) akan dikembalikan ke Gudang, dan kerugian HPP (${rupiah(r.totalKerugian)}) akan dihapus dari laporan.`);
    if (!confirm) return;

    // 1. Anti-Zombie Shield
    let batchMaster = masterItems.find(m => m.idBatch === r.idBatch);
    if (!batchMaster) {
        alert("Akses Ditolak: Data induk obat di Gudang sudah dihapus total. Pembatalan tidak bisa dilakukan.");
        return;
    }

    // 2. Warehouse Return Shield
    batchMaster.stok += r.qtyDibuang;

    // 3. HPP/COGS Restoration Shield (kulakan_keuangan)
    let sisaDibatalkan = r.qtyDibuang;
    if (batchMaster.kulakan_keuangan && batchMaster.kulakan_keuangan.length > 0) {
        for (let i = batchMaster.kulakan_keuangan.length - 1; i >= 0; i--) {
            let f = batchMaster.kulakan_keuangan[i];
            if (f.stokRusak > 0 && sisaDibatalkan > 0) {
                let bisaDikembalikan = Math.min(f.stokRusak, sisaDibatalkan);
                f.stokRusak -= bisaDikembalikan;
                f.sisaGudang += bisaDikembalikan;
                sisaDibatalkan -= bisaDikembalikan;
            }
        }
    }
    batchMaster.stokRusak -= r.qtyDibuang;
    batchMaster.totalModal += r.totalKerugian;

    // 4. Cross-Shift Validation Shield
    let waktuMulai = siklusAktif.waktuStart || 0;
    let timestampPenyusutan = 0;
    if (r.idPenyusutan && r.idPenyusutan.startsWith('SHR-')) {
        let part = r.idPenyusutan.substring(4);
        timestampPenyusutan = parseInt(part.substring(0, 13));
    }

    if (timestampPenyusutan >= waktuMulai || r.tanggal >= siklusAktif.tanggalStart) {
        siklusAktif.qtyDihapus -= r.qtyDibuang;
        if(siklusAktif.qtyDihapus < 0) siklusAktif.qtyDihapus = 0;
        siklusAktif.modalDihapus -= r.totalKerugian;
        if(siklusAktif.modalDihapus < 0) siklusAktif.modalDihapus = 0;
    }

    // Final Step
    historiPenyusutan = historiPenyusutan.filter(h => h.idPenyusutan !== idPenyusutan);

    saveApotekDB('apotek_master', masterItems);
    saveApotekDB('apotek_siklus', siklusAktif);
    saveApotekDB('apotek_penyusutan', historiPenyusutan);

    renderBukuRusakMobile();
    renderGudangMobile(document.getElementById('cariGudangMobile') ? document.getElementById('cariGudangMobile').value : '');
    renderBerandaMobile();
}

// CUSTOM MODAL ENGINE
function _customModalBase(type, message, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalCustomEngine');
        const backdrop = document.getElementById('backdropCustomEngine');
        const panel = document.getElementById('panelCustomEngine');
        const title = document.getElementById('titleCustomEngine');
        const msg = document.getElementById('messageCustomEngine');
        const inputWrap = document.getElementById('inputWrapperCustomEngine');
        const input = document.getElementById('inputCustomEngine');
        const btnCancel = document.getElementById('btnCancelCustomEngine');
        const btnConfirm = document.getElementById('btnConfirmCustomEngine');

        title.innerHTML = type === 'prompt' ? '<i class="fa-solid fa-pen-to-square text-blue-500"></i> Input Data' : '<i class="fa-solid fa-circle-question text-amber-500"></i> Konfirmasi';
        msg.innerHTML = message.replace(/\n/g, '<br>');

        if (type === 'prompt') {
            inputWrap.classList.remove('hidden');
            input.value = defaultValue;
            input.focus();
            setTimeout(() => input.focus(), 100);
        } else {
            inputWrap.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            panel.classList.remove('scale-90');
        }, 10);

        const close = (result) => {
            modal.classList.add('opacity-0');
            panel.classList.add('scale-90');
            setTimeout(() => {
                modal.classList.add('hidden');
                document.body.classList.remove('overflow-hidden');
                resolve(result);
            }, 300);
        };

        const onCancel = () => close(null);
        const onConfirm = () => close(type === 'prompt' ? input.value : true);
        const onBackdrop = () => close(null);
        const onKeydown = (e) => {
            if (e.key === 'Enter' && type === 'prompt') onConfirm();
            if (e.key === 'Escape') onCancel();
        };

        btnCancel.onclick = onCancel;
        btnConfirm.onclick = onConfirm;
        backdrop.onclick = onBackdrop;
        input.onkeydown = onKeydown;
    });
}

async function customPrompt(message, defaultValue) {
    let result = await _customModalBase('prompt', message, defaultValue);
    return result;
}

async function customConfirm(message) {
    let result = await _customModalBase('confirm', message);
    return result === true;
}


async function ubahQtyPenyusutanPrompt(idBatch, max, current) {
    let inputQty = await customPrompt(`Masukkan jumlah yang ingin dimusnahkan (Maks: ${max}):`, current);
    if (inputQty !== null) {
        let val = parseInt(inputQty);
        if (!isNaN(val) && val >= 0 && val <= max) {
            let delta = val - current;
            ubahQtyPenyusutan(idBatch, delta, max);
        } else {
            alert("Jumlah tidak valid atau melebihi stok fisik.");
        }
    }
}
// ==========================================
// MESIN UBAH SANDI MANDIRI (SUPABASE AUTH)
// ==========================================
function bukaModalUbahSandi() {
    document.getElementById('inputSandiBaru').value = '';
    document.getElementById('inputKonfirmasiSandi').value = '';
    bukaModalMobile('modalUbahSandi', 'panelUbahSandi');
}

async function prosesGantiSandiSupabase() {
    const sandiBaru = document.getElementById('inputSandiBaru').value;
    const konfirmasiSandi = document.getElementById('inputKonfirmasiSandi').value;

    if (!sandiBaru || !konfirmasiSandi) {
        return alert("⚠️ Kolom sandi baru wajib diisi!");
    }

    if (sandiBaru.length < 6) {
        return alert("⚠️ Keamanan Supabase: Kata sandi minimal harus 6 karakter.");
    }

    if (sandiBaru !== konfirmasiSandi) {
        return alert("⚠️ Konfirmasi sandi tidak cocok. Silakan periksa kembali.");
    }

    if (!supabaseClient) {
        return alert("⚠️ Koneksi ke server cloud Supabase sedang terganggu.");
    }

    try {
        // Perintah resmi Supabase untuk mengubah password user yang sedang aktif login
        const { data, error } = await supabaseClient.auth.updateUser({
            password: sandiBaru
        });

        if (error) throw error;

        alert("✅ Berhasil! Kata sandi akun Anda telah diperbarui secara permanen di server.");
        tutupModalMobile('modalUbahSandi');

    } catch (error) {
        alert("❌ Gagal memperbarui sandi: " + error.message);
    }
}
// ==========================================
// SENSOR PEMBERSIH UNIVERSAL (KLIK DI LUAR POP-UP)
// ==========================================
document.addEventListener('pointerdown', function(e) {
    // 1. Sapu Bersih Pop-up Filter Laporan
    let pLaporan = document.getElementById('panelFilterLaporan');
    let bLaporan = document.getElementById('teksFilterLaporanUi')?.parentElement;
    if (pLaporan && !pLaporan.classList.contains('hidden') && !pLaporan.contains(e.target) && (!bLaporan || !bLaporan.contains(e.target))) {
        toggleDropdownFilterLaporan();
    }
    
    // 2. Sapu Bersih Pop-up Filter Riwayat
    let pRiwayat = document.getElementById('panelFilterRiwayat');
    let bRiwayat = document.getElementById('teksFilterRiwayatUi')?.parentElement;
    if (pRiwayat && !pRiwayat.classList.contains('hidden') && !pRiwayat.contains(e.target) && (!bRiwayat || !bRiwayat.contains(e.target))) {
        toggleDropdownFilterRiwayat();
    }
    
    // 3. Sapu Bersih Pop-up Filter Trafik / Radar
    let pTrafik = document.getElementById('panelFilterTrafik');
    let bTrafik = document.getElementById('teksFilterTrafikUi')?.parentElement;
    if (pTrafik && !pTrafik.classList.contains('hidden') && !pTrafik.contains(e.target) && (!bTrafik || !bTrafik.contains(e.target))) {
        toggleDropdownTrafik();
    }
    
    // 4. Sapu Bersih Dropdown Mesin Kasir
    let pKasir = document.getElementById('dropdownKasirList');
    let bKasir = pKasir ? pKasir.previousElementSibling : null;
    if (pKasir && !pKasir.classList.contains('hidden') && !pKasir.contains(e.target) && (!bKasir || !bKasir.contains(e.target))) {
        pKasir.classList.add('hidden');
    }

    // 5. Sapu Bersih Semua Custom Dropdown Form (Kategori, Satuan)
    document.querySelectorAll('.custom-dropdown-menu').forEach(menu => {
        if (!menu.classList.contains('hidden')) {
            let btn = menu.previousElementSibling;
            if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
                menu.classList.add('hidden');
                let icon = btn ? btn.querySelector('.custom-dropdown-icon') : null;
                if (icon) icon.style.transform = 'rotate(0deg)';
            }
        }
    });
});