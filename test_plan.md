1. **TASK 1: Revamp "Obat Terlaris" (Top Selling) UI**
   - In `app.js` (inside `renderObatTerlaris`), modify the inner HTML structure to reduce font sizes (`text-sm`, `text-xs`) and vertical padding (`py-2`, `py-3` instead of larger margins) to create a compact design.
   - In `index.html` (or `app.js` if it's dynamically rendered), move the "Cek Radar ➔" button from its floating position to just below the "Obat Terlaris" title.
   - Style the button as requested (`bg-blue-50 text-blue-700 px-6 py-2 rounded-full font-bold text-sm shadow-sm active:scale-95 transition-all`).

2. **TASK 2: Global Custom Modal Engine (Replacing Native Prompts)**
   - Create custom `async function customPrompt(message, defaultValue)` and `async function customConfirm(message)` functions in `app.js`.
   - The UI for these modals will be injected into `index.html` or built dynamically in `app.js`, ensuring they match the Tailwind Neumorphism aesthetic (`bg-white rounded-2xl shadow-2xl p-6 w-11/12 max-w-sm mx-auto`).
   - Find and replace `prompt` and `confirm` calls ONLY in these specific locations:
     - Edit Kas Keluar (Replacing `prompt` for editing nominal in `app.js` line ~4854).
     - Buku Piutang (Replacing `prompt` for inputting installment/pelunasan in `app.js` line ~1753).
     - Penyusutan (Replacing `prompt` for inputting damaged quantity).
     - Batal Transaksi (Replacing `confirm` in `prosesBatalTransaksiMobile`). Note that it currently uses `tampilkanConfirmMobile`, need to check if we can reuse or just build a Promise-based one.
     - Tutup Buku (Replacing `confirm`). Note: Wait, `tampilkanConfirmMobile` already exists and takes a callback. I will build `customPrompt` and `customConfirm` that wrap these or create new Promise-based modals to fully comply with the async/await requirement.

3. **TASK 3: Overlay, Body Lock, and Click-to-Close (Fixing Floating Menus)**
   - In `index.html`, add a dark backdrop (`#backdropFilterRiwayat`) right before `#panelFilterRiwayat`.
   - Update `toggleDropdownFilterRiwayat` in `app.js` to toggle this backdrop, toggle body `overflow-hidden`, and setup click-to-close on the backdrop itself.
   - Also ensure this applies to the custom modals from Task 2 (they should also have body lock and click-to-close behavior where applicable, but the prompt says "The Filter menu in the 'Riwayat' tab (and ensure it applies to the new custom modals from Task 2)"). So I'll build a standard backdrop toggle function or just handle it directly.

4. **Pre-commit Steps**
   - Run tests/linters, verify changes, and ensure proper testing, verification, review, and reflection are done.

5. **Submit**
