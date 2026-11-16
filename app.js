    // Isi URL dan anon key dari Supabase Project Settings > API.
    const SUPABASE_URL = "GANTI_DENGAN_SUPABASE_URL";
    const SUPABASE_ANON_KEY = "GANTI_DENGAN_SUPABASE_ANON_KEY";
    const STORAGE_KEY = "feno-berjaya-inventory-v1";
    const THEME_STORAGE_KEY = "feno-berjaya-theme";
    const PRODUCT_IMAGE_BUCKET = "product-images";
    const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("GANTI_") && !SUPABASE_ANON_KEY.includes("GANTI_");
    const supabaseClient = configured && window.supabase
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;
    const state = { items: [], movements: [], officeAssets: [], page: "overview", user: null, demo: !supabaseClient, authMode: "login", query: "", busy: false, pdfActions: null };
    const pageDetails = {
      overview: ["Ringkasan Stok", "Pantau persediaan material dan produk Anda."],
      materials: ["Stok Material", "Kelola bahan baku dan material produksi."],
      products: ["Stok Produk", "Kelola persediaan produk jadi."],
      office: ["Alat Inventaris Kantor", "Catat lokasi dan kondisi perlengkapan kantor."],
      movements: ["Riwayat Stok", "Telusuri seluruh transaksi masuk dan keluar."]
    };
    const officeAssetConditionLabels = { good: "Baik", repair: "Perlu perbaikan", damaged: "Rusak" };

    const $ = (selector, root = document) => root.querySelector(selector);
    function applyTheme(theme) {
      const isDark = theme === "dark";
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      const toggle = $("#themeToggle");
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.setAttribute("aria-label", isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap");
      toggle.innerHTML = `<svg aria-hidden="true"><use href="#i-${isDark ? "sun" : "moon"}"/></svg><span>Mode ${isDark ? "terang" : "gelap"}</span>`;
      $('meta[name="theme-color"]').content = isDark ? "#101827" : "#f5f7fb";
    }

    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      applyTheme(savedTheme === "dark" ? "dark" : "light");
    } catch (error) {
      console.error("Preferensi tema tidak dapat dibaca:", error);
      applyTheme("light");
    }

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const formatNumber = (value) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(value) || 0);
    const formatDate = (value, withTime = false) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return new Intl.DateTimeFormat("id-ID", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
    };
    const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
    const itemCategory = (category) => category === "material" ? "Material" : "Produk";
    const itemStatus = (item) => Number(item.quantity) <= 0 ? ["Habis", "stock-empty"] : ["Tersedia", "stock-ok"];
    const itemInitials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const productImageUrl = (item) => {
      if (!item.image_path) return "";
      if (item.image_path.startsWith("data:") || item.image_path.startsWith("https://")) return item.image_path;
      return supabaseClient?.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(item.image_path).data.publicUrl || "";
    };

    function showToast(message, type = "success") {
      const root = $("#toastRoot");
      root.innerHTML = `<div class="toast ${type === "error" ? "error" : ""}">${escapeHtml(message)}</div>`;
      window.setTimeout(() => { root.innerHTML = ""; }, 3400);
    }

    function setBusy(busy) {
      state.busy = busy;
      document.body.style.cursor = busy ? "wait" : "";
    }

    function readLocalData() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"items":[],"movements":[],"officeAssets":[]}');
        state.items = Array.isArray(saved.items) ? saved.items : [];
        state.movements = Array.isArray(saved.movements) ? saved.movements : [];
        state.officeAssets = Array.isArray(saved.officeAssets) ? saved.officeAssets : [];
      } catch (error) {
        console.error("Gagal membaca data lokal:", error);
        state.items = [];
        state.movements = [];
        state.officeAssets = [];
        showToast("Data lokal tidak dapat dibaca. Penyimpanan browser mungkin rusak.", "error");
      }
    }

    function saveLocalData() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, movements: state.movements, officeAssets: state.officeAssets }));
      } catch (error) {
        console.error("Gagal menyimpan data lokal:", error);
        throw new Error("Penyimpanan browser gagal. Periksa ruang penyimpanan yang tersedia.");
      }
    }

    async function loadData() {
      if (!supabaseClient) {
        readLocalData();
        return;
      }
      const [
        { data: items, error: itemError },
        { data: movements, error: movementError },
        { data: officeAssets, error: officeAssetsError }
      ] = await Promise.all([
        supabaseClient.from("inventory_items").select("*").order("name"),
        supabaseClient.from("stock_movements").select("*, inventory_items(name, sku, unit, category)").order("created_at", { ascending: false }).limit(100),
        supabaseClient.from("office_assets").select("*").order("name")
      ]);
      if (itemError) throw itemError;
      if (movementError) throw movementError;
      if (officeAssetsError) throw officeAssetsError;
      state.items = items || [];
      state.movements = movements || [];
      state.officeAssets = officeAssets || [];
    }

    function render() {
      const [title, description] = pageDetails[state.page];
      $("#pageTitle").textContent = title;
      $("#pageDescription").textContent = description;
      $("#breadcrumbCurrent").textContent = title;
      $("#primaryAction").classList.toggle("hidden", state.page === "movements");
      $("#inventoryReport").classList.toggle("hidden", state.page === "movements");
      $("#primaryAction span").textContent = state.page === "office" ? "Tambah Alat" : state.page === "overview" ? "Tambah Barang" : state.page === "materials" ? "Tambah Material" : "Tambah Produk";
      document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.page === state.page));
      $("#pageContent").innerHTML = state.page === "overview" ? renderOverview() :
        state.page === "materials" ? renderInventory("material") :
        state.page === "products" ? renderInventory("product") :
        state.page === "office" ? renderOfficeAssets() : renderMovementsPage();
      $("#currentDate").textContent = new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(new Date());
      $("#userName").textContent = state.user?.email?.split("@")[0] || "Pengguna";
      $("#userAvatar").textContent = (state.user?.email?.[0] || "F").toUpperCase();
      $("#userMode").textContent = state.demo ? "Mode lokal" : "Supabase aktif";
      $("#connectionText").textContent = state.demo ? "Data di perangkat ini" : "Supabase terhubung";
      $("#connectionPill").style.color = state.demo ? "#9a680e" : "#526179";
      $(".status-dot", $("#connectionPill")).style.background = state.demo ? "#e5a331" : "#28a879";
    }

    function renderEmpty(message) {
      return `<div class="empty-state"><div class="empty-icon">${icon("box")}</div>${escapeHtml(message)}</div>`;
    }

    function renderRecentMovements(limit = 6) {
      const movements = state.movements.slice(0, limit);
      if (!movements.length) return renderEmpty("Belum ada transaksi stok.");
      return `<div class="movement-list">${movements.map((movement) => {
        const inbound = movement.movement_type === "in";
        const name = movement.inventory_items?.name || state.items.find((item) => item.id === movement.item_id)?.name || "Barang";
        const unit = movement.inventory_items?.unit || state.items.find((item) => item.id === movement.item_id)?.unit || "";
        return `<div class="movement-row">
          <div class="movement-icon ${inbound ? "in" : "out"}">${inbound ? "+" : "−"}</div>
          <div class="movement-info"><div class="movement-name">${escapeHtml(name)}</div><div class="movement-detail">${inbound ? "Stok masuk" : "Stok keluar"} · ${escapeHtml(formatDate(movement.created_at, true))}</div></div>
          <div class="movement-amount ${inbound ? "in" : "out"}">${inbound ? "+" : "−"}${escapeHtml(formatNumber(movement.quantity))} ${escapeHtml(unit)}</div>
        </div>`;
      }).join("")}</div>`;
    }

    function renderInventoryRows(items) {
      if (!items.length) return `<tr><td colspan="6">${renderEmpty("Belum ada barang. Gunakan tombol tambah untuk mulai mencatat stok.")}</td></tr>`;
      return items.map((item) => {
        const [status, statusClass] = itemStatus(item);
        const photoUrl = productImageUrl(item);
        const photo = photoUrl
          ? `<img class="product-photo" src="${escapeHtml(photoUrl)}" alt="Foto ${escapeHtml(item.name)}" loading="lazy"><div class="item-mark ${item.category === "product" ? "product" : ""} product-fallback hidden">${escapeHtml(itemInitials(item.name))}</div>`
          : `<div class="item-mark ${item.category === "product" ? "product" : ""} product-fallback">${escapeHtml(itemInitials(item.name))}</div>`;
        return `<tr>
          <td><div class="item-cell">${photo}<div><div class="item-primary">${escapeHtml(item.name)}</div><div class="item-secondary">${escapeHtml(item.sku || "Tanpa kode")}</div></div></div></td>
          <td><span class="category-chip">${escapeHtml(itemCategory(item.category))}</span></td>
          <td><strong>${escapeHtml(formatNumber(item.quantity))}</strong> ${escapeHtml(item.unit)}</td>
          <td><span class="stock-badge ${statusClass}">${status}</span></td>
          <td>${escapeHtml(item.location || "-")}</td>
          <td><div class="table-actions">
            <button class="button button-secondary button-small" data-action="stock-in" data-id="${escapeHtml(item.id)}" title="Tambah stok untuk ${escapeHtml(item.name)}">${icon("plus")}<span>Tambah Stok</span></button>
            <button class="icon-button" data-action="edit" data-id="${escapeHtml(item.id)}" title="Edit barang" aria-label="Edit barang">${icon("edit")}</button>
            <button class="icon-button" data-action="movement" data-id="${escapeHtml(item.id)}" title="Catat transaksi" aria-label="Catat transaksi">${icon("arrows")}</button>
            <button class="icon-button" data-action="delete" data-id="${escapeHtml(item.id)}" title="Hapus barang" aria-label="Hapus barang">${icon("trash")}</button>
          </div></td>
        </tr>`;
      }).join("");
    }

    function renderOverview() {
      const materialItems = state.items.filter((item) => item.category === "material");
      const productItems = state.items.filter((item) => item.category === "product");
      const emptyItems = state.items.filter((item) => Number(item.quantity) <= 0);
      return `<div class="stats-grid">
        <article class="stat-card"><div class="stat-top"><span>Total jenis barang</span><span class="stat-icon">${icon("box")}</span></div><div class="stat-value">${formatNumber(state.items.length)}</div><div class="stat-foot">Material dan produk terdaftar</div></article>
        <article class="stat-card"><div class="stat-top"><span>Barang tersedia</span><span class="stat-icon green">${icon("cube")}</span></div><div class="stat-value">${formatNumber(state.items.filter((item) => Number(item.quantity) > 0).length)}</div><div class="stat-foot">${formatNumber(materialItems.length)} material · ${formatNumber(productItems.length)} produk</div></article>
        <article class="stat-card"><div class="stat-top"><span>Stok habis</span><span class="stat-icon red">${icon("alert")}</span></div><div class="stat-value">${formatNumber(emptyItems.length)}</div><div class="stat-foot">Barang dengan jumlah stok nol</div></article>
        <article class="stat-card"><div class="stat-top"><span>Transaksi tercatat</span><span class="stat-icon red">${icon("arrows")}</span></div><div class="stat-value">${formatNumber(state.movements.length)}</div><div class="stat-foot">Menampilkan riwayat terbaru</div></article>
      </div>
      <div class="quick-actions" aria-label="Aksi cepat produk">
        <button class="quick-action" data-shortcut="add-product"><span class="quick-action-icon">${icon("plus")}</span><span class="quick-action-copy"><span class="quick-action-title">Tambah Produk</span><span class="quick-action-description">Daftarkan produk baru dan masukkan stok awal.</span></span><span class="quick-action-arrow" aria-hidden="true">›</span></button>
        <button class="quick-action" data-shortcut="reduce-product"><span class="quick-action-icon out">${icon("arrows")}</span><span class="quick-action-copy"><span class="quick-action-title">Pengurangan Produk</span><span class="quick-action-description">Catat produk keluar dari persediaan.</span></span><span class="quick-action-arrow" aria-hidden="true">›</span></button>
      </div>
      ${renderStockChart()}`;
    }

    function renderStockChart() {
      if (!state.items.length) {
        return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Grafik stok per barang</div><div class="panel-subtitle">Perbandingan persediaan material dan produk</div></div></div>${renderEmpty("Tambahkan material atau produk untuk melihat grafik stok.")}</section>`;
      }
      const maxQuantity = Math.max(...state.items.map((item) => Number(item.quantity) || 0));
      const sortedItems = [...state.items].sort((a, b) => Number(b.quantity) - Number(a.quantity) || a.name.localeCompare(b.name, "id"));
      return `<section class="panel">
        <div class="panel-header">
          <div><div class="panel-title">Grafik stok per barang</div><div class="panel-subtitle">Perbandingan persediaan untuk ${formatNumber(sortedItems.length)} barang</div></div>
          <div class="stock-chart-legend" aria-label="Kategori grafik">
            <span class="stock-chart-legend-item"><span class="stock-chart-legend-dot"></span>Material</span>
            <span class="stock-chart-legend-item"><span class="stock-chart-legend-dot product"></span>Produk</span>
          </div>
        </div>
        <div class="stock-chart"><div class="stock-chart-list">${sortedItems.map((item) => {
          const quantity = Number(item.quantity) || 0;
          const percentage = maxQuantity > 0 ? quantity / maxQuantity * 100 : 0;
          const category = item.category === "product" ? "product" : "material";
          return `<div class="stock-chart-row" aria-label="${escapeHtml(item.name)}: ${escapeHtml(formatNumber(quantity))} ${escapeHtml(item.unit)}">
            <div class="stock-chart-name" title="${escapeHtml(item.name)}"><span>${itemCategory(item.category)}</span>${escapeHtml(item.name)}</div>
            <div class="stock-chart-value"><div class="stock-chart-track"><div class="stock-chart-bar ${category}" role="progressbar" aria-label="Stok ${escapeHtml(item.name)}" aria-valuemin="0" aria-valuemax="${escapeHtml(maxQuantity)}" aria-valuenow="${escapeHtml(quantity)}" style="width:${percentage}%"></div></div><strong>${escapeHtml(formatNumber(quantity))} ${escapeHtml(item.unit)}</strong></div>
          </div>`;
        }).join("")}</div></div>
      </section>`;
    }

    function renderInventory(category) {
      const filtered = state.items.filter((item) => item.category === category && `${item.name} ${item.sku || ""} ${item.location || ""}`.toLowerCase().includes(state.query.toLowerCase()));
      return `<section class="panel">
        <div class="toolbar">
          <label class="search-box">${icon("search")}<input class="field-control" id="inventorySearch" type="search" value="${escapeHtml(state.query)}" placeholder="Cari nama barang, kode, lokasi..." aria-label="Cari inventaris"></label>
          <span class="toolbar-count">${formatNumber(filtered.length)} barang</span>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nama barang</th><th>Kategori</th><th>Stok saat ini</th><th>Status</th><th>Lokasi</th><th style="text-align:right">Aksi</th></tr></thead><tbody>${renderInventoryRows(filtered)}</tbody></table></div>
        <div class="pagination-note">Data inventaris ${state.demo ? "tersimpan di browser ini" : "tersinkron dengan Supabase"}.</div>
      </section>`;
    }

    function renderOfficeAssets() {
      const assets = state.officeAssets.filter((asset) =>
        `${asset.name} ${asset.asset_code || ""} ${asset.category || ""} ${asset.location || ""} ${officeAssetConditionLabels[asset.condition] || ""} ${asset.notes || ""}`
          .toLowerCase()
          .includes(state.query.toLowerCase())
      );
      const rows = assets.length ? assets.map((asset) => {
        const conditionClass = asset.condition === "good" ? "stock-ok" : asset.condition === "repair" ? "stock-warning" : "stock-empty";
        return `<tr>
          <td><div class="item-primary">${escapeHtml(asset.name)}</div><div class="item-secondary">${escapeHtml(asset.asset_code || "Tanpa kode")}</div>${asset.notes ? `<div class="item-secondary">${escapeHtml(asset.notes)}</div>` : ""}</td>
          <td><span class="category-chip">${escapeHtml(asset.category)}</span></td>
          <td><strong>${escapeHtml(formatNumber(asset.quantity ?? 1))}</strong> unit</td>
          <td><span class="stock-badge ${conditionClass}">${escapeHtml(officeAssetConditionLabels[asset.condition] || "Tidak diketahui")}</span></td>
          <td>${escapeHtml(asset.location || "-")}</td>
          <td><div class="table-actions"><button class="icon-button" data-office-asset-action="edit" data-id="${escapeHtml(asset.id)}" title="Edit alat" aria-label="Edit ${escapeHtml(asset.name)}">${icon("edit")}</button><button class="icon-button" data-office-asset-action="delete" data-id="${escapeHtml(asset.id)}" title="Hapus alat" aria-label="Hapus ${escapeHtml(asset.name)}">${icon("trash")}</button></div></td>
        </tr>`;
      }).join("") : `<tr><td colspan="6">${renderEmpty(state.query ? "Alat inventaris tidak ditemukan." : "Belum ada alat inventaris. Gunakan tombol tambah untuk mulai mencatat.")}</td></tr>`;
      return `<section class="panel">
        <div class="toolbar">
          <label class="search-box">${icon("search")}<input class="field-control" id="officeAssetSearch" type="search" value="${escapeHtml(state.query)}" placeholder="Cari nama alat, kode, lokasi..." aria-label="Cari alat inventaris kantor"></label>
          <span class="toolbar-count">${formatNumber(assets.length)} alat</span>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nama alat / kode</th><th>Kategori</th><th>Jumlah</th><th>Kondisi barang</th><th>Lokasi</th><th style="text-align:right">Aksi</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="pagination-note">Data inventaris ${state.demo ? "tersimpan di browser ini" : "tersinkron dengan Supabase"}.</div>
      </section>`;
    }

    function openOfficeAssetModal(asset = null) {
      const editing = Boolean(asset);
      $("#modalRoot").innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="officeAssetModalTitle">
        <div class="modal-head"><div><h2 id="officeAssetModalTitle">${editing ? "Edit alat inventaris" : "Tambah alat inventaris"}</h2><p>Catat identitas, lokasi, dan kondisi alat kantor.</p></div><button class="icon-button" data-close-modal aria-label="Tutup">×</button></div>
        <form id="officeAssetForm" class="modal-body">
          <div class="form-grid">
            <div class="form-field full"><label for="officeAssetName">Nama alat *</label><input id="officeAssetName" name="name" required maxlength="120" value="${escapeHtml(asset?.name || "")}" placeholder="Contoh: Laptop Administrasi"></div>
            <div class="form-field"><label for="officeAssetCategory">Kategori *</label><select id="officeAssetCategory" name="category" required><option value="Elektronik" ${asset?.category === "Elektronik" ? "selected" : ""}>Elektronik</option><option value="Furniture" ${asset?.category === "Furniture" ? "selected" : ""}>Furniture</option><option value="Perlengkapan" ${asset?.category === "Perlengkapan" ? "selected" : ""}>Perlengkapan</option><option value="Lainnya" ${asset?.category === "Lainnya" ? "selected" : ""}>Lainnya</option></select></div>
            <div class="form-field"><label for="officeAssetCode">Kode inventaris</label><input id="officeAssetCode" name="asset_code" maxlength="60" value="${escapeHtml(asset?.asset_code || "")}" placeholder="Contoh: INV-001"></div>
            <div class="form-field"><label for="officeAssetQuantity">Jumlah *</label><input id="officeAssetQuantity" name="quantity" type="number" min="1" step="1" required value="${escapeHtml(asset?.quantity ?? 1)}"></div>
            <div class="form-field"><label for="officeAssetLocation">Lokasi</label><input id="officeAssetLocation" name="location" maxlength="100" value="${escapeHtml(asset?.location || "")}" placeholder="Contoh: Ruang Administrasi"></div>
            <div class="form-field"><label for="officeAssetCondition">Kondisi barang *</label><select id="officeAssetCondition" name="condition" required><option value="good" ${!asset || asset.condition === "good" ? "selected" : ""}>Baik</option><option value="repair" ${asset?.condition === "repair" ? "selected" : ""}>Perlu perbaikan</option><option value="damaged" ${asset?.condition === "damaged" ? "selected" : ""}>Rusak</option></select></div>
            <div class="form-field full"><label for="officeAssetNotes">Catatan</label><textarea id="officeAssetNotes" name="notes" maxlength="500" placeholder="Catatan tambahan (opsional)">${escapeHtml(asset?.notes || "")}</textarea></div>
          </div>
          <div class="modal-actions"><button type="button" class="button button-secondary" data-close-modal>Batal</button><button type="submit" class="button button-primary">${editing ? "Simpan perubahan" : "Simpan alat"}</button></div>
        </form></section></div>`;
      $("#officeAssetName").focus();
      $("#officeAssetForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.busy) return;
        const formData = new FormData(event.currentTarget);
        const data = Object.fromEntries(formData.entries());
        data.name = data.name.trim();
        data.asset_code = data.asset_code.trim();
        data.location = data.location.trim();
        data.notes = data.notes.trim();
        data.quantity = Number(data.quantity);
        if (!data.name || !Number.isInteger(data.quantity) || data.quantity < 1) {
          showToast("Periksa kembali nama dan jumlah alat.", "error");
          return;
        }
        try {
          setBusy(true);
          if (supabaseClient) {
            const payload = { ...data, owner_id: state.user.id, updated_at: new Date().toISOString() };
            const { error } = editing
              ? await supabaseClient.from("office_assets").update(payload).eq("id", asset.id)
              : await supabaseClient.from("office_assets").insert(payload);
            if (error) throw error;
          } else if (editing) {
            state.officeAssets = state.officeAssets.map((entry) => entry.id === asset.id ? { ...entry, ...data, updated_at: new Date().toISOString() } : entry);
            saveLocalData();
          } else {
            state.officeAssets.push({ ...data, id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            saveLocalData();
          }
          await loadData();
          $("#modalRoot").innerHTML = "";
          render();
          showToast(editing ? "Data alat berhasil diperbarui." : "Alat berhasil ditambahkan.");
        } catch (error) {
          console.error("Gagal menyimpan alat inventaris:", error);
          showToast(error.message || "Alat inventaris gagal disimpan.", "error");
        } finally { setBusy(false); }
      });
    }

    async function deleteOfficeAsset(asset) {
      if (!window.confirm(`Hapus alat "${asset.name}" dari inventaris kantor?`)) return;
      try {
        setBusy(true);
        if (supabaseClient) {
          const { error } = await supabaseClient.from("office_assets").delete().eq("id", asset.id);
          if (error) throw error;
        } else {
          state.officeAssets = state.officeAssets.filter((entry) => entry.id !== asset.id);
          saveLocalData();
        }
        await loadData();
        render();
        showToast("Alat inventaris berhasil dihapus.");
      } catch (error) {
        console.error("Gagal menghapus alat inventaris:", error);
        showToast(error.message || "Alat inventaris gagal dihapus.", "error");
      } finally { setBusy(false); }
    }

    async function loadReportStockTotals(items) {
      let movements = state.movements;
      if (supabaseClient) {
        const pageSize = 500;
        const firstPage = await supabaseClient.from("stock_movements")
          .select("id, item_id, movement_type, quantity, created_at", { count: "exact" })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(0, pageSize - 1);
        if (firstPage.error) throw firstPage.error;
        const totalCount = firstPage.count;
        if (totalCount === null) throw new Error("Jumlah riwayat stok tidak dapat dipastikan untuk laporan.");
        movements = firstPage.data || [];
        for (let offset = pageSize; offset < totalCount; offset += pageSize) {
          const page = await supabaseClient.from("stock_movements")
            .select("id, item_id, movement_type, quantity, created_at")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, Math.min(offset + pageSize - 1, totalCount - 1));
          if (page.error) throw page.error;
          movements = movements.concat(page.data || []);
        }
        if (movements.length !== totalCount) throw new Error("Riwayat stok tidak lengkap. Silakan coba buat laporan kembali.");
      }

      const itemIds = new Set(items.map((item) => item.id));
      const totals = new Map();
      movements.forEach((movement) => {
        if (!itemIds.has(movement.item_id)) return;
        const itemTotal = totals.get(movement.item_id) || { openingStock: null, openingStockAt: null, outbound: 0 };
        const quantity = Number(movement.quantity) || 0;
        if (movement.movement_type === "in") {
          const movementTime = new Date(movement.created_at).getTime();
          const currentTime = itemTotal.openingStockAt;
          if (itemTotal.openingStock === null || (Number.isFinite(movementTime) && (!Number.isFinite(currentTime) || movementTime < currentTime))) {
            itemTotal.openingStock = quantity;
            itemTotal.openingStockAt = movementTime;
          }
        }
        if (movement.movement_type === "out") itemTotal.outbound += quantity;
        totals.set(movement.item_id, itemTotal);
      });
      return totals;
    }

    function showPdfActions(preview, download) {
      state.pdfActions = { preview, download };
      $("#modalRoot").innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="pdfActionTitle">
        <div class="modal-head"><div><h2 id="pdfActionTitle">Laporan PDF</h2><p>Pilih pratinjau laporan atau simpan sebagai PDF.</p></div><button class="icon-button" data-close-modal aria-label="Tutup">×</button></div>
        <div class="modal-body"><div class="modal-actions" style="margin-top:0"><button class="button button-secondary" type="button" data-pdf-action="preview">${icon("search")} Pratinjau</button><button class="button button-primary" type="button" data-pdf-action="download">${icon("download")} Unduh PDF</button></div></div>
      </section></div>`;
    }

    async function previewInventoryReport() {
      const reportWindow = window.open("", "_blank");
      if (!reportWindow) {
        showToast("Jendela laporan diblokir. Izinkan pop-up untuk mencetak laporan.", "error");
        return;
      }
      reportWindow.document.write("<!DOCTYPE html><html lang=\"id\"><meta charset=\"UTF-8\"><title>Menyiapkan laporan</title><body style=\"font:14px Arial,sans-serif;padding:32px;color:#40506a\">Menyiapkan laporan stok...</body></html>");

      try {
      const category = state.page === "materials" ? "material" : state.page === "products" ? "product" : null;
      const categories = category ? [category] : ["material", "product"];
      const items = state.items.filter((item) => !category || item.category === category);
      const stockTotals = await loadReportStockTotals(items);
      const availableStockCount = items.filter((item) => Number(item.quantity) > 0).length;
      const emptyStockCount = items.filter((item) => Number(item.quantity) <= 0).length;
      const generatedAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(new Date());
      const reportTitle = category ? `Laporan Stok ${itemCategory(category)}` : "Laporan Persediaan Barang & Material";
      const logoUrl = escapeHtml(new URL("logo pdf.png", document.baseURI).href);
      const sections = categories.map((itemCategoryKey) => {
        const categoryItems = items
          .filter((item) => item.category === itemCategoryKey)
          .sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
        const rows = categoryItems.length ? categoryItems.map((item) => {
          const [status, statusClass] = itemStatus(item);
          const totals = stockTotals.get(item.id) || { openingStock: null, outbound: 0 };
          return `<tr>
            <td><strong>${escapeHtml(item.name)}</strong><span class="item-code">${escapeHtml(item.sku || "Tanpa kode")}</span></td>
            <td class="number">${escapeHtml(formatNumber(totals.openingStock ?? 0))} ${escapeHtml(item.unit)}</td>
            <td class="number">${escapeHtml(formatNumber(totals.outbound))} ${escapeHtml(item.unit)}</td>
            <td class="number">${escapeHtml(formatNumber(item.quantity))} ${escapeHtml(item.unit)}</td>
            <td><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
            <td>${escapeHtml(item.location || "-")}</td>
          </tr>`;
        }).join("") : `<tr><td class="empty" colspan="6">Belum ada ${itemCategoryKey === "material" ? "material" : "produk"}.</td></tr>`;
        return `<section class="category-section">
          <div class="section-heading"><h2>${itemCategory(itemCategoryKey)}</h2><span>${formatNumber(categoryItems.length)} jenis barang</span></div>
          <table><thead><tr><th>Nama / kode barang</th><th class="number">Stok awal</th><th class="number">Stok keluar</th><th class="number">Stok saat ini</th><th>Status</th><th>Lokasi</th></tr></thead><tbody>${rows}</tbody></table>
        </section>`;
      }).join("");

      const reportHtml = `<!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${escapeHtml(reportTitle)}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; color: #17243b; font: 12px Arial, sans-serif; }
            .report { max-width: 1120px; margin: 0 auto; padding: 32px; }
            .report-header { display: flex; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 2px solid #102a56; }
            .logo { width: 58px; height: 58px; object-fit: contain; }
            .company { margin: 0 0 4px; color: #102a56; font-size: 15px; font-weight: 700; }
            h1 { margin: 0; color: #102a56; font-size: 21px; }
            .generated { margin: 7px 0 0; color: #748197; font-size: 10px; }
            .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 22px; }
            .summary-card { padding: 12px; border: 1px solid #e7ebf2; border-radius: 7px; }
            .summary-label { color: #748197; font-size: 10px; }
            .summary-value { margin-top: 5px; color: #102a56; font-size: 17px; font-weight: 700; }
            .category-section { margin: 20px 0 26px; }
            .section-heading { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
            h2 { margin: 0; color: #102a56; font-size: 14px; }
            .section-heading span { color: #748197; font-size: 10px; }
            table { width: 100%; border-collapse: collapse; }
            th { padding: 9px 7px; background: #f3f6fb; color: #526179; font-size: 8px; text-align: left; text-transform: uppercase; }
            td { padding: 9px 8px; border-bottom: 1px solid #e7ebf2; color: #40506a; vertical-align: top; }
            .number { text-align: right; white-space: nowrap; }
            .item-code { display: block; margin-top: 3px; color: #8490a2; font-size: 10px; }
            .status { font-size: 10px; font-weight: 700; }
            .stock-ok { color: #14825d; }
            .stock-empty { color: #df242c; }
            .empty { padding: 18px 8px; color: #748197; text-align: center; }
            .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e7ebf2; color: #8490a2; font-size: 9px; }
            @page { size: A4 landscape; margin: 14mm; }
            @media print {
              .report { max-width: none; padding: 0; }
              thead { display: table-header-group; }
              tr, .summary-card { break-inside: avoid; }
              .category-section { break-inside: auto; }
            }
          </style>
        </head>
        <body>
          <main class="report">
            <header class="report-header">
              <img class="logo" src="${logoUrl}" alt="Logo Feno Berjaya">
              <div><p class="company">FENO BERJAYA</p><h1>${escapeHtml(reportTitle)}</h1><p class="generated">Dibuat pada ${escapeHtml(generatedAt)} · Seluruh data dalam cakupan laporan</p></div>
            </header>
            <section class="summary" aria-label="Ringkasan stok">
              <div class="summary-card"><div class="summary-label">Total jenis barang</div><div class="summary-value">${formatNumber(items.length)}</div></div>
              <div class="summary-card"><div class="summary-label">Barang tersedia</div><div class="summary-value">${formatNumber(availableStockCount)}</div></div>
              <div class="summary-card"><div class="summary-label">Stok habis</div><div class="summary-value">${formatNumber(emptyStockCount)}</div></div>
            </section>
            ${sections}
            <footer class="footer">Dokumen dibuat otomatis oleh Sistem Inventaris Feno Berjaya.</footer>
          </main>
        </body>
        </html>`;
      reportWindow.document.open();
      reportWindow.document.write(reportHtml);
      reportWindow.document.close();
      } catch (error) {
        console.error("Gagal menyiapkan pratinjau laporan:", error);
        reportWindow.close();
        showToast(error.message || "Pratinjau laporan gagal disiapkan.", "error");
      }
    }

    function getPdfLogoDataUrl() {
      const logo = $(".brand img");
      if (!logo?.complete || !logo.naturalWidth) throw new Error("Logo laporan belum siap. Muat ulang halaman lalu coba kembali.");
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 192;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Logo laporan tidak dapat diproses oleh browser.");
      context.drawImage(logo, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    }

    function drawPdfHeader(doc, logoDataUrl, description) {
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.addImage(logoDataUrl, "PNG", 14, 6, 25, 25);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(16, 42, 86);
      doc.text("LAPORAN FB WORKSHOP", 49, 15);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(45, 70, 105);
      doc.text(description, 49, 23);
      doc.setFontSize(9);
      doc.text(`Dicetak ${formatDate(new Date())}`, pageWidth - 14, 23, { align: "right" });
      doc.setDrawColor(16, 42, 86);
      doc.setLineWidth(0.9);
      doc.line(14, 38, pageWidth - 14, 38);
      doc.setDrawColor(232, 153, 34);
      doc.setLineWidth(0.4);
      doc.line(14, 41, pageWidth - 14, 41);
    }

    function createPdfDocument(title, description) {
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) throw new Error("Fitur PDF belum siap. Periksa koneksi internet lalu muat ulang halaman.");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      if (typeof doc.autoTable !== "function") throw new Error("Komponen tabel PDF belum siap. Muat ulang halaman dan coba lagi.");
      const logoDataUrl = getPdfLogoDataUrl();
      doc.setProperties({ title, subject: description, author: "Feno Berjaya" });
      drawPdfHeader(doc, logoDataUrl, description);
      return { doc, logoDataUrl };
    }

    function pdfTableOptions(doc, logoDataUrl, description, startY, headers, rows) {
      return doc.autoTable({
        startY,
        head: [headers],
        body: rows,
        theme: "grid",
        margin: { top: 47, left: 14, right: 14, bottom: 17 },
        styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5, textColor: [55, 65, 81], lineColor: [220, 226, 234], lineWidth: 0.15 },
        headStyles: { fillColor: [239, 244, 251], textColor: [35, 55, 85], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 250, 252] },
        didDrawPage: () => {
          const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
          const pageSize = doc.internal.pageSize;
          if (pageNumber > 1) drawPdfHeader(doc, logoDataUrl, description);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(120, 130, 145);
          doc.text(`Halaman ${pageNumber}`, pageSize.getWidth() - 14, pageSize.getHeight() - 7, { align: "right" });
        }
      });
    }

    async function downloadInventoryPdf() {
      try {
        const category = state.page === "materials" ? "material" : state.page === "products" ? "product" : null;
        const categories = category ? [category] : ["material", "product"];
        const items = state.items.filter((item) => !category || item.category === category);
        const totals = await loadReportStockTotals(items);
        const title = category ? `Laporan Stok ${itemCategory(category)}` : "Laporan Persediaan Barang & Material";
        const description = `Periode posisi stok: ${formatDate(new Date())}`;
        const { doc, logoDataUrl } = createPdfDocument(title, description);
        const availableCount = items.filter((item) => Number(item.quantity) > 0).length;
        const emptyCount = items.length - availableCount;
        doc.setFontSize(9);
        doc.setTextColor(55, 65, 81);
        doc.text(`Total barang: ${formatNumber(items.length)}     Tersedia: ${formatNumber(availableCount)}     Stok habis: ${formatNumber(emptyCount)}`, 14, 51);
        let startY = 59;
        categories.forEach((categoryKey) => {
          const categoryItems = items
            .filter((item) => item.category === categoryKey)
            .sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
          if (startY > 180) {
            doc.addPage();
            startY = 59;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(16, 42, 86);
          doc.text(itemCategory(categoryKey), 14, startY);
          const rows = categoryItems.map((item) => {
            const itemTotals = totals.get(item.id) || { openingStock: null, outbound: 0 };
            const status = Number(item.quantity) <= 0 ? "Habis" : "Tersedia";
            return [
              item.name || "",
              item.sku || "Tanpa kode",
              `${formatNumber(itemTotals.openingStock ?? 0)} ${item.unit || ""}`,
              `${formatNumber(itemTotals.outbound)} ${item.unit || ""}`,
              `${formatNumber(item.quantity)} ${item.unit || ""}`,
              status,
              item.location || "-"
            ];
          });
          pdfTableOptions(doc, logoDataUrl, description, startY + 3, ["Nama barang", "Kode", "Stok awal saja", "Stok keluar", "Stok saat ini", "Status", "Lokasi"], rows.length ? rows : [["Belum ada data", "-", "-", "-", "-", "-", "-"]]);
          startY = doc.lastAutoTable.finalY + 10;
        });
        doc.save(`laporan-persediaan-${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast("Laporan PDF berhasil diunduh.");
      } catch (error) {
        console.error("Gagal mengunduh laporan persediaan PDF:", error);
        showToast(error.message || "Laporan PDF gagal diunduh.", "error");
      }
    }

    function previewOfficeAssetsReport() {
      const reportWindow = window.open("", "_blank");
      if (!reportWindow) {
        showToast("Jendela laporan diblokir. Izinkan pop-up untuk melihat laporan.", "error");
        return;
      }

      try {
        const assets = [...state.officeAssets].sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
        const totalQuantity = assets.reduce((total, asset) => total + (Number(asset.quantity ?? 1) || 0), 0);
        const generatedAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(new Date());
        const logoUrl = escapeHtml(new URL("logo pdf.png", document.baseURI).href);
        const rows = assets.length ? assets.map((asset) => `<tr>
          <td><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.asset_code || "Tanpa kode")}</span></td>
          <td>${escapeHtml(asset.category || "Lainnya")}</td>
          <td>${escapeHtml(formatNumber(asset.quantity ?? 1))} unit</td>
          <td>${escapeHtml(officeAssetConditionLabels[asset.condition] || "Tidak diketahui")}</td>
          <td>${escapeHtml(asset.location || "-")}</td>
          <td>${escapeHtml(asset.notes || "-")}</td>
        </tr>`).join("") : `<tr><td class="empty" colspan="6">Belum ada alat inventaris kantor.</td></tr>`;
        const reportHtml = `<!DOCTYPE html>
          <html lang="id">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Laporan Alat Inventaris Kantor</title>
            <style>
              * { box-sizing: border-box; }
              body { margin: 0; color: #17243b; font: 12px Arial, sans-serif; }
              .report { max-width: 1120px; margin: 0 auto; padding: 32px; }
              header { display: flex; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 2px solid #102a56; }
              header img { width: 58px; height: 58px; object-fit: contain; }
              header p { margin: 0 0 4px; color: #102a56; font-weight: 700; }
              h1 { margin: 0; color: #102a56; font-size: 21px; }
              .generated { margin-top: 7px; color: #748197; font-size: 10px; font-weight: 400; }
              .summary { margin: 18px 0; color: #526179; }
              table { width: 100%; border-collapse: collapse; }
              th { padding: 9px 7px; background: #f3f6fb; color: #526179; font-size: 9px; text-align: left; text-transform: uppercase; }
              td { padding: 9px 8px; border-bottom: 1px solid #e7ebf2; color: #40506a; vertical-align: top; }
              td span { display: block; margin-top: 3px; color: #8490a2; font-size: 10px; }
              .empty { padding: 18px 8px; color: #748197; text-align: center; }
              @page { size: A4 landscape; margin: 14mm; }
              @media print { .report { max-width: none; padding: 0; } thead { display: table-header-group; } tr { break-inside: avoid; } }
            </style>
          </head>
          <body><main class="report">
            <header><img src="${logoUrl}" alt="Logo Feno Berjaya"><div><p>FENO BERJAYA</p><h1>Laporan Alat Inventaris Kantor</h1><p class="generated">Dibuat pada ${escapeHtml(generatedAt)}</p></div></header>
            <p class="summary">${formatNumber(assets.length)} jenis alat · ${formatNumber(totalQuantity)} unit</p>
            <table><thead><tr><th>Nama / kode alat</th><th>Kategori</th><th>Jumlah</th><th>Kondisi barang</th><th>Lokasi</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table>
          </main></body>
          </html>`;
        reportWindow.document.open();
        reportWindow.document.write(reportHtml);
        reportWindow.document.close();
      } catch (error) {
        console.error("Gagal menyiapkan pratinjau inventaris kantor:", error);
        reportWindow.close();
        showToast(error.message || "Pratinjau laporan gagal disiapkan.", "error");
      }
    }

    function downloadOfficeAssetsPdf() {
      try {
        const assets = [...state.officeAssets].sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
        const title = "Laporan Alat Inventaris Kantor";
        const description = `Daftar alat inventaris kantor per ${formatDate(new Date())}`;
        const { doc, logoDataUrl } = createPdfDocument(title, description);
        const totalQuantity = assets.reduce((total, asset) => total + (Number(asset.quantity ?? 1) || 0), 0);
        doc.setFontSize(9);
        doc.setTextColor(55, 65, 81);
        doc.text(`Total jenis alat: ${formatNumber(assets.length)}     Total unit: ${formatNumber(totalQuantity)}`, 14, 51);
        const rows = assets.map((asset) => [
          asset.name || "",
          asset.asset_code || "Tanpa kode",
          asset.category || "Lainnya",
          `${formatNumber(asset.quantity ?? 1)} unit`,
          officeAssetConditionLabels[asset.condition] || "Tidak diketahui",
          asset.location || "-",
          asset.notes || "-"
        ]);
        pdfTableOptions(
          doc,
          logoDataUrl,
          description,
          57,
          ["Nama alat", "Kode inventaris", "Kategori", "Jumlah", "Kondisi barang", "Lokasi", "Catatan"],
          rows.length ? rows : [["Belum ada data", "-", "-", "-", "-", "-", "-"]]
        );
        doc.save(`laporan-alat-inventaris-${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast("Laporan alat inventaris berhasil diunduh.");
      } catch (error) {
        console.error("Gagal mengunduh PDF inventaris kantor:", error);
        showToast(error.message || "Laporan alat inventaris gagal diunduh.", "error");
      }
    }

    function renderMovementsPage() {
      const movements = state.movements;
      const content = movements.length ? `<div class="table-wrap"><table><thead><tr><th>Tanggal & waktu</th><th>Nama barang</th><th>Kategori</th><th>Jenis transaksi</th><th>Jumlah</th><th>Catatan</th></tr></thead><tbody>${movements.map((movement) => {
          const item = movement.inventory_items || state.items.find((entry) => entry.id === movement.item_id) || {};
          const inbound = movement.movement_type === "in";
          return `<tr><td>${escapeHtml(formatDate(movement.created_at, true))}</td><td><strong>${escapeHtml(item.name || "Barang dihapus")}</strong><div class="item-secondary">${escapeHtml(item.sku || "")}</div></td><td><span class="category-chip">${escapeHtml(itemCategory(item.category))}</span></td><td><span class="stock-badge ${inbound ? "stock-ok" : "stock-empty"}">${inbound ? "Stok masuk" : "Stok keluar"}</span></td><td><strong>${inbound ? "+" : "−"}${escapeHtml(formatNumber(movement.quantity))}</strong> ${escapeHtml(item.unit || "")}</td><td>${escapeHtml(movement.notes || "-")}</td></tr>`;
        }).join("")}</tbody></table></div>` : renderEmpty("Riwayat transaksi akan muncul setelah Anda mencatat stok masuk atau keluar.");
      return `<section class="panel">
        <div class="panel-header"><div><div class="panel-title">Semua transaksi stok</div><div class="panel-subtitle">Maksimal 100 transaksi terbaru</div></div><div class="page-heading-actions"><button class="button button-secondary button-small" id="exportMovementsPdf">${icon("download")} Ekspor PDF</button><button class="button button-secondary button-small" id="exportMovements">${icon("download")} Ekspor CSV</button></div></div>
        ${content}
      </section>`;
    }

    function showAuth() {
      $("#appShell").classList.add("hidden");
      $("#authScreen").classList.remove("hidden");
      $("#authHelper").textContent = state.demo
        ? "Mode lokal aktif. Data disimpan hanya di browser/perangkat ini."
        : "Gunakan email dan kata sandi akun Supabase Anda.";
    }

    function showApp() {
      $("#authScreen").classList.add("hidden");
      $("#appShell").classList.remove("hidden");
      render();
    }

    function openItemModal(category, item = null) {
      const editing = Boolean(item);
      let selectedImageFile = null;
      let removeExistingImage = false;
      let previewObjectUrl = null;
      const currentPhoto = item?.image_path ? productImageUrl(item) : "";
      $("#modalRoot").innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-head"><div><h2 id="modalTitle">${editing ? "Edit data barang" : `Tambah ${category === "material" ? "material" : "produk"}`}</h2><p>Lengkapi informasi persediaan dengan benar.</p></div><button class="icon-button" data-close-modal aria-label="Tutup">×</button></div>
        <form id="itemForm" class="modal-body">
          <div class="form-grid">
            <div class="form-field full"><label for="itemName">Nama barang *</label><input id="itemName" name="name" required maxlength="120" value="${escapeHtml(item?.name || "")}" placeholder="Contoh: Resin Epoxy"></div>
            <div class="form-field full"><span class="form-field-label" id="itemCategoryLabel">Kategori *</span><div class="category-options" role="radiogroup" aria-labelledby="itemCategoryLabel">
              <label class="category-option material ${category === "material" ? "selected" : ""}"><input type="radio" name="category" value="material" required ${category === "material" ? "checked" : ""}><span class="category-option-copy"><span class="category-option-title">Material</span><span class="category-option-description">Bahan baku atau material produksi.</span></span></label>
              <label class="category-option product ${category === "product" ? "selected" : ""}"><input type="radio" name="category" value="product" required ${category === "product" ? "checked" : ""}><span class="category-option-copy"><span class="category-option-title">Produk jadi</span><span class="category-option-description">Barang hasil produksi yang siap disimpan atau dijual.</span></span></label>
            </div></div>
            <div class="form-field"><label for="itemSku">Kode barang</label><input id="itemSku" name="sku" maxlength="60" value="${escapeHtml(item?.sku || "")}" placeholder="Contoh: MAT-001"></div>
            <div class="form-field"><label for="itemUnit">Satuan *</label><input id="itemUnit" name="unit" required maxlength="20" value="${escapeHtml(item?.unit || "pcs")}" placeholder="pcs, kg, meter"></div>
            <div class="form-field"><label for="itemLocation">Lokasi penyimpanan</label><input id="itemLocation" name="location" maxlength="100" value="${escapeHtml(item?.location || "")}" placeholder="Contoh: Gudang A - Rak 2"></div>
            <div class="form-field full" id="itemImageField"><label for="itemImage">Foto ${category === "material" ? "material" : "produk"} (opsional)</label>
              <div class="product-image-control"><div class="product-image-preview"><img id="imagePreview" alt="Pratinjau foto barang" class="${currentPhoto ? "" : "hidden"}" ${currentPhoto ? `src="${escapeHtml(currentPhoto)}"` : ""}><span id="imagePlaceholder" class="${currentPhoto ? "hidden" : ""}">Foto belum dipilih</span></div>
                <div class="product-image-actions"><label class="button button-secondary button-small" for="itemImage">Pilih foto</label><input id="itemImage" type="file" accept="image/jpeg,image/png,image/webp" class="hidden"><button id="removeImageButton" class="button button-secondary button-small ${currentPhoto ? "" : "hidden"}" type="button">Hapus foto</button><span class="form-hint">JPG, PNG, atau WebP. Foto akan dikecilkan otomatis.</span></div>
              </div>
            </div>
          </div>
          <p class="form-hint">${editing ? "Nama dan foto disimpan di katalog. Perubahan jumlah stok dicatat melalui tombol Tambah Stok atau Catat transaksi." : "Barang baru tersimpan di katalog dengan stok 0. Setelah disimpan, pilih Tambah Stok pada barang untuk mencatat jumlah masuk."}</p>
          <div class="modal-actions"><button type="button" class="button button-secondary" data-close-modal>Batal</button><button type="submit" class="button button-primary">${editing ? "Simpan perubahan" : "Simpan barang"}</button></div>
        </form></section></div>`;
      $("#itemName").focus();
      $("#itemForm").addEventListener("change", (event) => {
        if (event.target.name !== "category") return;
        document.querySelectorAll(".category-option").forEach((option) => {
          option.classList.toggle("selected", $("input", option).checked);
        });
      });
      $("#itemImage").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          event.target.value = "";
          showToast("Pilih foto berformat JPG, PNG, atau WebP.", "error");
          return;
        }
        if (file.size > 8 * 1024 * 1024) {
          event.target.value = "";
          showToast("Ukuran foto maksimal 8 MB.", "error");
          return;
        }
        selectedImageFile = file;
        removeExistingImage = false;
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = URL.createObjectURL(file);
        $("#imagePreview").src = previewObjectUrl;
        $("#imagePreview").classList.remove("hidden");
        $("#imagePlaceholder").classList.add("hidden");
        $("#removeImageButton").classList.remove("hidden");
      });
      $("#removeImageButton").addEventListener("click", () => {
        selectedImageFile = null;
        removeExistingImage = true;
        $("#itemImage").value = "";
        $("#imagePreview").removeAttribute("src");
        $("#imagePreview").classList.add("hidden");
        $("#imagePlaceholder").classList.remove("hidden");
        $("#removeImageButton").classList.add("hidden");
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
          previewObjectUrl = null;
        }
      });
      $("#itemForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.busy) return;
        const formData = new FormData(event.currentTarget);
        const data = Object.fromEntries(formData.entries());
        data.name = data.name.trim();
        data.sku = data.sku.trim();
        data.unit = data.unit.trim();
        data.location = data.location.trim();
        data.quantity = editing ? Number(item.quantity) : 0;
        const oldImagePath = item?.image_path || "";
        let uploadedImagePath = "";
        let itemSaved = false;
        let cleanupWarning = false;
        data.image_path = removeExistingImage ? "" : oldImagePath;
        if (!data.name || !data.unit || !Number.isFinite(data.quantity) || data.quantity < 0) {
          showToast("Periksa kembali nama dan satuan barang.", "error");
          return;
        }
        try {
          setBusy(true);
          if (selectedImageFile) {
            const optimizedImage = await optimizeProductImage(selectedImageFile);
            if (supabaseClient) {
              uploadedImagePath = `${state.user.id}/${crypto.randomUUID()}.webp`;
              const { error: uploadError } = await supabaseClient.storage.from(PRODUCT_IMAGE_BUCKET).upload(uploadedImagePath, optimizedImage, {
                contentType: "image/webp",
                upsert: false
              });
              if (uploadError) throw uploadError;
              data.image_path = uploadedImagePath;
            } else {
              data.image_path = await readBlobAsDataUrl(optimizedImage);
            }
          }
          if (supabaseClient) {
            const payload = { ...data, owner_id: state.user.id };
            const { error } = editing
              ? await supabaseClient.from("inventory_items").update(payload).eq("id", item.id)
              : await supabaseClient.from("inventory_items").insert(payload);
            if (error) throw error;
            itemSaved = true;
          } else if (editing) {
            state.items = state.items.map((entry) => entry.id === item.id ? { ...entry, ...data, updated_at: new Date().toISOString() } : entry);
            saveLocalData();
            itemSaved = true;
          } else {
            const newItem = { ...data, id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            state.items.push(newItem);
            saveLocalData();
            itemSaved = true;
          }
          await loadData();
          if (supabaseClient && oldImagePath && oldImagePath !== data.image_path) {
            try {
              await removeStoredProductImage(oldImagePath);
            } catch (error) {
              cleanupWarning = true;
              console.error("Foto lama tidak dapat dihapus:", error);
            }
          }
          closeItemModal();
          render();
          showToast(cleanupWarning ? "Data tersimpan, tetapi foto lama belum berhasil dihapus." : editing ? "Data barang berhasil diperbarui." : "Barang berhasil ditambahkan.", cleanupWarning ? "error" : "success");
        } catch (error) {
          if (uploadedImagePath && !itemSaved) {
            try {
              await removeStoredProductImage(uploadedImagePath);
            } catch (cleanupError) {
              console.error("Foto baru yang gagal disimpan tidak dapat dibersihkan:", cleanupError);
            }
          }
          console.error("Gagal menyimpan barang:", error);
          showToast(error.message || "Barang gagal disimpan.", "error");
        } finally { setBusy(false); }
      });
    }

    function closeItemModal() {
      const preview = $("#imagePreview");
      if (preview?.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
      $("#modalRoot").innerHTML = "";
    }

    async function optimizeProductImage(file) {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        throw new Error("Foto tidak dapat diproses di browser ini.");
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      for (const quality of [0.82, 0.68, 0.52]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (!blob || blob.type !== "image/webp") throw new Error("Browser ini tidak dapat memproses foto WebP.");
        if (blob.size <= 1024 * 1024) return blob;
      }
      throw new Error("Ukuran foto masih terlalu besar setelah dikompres.");
    }

    function readBlobAsDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Foto gagal dibaca."));
        reader.readAsDataURL(blob);
      });
    }

    async function removeStoredProductImage(path) {
      if (!supabaseClient || !path || path.startsWith("data:")) return;
      if (!path.startsWith(`${state.user.id}/`)) throw new Error("Foto tidak dapat dihapus karena lokasi penyimpanannya tidak valid.");
      const { error } = await supabaseClient.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
      if (error) throw error;
    }

    function openMovementModal(item = null, options = {}) {
      const selectableItems = item ? [item] : state.items.filter((entry) => !options.category || entry.category === options.category);
      const inboundOnly = options.movementType === "in";
      const outboundOnly = options.movementType === "out";
      if (!selectableItems.length) {
        showToast(options.category === "product" ? "Belum ada produk untuk dikurangi. Tambahkan produk terlebih dahulu." : "Tambahkan data barang terlebih dahulu.", "error");
        return;
      }
      $("#modalRoot").innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-head"><div><h2 id="modalTitle">${inboundOnly ? "Tambah stok" : outboundOnly ? "Pengurangan stok" : "Catat transaksi stok"}</h2><p>${inboundOnly ? "Pilih jumlah stok baru yang masuk untuk barang ini." : "Perubahan stok akan masuk ke riwayat transaksi."}</p></div><button class="icon-button" data-close-modal aria-label="Tutup">×</button></div>
        <form id="movementForm" class="modal-body"><div class="form-grid">
          <div class="form-field full"><label for="movementItem">Barang *</label><select id="movementItem" name="item_id" required>${selectableItems.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)} (${escapeHtml(formatNumber(entry.quantity))} ${escapeHtml(entry.unit)})</option>`).join("")}</select></div>
          <div class="form-field"><label for="movementType">Jenis transaksi *</label><select id="movementType" name="movement_type">${inboundOnly ? '<option value="in">Stok masuk</option>' : outboundOnly ? '<option value="out">Stok keluar</option>' : '<option value="in">Stok masuk</option><option value="out">Stok keluar</option>'}</select></div>
          <div class="form-field"><label for="movementQuantity">Jumlah *</label><input id="movementQuantity" name="quantity" type="number" min="0.01" step="0.01" required placeholder="0"></div>
          <div class="form-field full"><label for="movementNotes">Catatan / referensi</label><textarea id="movementNotes" name="notes" maxlength="500" placeholder="Contoh: Pembelian PO-2026-001"></textarea></div>
        </div><div class="modal-actions"><button type="button" class="button button-secondary" data-close-modal>Batal</button><button type="submit" class="button button-primary">${inboundOnly ? "Tambah stok" : "Simpan transaksi"}</button></div></form></section></div>`;
      $("#movementForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.busy) return;
        const formData = new FormData(event.currentTarget);
        const movement = Object.fromEntries(formData.entries());
        movement.quantity = Number(movement.quantity);
        movement.notes = movement.notes.trim();
        const selected = state.items.find((entry) => entry.id === movement.item_id);
        if (!selected || !Number.isFinite(movement.quantity) || movement.quantity <= 0) {
          showToast("Pilih barang dan masukkan jumlah transaksi yang valid.", "error");
          return;
        }
        if (movement.movement_type === "out" && movement.quantity > Number(selected.quantity)) {
          showToast(`Stok tidak cukup. Stok tersedia ${formatNumber(selected.quantity)} ${selected.unit}.`, "error");
          return;
        }
        try {
          setBusy(true);
          if (supabaseClient) {
            const { error } = await supabaseClient.rpc("record_stock_movement", {
              p_item_id: movement.item_id,
              p_movement_type: movement.movement_type,
              p_quantity: movement.quantity,
              p_notes: movement.notes || null
            });
            if (error) throw error;
          } else {
            selected.quantity = Number(selected.quantity) + (movement.movement_type === "in" ? movement.quantity : -movement.quantity);
            selected.updated_at = new Date().toISOString();
            state.movements.unshift({ ...movement, id: crypto.randomUUID(), created_at: new Date().toISOString() });
            saveLocalData();
          }
          await loadData();
          $("#modalRoot").innerHTML = "";
          render();
          showToast("Transaksi stok berhasil dicatat.");
        } catch (error) {
          console.error("Gagal mencatat transaksi:", error);
          showToast(error.message || "Transaksi gagal disimpan.", "error");
        } finally { setBusy(false); }
      });
    }

    async function deleteItem(item) {
      const confirmed = window.confirm(`Hapus "${item.name}"? Riwayat transaksi barang ini juga akan dihapus.`);
      if (!confirmed) return;
      try {
        setBusy(true);
        if (supabaseClient) {
          const { error } = await supabaseClient.from("inventory_items").delete().eq("id", item.id);
          if (error) throw error;
        } else {
          state.items = state.items.filter((entry) => entry.id !== item.id);
          state.movements = state.movements.filter((entry) => entry.item_id !== item.id);
          saveLocalData();
        }
        await loadData();
        render();
        showToast("Barang berhasil dihapus.");
      } catch (error) {
        console.error("Gagal menghapus barang:", error);
        showToast(error.message || "Barang gagal dihapus.", "error");
      } finally { setBusy(false); }
    }

    function downloadCsv() {
      const rows = [["Tanggal", "Nama barang", "Kode", "Kategori", "Jenis", "Jumlah", "Satuan", "Catatan"]];
      state.movements.forEach((movement) => {
        const item = movement.inventory_items || state.items.find((entry) => entry.id === movement.item_id) || {};
        rows.push([formatDate(movement.created_at, true), item.name || "", item.sku || "", itemCategory(item.category), movement.movement_type === "in" ? "Masuk" : "Keluar", movement.quantity, item.unit || "", movement.notes || ""]);
      });
      const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
      link.download = `riwayat-stok-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function previewMovementsPdf() {
      const reportWindow = window.open("", "_blank");
      if (!reportWindow) {
        showToast("Jendela laporan diblokir. Izinkan pop-up untuk mengunduh PDF.", "error");
        return;
      }

      const generatedAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(new Date());
      const rows = state.movements.map((movement) => {
        const item = movement.inventory_items || state.items.find((entry) => entry.id === movement.item_id) || {};
        const inbound = movement.movement_type === "in";
        return `<tr>
          <td>${escapeHtml(formatDate(movement.created_at, true))}</td>
          <td><strong>${escapeHtml(item.name || "Barang dihapus")}</strong><span class="code">${escapeHtml(item.sku || "Tanpa kode")}</span></td>
          <td>${escapeHtml(itemCategory(item.category))}</td>
          <td>${inbound ? "Stok masuk" : "Stok keluar"}</td>
          <td class="number">${inbound ? "+" : "−"}${escapeHtml(formatNumber(movement.quantity))} ${escapeHtml(item.unit || "")}</td>
          <td>${escapeHtml(movement.notes || "-")}</td>
        </tr>`;
      }).join("");
      const reportHtml = `<!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Riwayat Stok - Feno Berjaya</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; color: #17243b; font: 11px Arial, sans-serif; }
            main { max-width: 1200px; margin: 0 auto; padding: 32px; }
            header { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 2px solid #102a56; }
            img { width: 52px; height: 52px; object-fit: contain; }
            .company { margin: 0 0 4px; color: #102a56; font-weight: 700; }
            h1 { margin: 0; color: #102a56; font-size: 20px; }
            .generated { margin: 6px 0 0; color: #748197; font-size: 9px; }
            table { width: 100%; margin-top: 20px; border-collapse: collapse; }
            th { padding: 9px 7px; background: #f3f6fb; color: #526179; font-size: 8px; text-align: left; text-transform: uppercase; }
            td { padding: 8px 7px; border-bottom: 1px solid #e7ebf2; color: #40506a; vertical-align: top; }
            .number { text-align: right; white-space: nowrap; }
            .code { display: block; margin-top: 3px; color: #8490a2; font-size: 9px; }
            .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e7ebf2; color: #8490a2; font-size: 9px; }
            @page { size: A4 landscape; margin: 12mm; }
            @media print { main { max-width: none; padding: 0; } thead { display: table-header-group; } tr { break-inside: avoid; } }
          </style>
        </head>
        <body><main>
          <header><img src="${escapeHtml(new URL("logo pdf.png", document.baseURI).href)}" alt="Logo Feno Berjaya"><div><p class="company">FENO BERJAYA</p><h1>Laporan Riwayat Stok</h1><p class="generated">Dibuat pada ${escapeHtml(generatedAt)} · ${formatNumber(state.movements.length)} transaksi terakhir</p></div></header>
          <table><thead><tr><th>Tanggal & waktu</th><th>Nama / kode barang</th><th>Kategori</th><th>Jenis transaksi</th><th class="number">Jumlah</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table>
          <footer class="footer">Dokumen dibuat otomatis oleh Sistem Inventaris Feno Berjaya.</footer>
        </main></body>
        </html>`;

      reportWindow.document.open();
      reportWindow.document.write(reportHtml);
      reportWindow.document.close();
    }

    function downloadMovementsPdf() {
      try {
        const movementDates = state.movements
          .map((movement) => new Date(movement.created_at))
          .filter((date) => !Number.isNaN(date.getTime()))
          .sort((a, b) => a - b);
        const period = movementDates.length
          ? `${formatDate(movementDates[0])} - ${formatDate(movementDates[movementDates.length - 1])}`
          : "Belum ada transaksi";
        const description = `Laporan Periode: ${period}`;
        const { doc, logoDataUrl } = createPdfDocument("Laporan Riwayat Stok", description);
        const rows = state.movements.map((movement) => {
          const item = movement.inventory_items || state.items.find((entry) => entry.id === movement.item_id) || {};
          const inbound = movement.movement_type === "in";
          return [
            formatDate(movement.created_at, true),
            item.name || "Barang dihapus",
            item.sku || "Tanpa kode",
            itemCategory(item.category),
            inbound ? "Stok masuk" : "Stok keluar",
            `${inbound ? "+" : "-"}${formatNumber(movement.quantity)} ${item.unit || ""}`,
            movement.notes || "-"
          ];
        });
        pdfTableOptions(
          doc,
          logoDataUrl,
          description,
          47,
          ["Tanggal & waktu", "Nama barang", "Kode", "Kategori", "Jenis transaksi", "Jumlah", "Catatan"],
          rows.length ? rows : [["-", "Belum ada transaksi", "-", "-", "-", "-", "-"]]
        );
        doc.save(`riwayat-stok-${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast("Riwayat stok PDF berhasil diunduh.");
      } catch (error) {
        console.error("Gagal mengunduh riwayat stok PDF:", error);
        showToast(error.message || "Riwayat stok PDF gagal diunduh.", "error");
      }
    }

    document.addEventListener("click", async (event) => {
      if (event.target.closest("#themeToggle")) {
        const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(theme);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (error) {
          console.error("Preferensi tema tidak dapat disimpan:", error);
          showToast("Tema berubah, tetapi preferensi tidak dapat disimpan di perangkat ini.", "error");
        }
        return;
      }
      const pdfAction = event.target.closest("[data-pdf-action]");
      if (pdfAction && state.pdfActions) {
        const action = pdfAction.dataset.pdfAction;
        const handler = state.pdfActions[action];
        $("#modalRoot").innerHTML = "";
        state.pdfActions = null;
        if (handler) await handler();
        return;
      }
      const nav = event.target.closest("[data-page]");
      if (nav) {
        state.page = nav.dataset.page;
        state.query = "";
        $("#sidebar").classList.remove("open");
        render();
        return;
      }
      const go = event.target.closest("[data-go]");
      if (go) { state.page = go.dataset.go; render(); return; }
      const action = event.target.closest("[data-action]");
      if (action) {
        const item = state.items.find((entry) => entry.id === action.dataset.id);
        if (!item) return;
        if (action.dataset.action === "edit") openItemModal(item.category, item);
        else if (action.dataset.action === "stock-in") openMovementModal(item, { movementType: "in" });
        else if (action.dataset.action === "movement") openMovementModal(item);
        else if (action.dataset.action === "delete") await deleteItem(item);
        return;
      }
      const officeAssetAction = event.target.closest("[data-office-asset-action]");
      if (officeAssetAction) {
        const asset = state.officeAssets.find((entry) => entry.id === officeAssetAction.dataset.id);
        if (!asset) return;
        if (officeAssetAction.dataset.officeAssetAction === "edit") openOfficeAssetModal(asset);
        else if (officeAssetAction.dataset.officeAssetAction === "delete") await deleteOfficeAsset(asset);
        return;
      }
      if (event.target.closest("[data-close-modal]") || (event.target.matches("[data-dismiss]"))) {
        $("#modalRoot").innerHTML = "";
        state.pdfActions = null;
      }
      if (event.target.closest("#primaryAction")) {
        if (state.page === "office") {
          openOfficeAssetModal();
          return;
        }
        const category = state.page === "materials" ? "material" : state.page === "products" ? "product" : "material";
        openItemModal(category);
      }
      const shortcut = event.target.closest("[data-shortcut]");
      if (shortcut?.dataset.shortcut === "add-product") openItemModal("product");
      if (shortcut?.dataset.shortcut === "reduce-product") openMovementModal(null, { category: "product", movementType: "out" });
      if (event.target.closest("#mobileMenu")) $("#sidebar").classList.toggle("open");
      if (event.target.closest("#inventoryReport")) {
        showPdfActions(
          state.page === "office" ? previewOfficeAssetsReport : previewInventoryReport,
          state.page === "office" ? downloadOfficeAssetsPdf : downloadInventoryPdf
        );
      }
      if (event.target.closest("#exportMovementsPdf")) {
        showPdfActions(previewMovementsPdf, downloadMovementsPdf);
      }
      if (event.target.closest("#exportMovements")) downloadCsv();
    });

    document.addEventListener("input", (event) => {
      if (event.target.id === "inventorySearch" || event.target.id === "officeAssetSearch") {
        const cursor = event.target.selectionStart;
        state.query = event.target.value;
        render();
        const search = event.target.id === "officeAssetSearch" ? $("#officeAssetSearch") : $("#inventorySearch");
        search.focus();
        search.setSelectionRange(cursor, cursor);
      }
    });
    document.addEventListener("error", (event) => {
      if (!event.target.matches(".product-photo")) return;
      event.target.classList.add("hidden");
      event.target.nextElementSibling?.classList.remove("hidden");
    }, true);
    $("#authToggle").addEventListener("click", () => {
      state.authMode = state.authMode === "login" ? "signup" : "login";
      const signup = state.authMode === "signup";
      $("#authSubmit").textContent = signup ? "Buat akun" : "Masuk ke aplikasi";
      $("#authToggleText").textContent = signup ? "Sudah punya akun?" : "Belum punya akun?";
      $("#authToggle").textContent = signup ? "Masuk" : "Daftar";
      $("#authHelper").textContent = signup ? "Akun akan dibuat di Supabase. Hubungi admin bila konfirmasi email diaktifkan." : "Gunakan email dan kata sandi akun Supabase Anda.";
    });

    $("#authForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!supabaseClient) {
        state.user = { email: $("#authEmail").value.trim() || "demo@fenoberjaya.local" };
        readLocalData();
        showApp();
        return;
      }
      const email = $("#authEmail").value.trim();
      const password = $("#authPassword").value;
      const button = $("#authSubmit");
      button.disabled = true;
      button.textContent = "Memproses...";
      try {
        const result = state.authMode === "signup"
          ? await supabaseClient.auth.signUp({ email, password })
          : await supabaseClient.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (state.authMode === "signup" && !result.data.session) {
          showToast("Pendaftaran berhasil. Periksa email untuk konfirmasi akun.");
          return;
        }
        state.user = result.data.user;
        await loadData();
        showApp();
      } catch (error) {
        console.error("Autentikasi gagal:", error);
        showToast(error.message || "Autentikasi gagal.", "error");
      } finally {
        button.disabled = false;
        button.textContent = state.authMode === "signup" ? "Buat akun" : "Masuk ke aplikasi";
      }
    });

    $("#signOutButton").addEventListener("click", async () => {
      if (supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
          console.error("Gagal keluar:", error);
          showToast(error.message || "Gagal keluar.", "error");
          return;
        }
      }
      state.user = null;
      state.items = [];
      state.movements = [];
      showAuth();
    });

    async function initialize() {
      if (!supabaseClient) {
        showAuth();
        return;
      }
      try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!session) { showAuth(); return; }
        state.user = session.user;
        await loadData();
        showApp();
      } catch (error) {
        console.error("Gagal memuat aplikasi:", error);
        showAuth();
        showToast(error.message || "Gagal terhubung ke Supabase.", "error");
      }
      supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        if (!session) return;
        state.user = session.user;
        try {
          await loadData();
          if (!$("#appShell").classList.contains("hidden")) render();
        } catch (error) {
          console.error("Gagal memuat data setelah autentikasi:", error);
          showToast(error.message || "Data inventaris gagal dimuat.", "error");
        }
      });
    }

    initialize();
