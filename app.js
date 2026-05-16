/* Vis Ontvangst Registratie Tool */
(function () {
  'use strict';

  const STORAGE_KEYS = {
    receipts: 'vor.receipts',
    settings: 'vor.settings',
    syncQueue: 'vor.syncQueue',
  };

  const DEFAULT_SETTINGS = {
    defaultCrateWeight: 2.0,
    defaultCrateCount: 20,
    defaultPalletWeight: 25,
    defaultIcePercent: 0,
    species: ['Kabeljauw', 'Schol', 'Tong', 'Makreel', 'Haring', 'Zalm'],
    suppliers: [],
    sizes: ['1', '2', '3', '4', '5'],
    sheetWebhookUrl: '',
    sheetIncludePhoto: false,
  };

  // ------- State -------
  let settings = loadSettings();
  let pallets = []; // current draft

  // ------- Utils -------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }

  function loadReceipts() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.receipts) || '[]');
    } catch {
      return [];
    }
  }

  function saveReceipts(receipts) {
    localStorage.setItem(STORAGE_KEYS.receipts, JSON.stringify(receipts));
  }

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.syncQueue) || '[]'); }
    catch { return []; }
  }
  function saveQueue(q) {
    localStorage.setItem(STORAGE_KEYS.syncQueue, JSON.stringify(q));
    updateSyncBadge();
  }

  // ------- Google Sheets sync -------
  function buildSheetPayload(receipt) {
    return {
      receiptId: receipt.id,
      dateTime: receipt.dateTime,
      supplier: receipt.supplier || '',
      deliveryNumber: receipt.deliveryNumber || '',
      createdAt: receipt.createdAt,
      pallets: receipt.pallets.map((p, i) => ({
        palletIndex: i + 1,
        species: p.species,
        size: p.size || '',
        quality: p.quality,
        crateCount: p.crateCount,
        crateWeight: p.crateWeight,
        palletWeight: p.palletWeight ?? 0,
        grossWeight: p.grossWeight,
        netGross: p.netGross ?? p.netWeight,
        icePercent: p.icePercent ?? 0,
        iceDeduction: p.iceDeduction ?? 0,
        netWeight: p.netWeight,
        temperature: p.temperature,
        notes: p.notes || '',
        photo: settings.sheetIncludePhoto ? (p.photo || '') : '',
      })),
    };
  }

  async function postToSheet(payload) {
    const url = (settings.sheetWebhookUrl || '').trim();
    if (!url) throw new Error('Geen webhook-URL ingesteld');
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json().catch(() => ({}));
    if (data && data.status === 'error') throw new Error(data.message || 'Server fout');
    return data;
  }

  async function trySync(receipt) {
    if (!settings.sheetWebhookUrl) return { synced: false, reason: 'disabled' };
    try {
      await postToSheet(buildSheetPayload(receipt));
      return { synced: true };
    } catch (err) {
      const q = loadQueue();
      if (!q.find(r => r.id === receipt.id)) q.push(receipt);
      saveQueue(q);
      return { synced: false, reason: err.message };
    }
  }

  async function flushQueue() {
    if (!settings.sheetWebhookUrl) { toast('Geen webhook-URL ingesteld', 'error'); return; }
    const q = loadQueue();
    if (q.length === 0) { toast('Niets te synchroniseren', 'success'); return; }
    let okCount = 0;
    const remaining = [];
    for (const receipt of q) {
      try {
        await postToSheet(buildSheetPayload(receipt));
        okCount++;
      } catch {
        remaining.push(receipt);
      }
    }
    saveQueue(remaining);
    if (remaining.length === 0) toast(`Alle ${okCount} ontvangsten gesynchroniseerd`, 'success');
    else toast(`${okCount} gesynchroniseerd, ${remaining.length} nog in wachtrij`, 'error');
  }

  function updateSyncBadge() {
    const badge = $('#syncBadge');
    if (!badge) return;
    const n = loadQueue().length;
    if (n === 0) { badge.classList.add('hidden'); badge.textContent = ''; }
    else { badge.classList.remove('hidden'); badge.textContent = String(n); }
  }

  function fmtNum(n, decimals = 2) {
    if (n === null || n === undefined || isNaN(n)) return '0,00';
    return Number(n).toFixed(decimals).replace('.', ',');
  }

  function nowLocalIso() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('nl-NL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function toast(msg, kind = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + kind;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.className = 'toast hidden';
    }, 2200);
  }

  function fileToDataUrl(file, maxDim = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxDim / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ------- Tab navigation -------
  function setView(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
  }

  // ------- Species options -------
  function populateSpeciesSelect(selectEl, current) {
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Kies vissoort —';
    selectEl.appendChild(placeholder);
    settings.species.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === current) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function populateSizeSelect(selectEl, current) {
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = settings.sizes.length === 0
      ? '— Geen sizes (voeg toe bij Instellingen) —'
      : '— Kies size —';
    selectEl.appendChild(placeholder);
    settings.sizes.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === current) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function populateSupplierSelect(current) {
    const selectEl = $('#supplier');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = settings.suppliers.length === 0
      ? '— Geen leveranciers (voeg toe bij Instellingen) —'
      : '— Kies leverancier —';
    selectEl.appendChild(placeholder);
    settings.suppliers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === current) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  // ------- Pallet rendering -------
  function addPallet(preset) {
    const tpl = $('#palletTemplate').content.cloneNode(true);
    const node = tpl.querySelector('.pallet');
    const id = preset?.id || uid();
    node.dataset.palletId = id;

    const crateCountInput = $('.crateCount', node);
    const crateWeightInput = $('.crateWeight', node);
    const palletWeightInput = $('.palletWeight', node);
    const grossInput = $('.grossWeight', node);
    const iceInput = $('.icePercent', node);
    const netGrossInput = $('.netGross', node);
    const netInput = $('.netWeight', node);
    const speciesSelect = $('.species', node);
    const tempInput = $('.temperature', node);
    const notesInput = $('.notes', node);
    const photoInput = $('.photoInput', node);
    const photoPreview = $('.photo-preview', node);

    crateCountInput.value = preset?.crateCount ?? settings.defaultCrateCount;
    crateWeightInput.value = preset?.crateWeight ?? settings.defaultCrateWeight;
    palletWeightInput.value = preset?.palletWeight ?? settings.defaultPalletWeight;
    grossInput.value = preset?.grossWeight ?? '';
    iceInput.value = preset?.icePercent ?? settings.defaultIcePercent;
    tempInput.value = preset?.temperature ?? '';
    notesInput.value = preset?.notes ?? '';

    populateSpeciesSelect(speciesSelect, preset?.species);
    populateSizeSelect($('.size', node), preset?.size);

    // Photo
    const palletState = {
      id,
      photo: preset?.photo || null,
    };
    if (palletState.photo) {
      const img = document.createElement('img');
      img.src = palletState.photo;
      photoPreview.innerHTML = '';
      photoPreview.appendChild(img);
      photoPreview.classList.remove('empty');
    }
    photoPreview.addEventListener('click', () => {
      if (palletState.photo) openPhoto(palletState.photo);
    });
    photoInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        palletState.photo = dataUrl;
        photoPreview.innerHTML = '';
        const img = document.createElement('img');
        img.src = dataUrl;
        photoPreview.appendChild(img);
        photoPreview.classList.remove('empty');
      } catch (err) {
        toast('Kon foto niet laden', 'error');
      }
    });

    // Quality buttons
    $$('.quality-btn', node).forEach(btn => {
      if (preset?.quality && btn.dataset.q === preset.quality) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => {
        $$('.quality-btn', node).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Live calc
    function recalc() {
      const c = parseFloat(crateCountInput.value) || 0;
      const w = parseFloat(crateWeightInput.value) || 0;
      const pw = parseFloat(palletWeightInput.value) || 0;
      const g = parseFloat(grossInput.value) || 0;
      let ice = parseFloat(iceInput.value) || 0;
      if (ice < 0) ice = 0;
      if (ice > 100) ice = 100;
      const netGross = g - (c * w) - pw;
      const net = netGross * (1 - ice / 100);
      netGrossInput.value = fmtNum(netGross);
      netInput.value = fmtNum(net);
      updateTotals();
    }
    [crateCountInput, crateWeightInput, palletWeightInput, grossInput, iceInput].forEach(el => {
      el.addEventListener('input', recalc);
    });
    recalc();

    // Remove
    $('.remove-pallet', node).addEventListener('click', () => {
      if (!confirm('Pallet verwijderen?')) return;
      const idx = pallets.findIndex(p => p.id === id);
      if (idx !== -1) pallets.splice(idx, 1);
      node.remove();
      reindexPallets();
      updateTotals();
    });

    $('#pallets').appendChild(node);
    pallets.push({ id, node, state: palletState });
    reindexPallets();
    updateTotals();
    return node;
  }

  function reindexPallets() {
    $$('#pallets .pallet').forEach((el, i) => {
      $('.pallet-index', el).textContent = String(i + 1);
    });
  }

  function readPalletFromNode(p) {
    const n = p.node;
    const quality = $('.quality-btn.active', n)?.dataset.q || '';
    const crateCount = parseFloat($('.crateCount', n).value) || 0;
    const crateWeight = parseFloat($('.crateWeight', n).value) || 0;
    const palletWeight = parseFloat($('.palletWeight', n).value) || 0;
    const grossWeight = parseFloat($('.grossWeight', n).value) || 0;
    let icePercent = parseFloat($('.icePercent', n).value) || 0;
    if (icePercent < 0) icePercent = 0;
    if (icePercent > 100) icePercent = 100;
    const netGross = grossWeight - (crateCount * crateWeight) - palletWeight;
    const iceDeduction = netGross * (icePercent / 100);
    const netWeight = netGross - iceDeduction;
    return {
      id: p.id,
      crateCount,
      crateWeight,
      palletWeight,
      grossWeight,
      icePercent,
      netGross: Math.round(netGross * 100) / 100,
      iceDeduction: Math.round(iceDeduction * 100) / 100,
      netWeight: Math.round(netWeight * 100) / 100,
      species: $('.species', n).value,
      size: $('.size', n).value,
      quality,
      temperature: $('.temperature', n).value === '' ? null : parseFloat($('.temperature', n).value),
      temperatureRaw: $('.temperature', n).value,
      crateWeightRaw: $('.crateWeight', n).value,
      palletWeightRaw: $('.palletWeight', n).value,
      grossWeightRaw: $('.grossWeight', n).value,
      crateCountRaw: $('.crateCount', n).value,
      icePercentRaw: $('.icePercent', n).value,
      notes: $('.notes', n).value.trim(),
      photo: p.state.photo,
    };
  }

  function updateTotals() {
    let net = 0;
    pallets.forEach(p => {
      const data = readPalletFromNode(p);
      net += data.netWeight || 0;
    });
    $('#totalPallets').textContent = pallets.length;
    $('#totalNet').textContent = fmtNum(net);
  }

  // ------- Save receipt -------
  function validatePallets(palletsData) {
    if (palletsData.length === 0) return 'Voeg minstens één pallet toe.';
    for (let i = 0; i < palletsData.length; i++) {
      const p = palletsData[i];
      const tag = `Pallet ${i + 1}`;
      if (p.crateCountRaw === '' || p.crateCount <= 0) return `${tag}: vul aantal bakken in.`;
      if (p.crateWeightRaw === '') return `${tag}: vul gewicht lege bak in.`;
      if (p.palletWeightRaw === '') return `${tag}: vul gewicht lege pallet in.`;
      if (p.grossWeightRaw === '' || p.grossWeight <= 0) return `${tag}: vul brutogewicht in.`;
      if (p.icePercentRaw === '') return `${tag}: vul ijs percentage in (0 als geen ijs).`;
      if (!p.species) return `${tag}: kies een vissoort.`;
      if (!p.size) return `${tag}: kies een size.`;
      if (p.temperatureRaw === '' || p.temperature === null) return `${tag}: vul temperatuur in.`;
      if (!p.quality) return `${tag}: kies een kwaliteitsklasse.`;
      if (!p.photo) return `${tag}: voeg een foto toe.`;
      if (p.netWeight <= 0) return `${tag}: nettogewicht moet groter dan 0 zijn.`;
    }
    return null;
  }

  function validateMeta() {
    if (!$('#receiptDateTime').value) return 'Vul datum en tijd in.';
    if (!$('#supplier').value) return 'Kies een leverancier.';
    if (!$('#deliveryNumber').value.trim()) return 'Vul het leveringsnummer in.';
    return null;
  }

  function saveCurrentReceipt() {
    const metaErr = validateMeta();
    if (metaErr) { toast(metaErr, 'error'); return; }
    const palletsData = pallets.map(readPalletFromNode);
    const err = validatePallets(palletsData);
    if (err) { toast(err, 'error'); return; }

    const cleanedPallets = palletsData.map(p => {
      const { temperatureRaw, crateWeightRaw, palletWeightRaw, grossWeightRaw, crateCountRaw, icePercentRaw, ...rest } = p;
      return rest;
    });

    const receipt = {
      id: 'r' + Date.now().toString(36),
      dateTime: $('#receiptDateTime').value || nowLocalIso(),
      supplier: $('#supplier').value,
      deliveryNumber: $('#deliveryNumber').value.trim(),
      pallets: cleanedPallets,
      createdAt: new Date().toISOString(),
    };

    const receipts = loadReceipts();
    receipts.unshift(receipt);
    saveReceipts(receipts);

    if (settings.sheetWebhookUrl) {
      toast('Opslaan + synchroniseren...', 'success');
      trySync(receipt).then(res => {
        if (res.synced) toast('Opgeslagen & in Google Sheet gezet', 'success');
        else toast('Opgeslagen — in wachtrij voor sync', 'error');
      });
    } else {
      toast('Ontvangst opgeslagen', 'success');
    }
    resetForm();
  }

  function resetForm() {
    pallets = [];
    $('#pallets').innerHTML = '';
    populateSupplierSelect('');
    $('#deliveryNumber').value = '';
    $('#receiptDateTime').value = nowLocalIso();
    addPallet();
    updateTotals();
  }

  // ------- History -------
  function renderHistory() {
    const list = $('#historyList');
    const search = $('#historySearch').value.trim().toLowerCase();
    const receipts = loadReceipts().filter(r => {
      if (!search) return true;
      const hay = [
        r.supplier,
        r.deliveryNumber,
        ...r.pallets.flatMap(p => [p.species, p.size, p.notes, p.quality]),
      ].join(' ').toLowerCase();
      return hay.includes(search);
    });

    if (receipts.length === 0) {
      list.innerHTML = '<div class="empty-state">Nog geen ontvangsten geregistreerd.</div>';
      return;
    }

    list.innerHTML = '';
    receipts.forEach(r => {
      const totalNet = r.pallets.reduce((s, p) => s + (p.netWeight || 0), 0);
      const speciesList = Array.from(new Set(r.pallets.map(p => p.species))).join(', ');
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div class="meta">
          <div class="date">${fmtDateTime(r.dateTime)}${r.deliveryNumber ? ' • #' + escapeHtml(r.deliveryNumber) : ''}</div>
          <div class="info">${r.supplier ? escapeHtml(r.supplier) + ' • ' : ''}${escapeHtml(speciesList)}</div>
        </div>
        <div class="totals">
          <strong>${fmtNum(totalNet)} kg</strong>
          ${r.pallets.length} pallet${r.pallets.length === 1 ? '' : 's'}
        </div>
      `;
      item.addEventListener('click', () => openDetail(r.id));
      list.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function openDetail(id) {
    const receipt = loadReceipts().find(r => r.id === id);
    if (!receipt) return;
    const totalNet = receipt.pallets.reduce((s, p) => s + (p.netWeight || 0), 0);
    $('#detailTitle').textContent = 'Ontvangst — ' + fmtDateTime(receipt.dateTime);
    const body = $('#detailBody');
    body.innerHTML = `
      <div style="margin-bottom:1rem">
        ${receipt.supplier ? `<div><span style="color:var(--text-muted)">Leverancier:</span> <strong>${escapeHtml(receipt.supplier)}</strong></div>` : ''}
        ${receipt.deliveryNumber ? `<div><span style="color:var(--text-muted)">Leveringsnummer:</span> <strong>${escapeHtml(receipt.deliveryNumber)}</strong></div>` : ''}
        <div><span style="color:var(--text-muted)">Totaal netto:</span> <strong>${fmtNum(totalNet)} kg</strong> (${receipt.pallets.length} pallets)</div>
      </div>
      ${receipt.pallets.map((p, i) => `
        <div class="detail-pallet">
          <h4>Pallet ${i + 1} — ${escapeHtml(p.species)}${p.size ? ' (size ' + escapeHtml(p.size) + ')' : ''} <span class="quality-badge ${p.quality}">${p.quality}</span></h4>
          <div class="detail-grid">
            <div><span>Aantal bakken</span><strong>${p.crateCount}</strong></div>
            <div><span>Gewicht lege bak</span><strong>${fmtNum(p.crateWeight)} kg</strong></div>
            <div><span>Gewicht lege pallet</span><strong>${fmtNum(p.palletWeight ?? 0)} kg</strong></div>
            <div><span>Bruto</span><strong>${fmtNum(p.grossWeight)} kg</strong></div>
            <div><span>Netto bruto</span><strong>${fmtNum(p.netGross ?? p.netWeight)} kg</strong></div>
            <div><span>IJs</span><strong>${fmtNum(p.icePercent ?? 0, 1)} % (−${fmtNum(p.iceDeduction ?? 0)} kg)</strong></div>
            <div><span>Netto vis</span><strong>${fmtNum(p.netWeight)} kg</strong></div>
            <div><span>Temperatuur</span><strong>${p.temperature !== null && p.temperature !== undefined ? fmtNum(p.temperature, 1) + ' °C' : '—'}</strong></div>
          </div>
          ${p.notes ? `<div style="margin-top:.5rem;font-size:.9rem"><span style="color:var(--text-muted)">Notitie:</span> ${escapeHtml(p.notes)}</div>` : ''}
          ${p.photo ? `<img class="detail-photo" src="${p.photo}" alt="Pallet foto" data-full="1">` : ''}
        </div>
      `).join('')}
      <div class="detail-actions">
        <button class="btn danger" id="deleteReceiptBtn">Verwijderen</button>
        <button class="btn secondary" id="closeDetailFootBtn" style="margin-left:auto">Sluiten</button>
      </div>
    `;
    $('#detailModal').classList.remove('hidden');

    $$('.detail-photo', body).forEach(img => {
      img.addEventListener('click', () => openPhoto(img.src));
    });
    $('#deleteReceiptBtn').addEventListener('click', () => {
      if (!confirm('Deze ontvangst verwijderen?')) return;
      const remaining = loadReceipts().filter(r => r.id !== id);
      saveReceipts(remaining);
      closeDetail();
      renderHistory();
      toast('Verwijderd', 'success');
    });
    $('#closeDetailFootBtn').addEventListener('click', closeDetail);
  }

  function closeDetail() {
    $('#detailModal').classList.add('hidden');
  }

  function openPhoto(src) {
    $('#photoFull').src = src;
    $('#photoModal').classList.remove('hidden');
  }
  function closePhoto() {
    $('#photoModal').classList.add('hidden');
    $('#photoFull').src = '';
  }

  // ------- Settings -------
  function renderSettings() {
    $('#defaultCrateWeight').value = settings.defaultCrateWeight;
    $('#defaultCrateCount').value = settings.defaultCrateCount;
    $('#defaultPalletWeight').value = settings.defaultPalletWeight;
    $('#defaultIcePercent').value = settings.defaultIcePercent;
    $('#sheetWebhookUrl').value = settings.sheetWebhookUrl || '';
    $('#sheetIncludePhoto').checked = !!settings.sheetIncludePhoto;
    updateSyncBadge();
    renderChipList('#speciesList', 'species');
    renderChipList('#suppliersList', 'suppliers');
    renderChipList('#sizesList', 'sizes');
    const current = $('#supplier')?.value || '';
    populateSupplierSelect(settings.suppliers.includes(current) ? current : '');
    $$('#pallets .pallet').forEach(node => {
      const sel = $('.size', node);
      if (sel) populateSizeSelect(sel, settings.sizes.includes(sel.value) ? sel.value : '');
    });
  }

  function renderChipList(containerSel, settingsKey) {
    const list = $(containerSel);
    if (!list) return;
    list.innerHTML = '';
    const items = settings[settingsKey] || [];
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted);font-size:.85rem';
      empty.textContent = 'Nog geen items toegevoegd.';
      list.appendChild(empty);
      return;
    }
    items.forEach(s => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(s)} <button aria-label="Verwijder ${escapeHtml(s)}">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        settings[settingsKey] = settings[settingsKey].filter(x => x !== s);
        saveSettings();
        renderSettings();
      });
      list.appendChild(chip);
    });
  }

  // ------- CSV export -------
  function exportCsv() {
    const receipts = loadReceipts();
    if (receipts.length === 0) { toast('Geen data om te exporteren', 'error'); return; }
    const header = [
      'Ontvangst ID', 'Datum/tijd', 'Leverancier', 'Leveringsnummer', 'Pallet', 'Vissoort', 'Size',
      'Kwaliteit', 'Aantal bakken', 'Gewicht lege bak (kg)', 'Gewicht lege pallet (kg)',
      'Bruto (kg)', 'Netto bruto (kg)', 'IJs (%)', 'IJs aftrek (kg)', 'Netto vis (kg)',
      'Temperatuur (°C)', 'Notitie'
    ];
    const rows = [header];
    receipts.forEach(r => {
      r.pallets.forEach((p, i) => {
        rows.push([
          r.id,
          fmtDateTime(r.dateTime),
          r.supplier || '',
          r.deliveryNumber || '',
          i + 1,
          p.species,
          p.size || '',
          p.quality,
          p.crateCount,
          fmtNum(p.crateWeight),
          fmtNum(p.palletWeight ?? 0),
          fmtNum(p.grossWeight),
          fmtNum(p.netGross ?? p.netWeight),
          fmtNum(p.icePercent ?? 0, 1),
          fmtNum(p.iceDeduction ?? 0),
          fmtNum(p.netWeight),
          p.temperature !== null && p.temperature !== undefined ? fmtNum(p.temperature, 1) : '',
          (p.notes || '').replace(/[\r\n]+/g, ' '),
        ]);
      });
    });
    const csv = rows.map(r => r.map(cellCsv).join(';')).join('\r\n');
    download('vis-ontvangst-' + new Date().toISOString().slice(0, 10) + '.csv',
      '\uFEFF' + csv, 'text/csv;charset=utf-8');
  }

  function cellCsv(v) {
    const s = String(v ?? '');
    if (/[";\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ------- Boot -------
  function bindEvents() {
    $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
    $('#addPalletBtn').addEventListener('click', () => addPallet());
    $('#saveReceiptBtn').addEventListener('click', saveCurrentReceipt);
    $('#closeDetailBtn').addEventListener('click', closeDetail);
    $('#closePhotoBtn').addEventListener('click', closePhoto);
    $('#detailModal').addEventListener('click', e => {
      if (e.target.id === 'detailModal') closeDetail();
    });
    $('#photoModal').addEventListener('click', e => {
      if (e.target.id === 'photoModal') closePhoto();
    });
    $('#historySearch').addEventListener('input', renderHistory);
    $('#exportCsvBtn').addEventListener('click', exportCsv);

    $('#defaultCrateWeight').addEventListener('change', e => {
      settings.defaultCrateWeight = parseFloat(e.target.value) || 0;
      saveSettings();
    });
    $('#defaultCrateCount').addEventListener('change', e => {
      settings.defaultCrateCount = parseInt(e.target.value, 10) || 0;
      saveSettings();
    });
    $('#defaultPalletWeight').addEventListener('change', e => {
      settings.defaultPalletWeight = parseFloat(e.target.value) || 0;
      saveSettings();
    });
    $('#defaultIcePercent').addEventListener('change', e => {
      let v = parseFloat(e.target.value) || 0;
      if (v < 0) v = 0;
      if (v > 100) v = 100;
      settings.defaultIcePercent = v;
      saveSettings();
    });
    $('#sheetWebhookUrl').addEventListener('input', e => {
      settings.sheetWebhookUrl = e.target.value.trim();
      saveSettings();
    });
    $('#sheetIncludePhoto').addEventListener('change', e => {
      settings.sheetIncludePhoto = e.target.checked;
      saveSettings();
    });
    $('#testWebhookBtn').addEventListener('click', async () => {
      const url = (settings.sheetWebhookUrl || '').trim();
      if (!url) { toast('Vul eerst de webhook-URL in', 'error'); return; }
      toast('Verbinding testen...', '');
      try {
        const resp = await fetch(url, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ test: true }),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json().catch(() => ({}));
        toast(data.status === 'ok' ? 'Verbinding OK' : 'Reactie ontvangen', 'success');
      } catch (err) {
        toast('Test mislukt: ' + err.message, 'error');
      }
    });
    $('#flushQueueBtn').addEventListener('click', flushQueue);
    $('#addSpeciesBtn').addEventListener('click', () => {
      const v = $('#newSpecies').value.trim();
      if (!v) return;
      if (settings.species.some(s => s.toLowerCase() === v.toLowerCase())) {
        toast('Bestaat al', 'error');
        return;
      }
      settings.species.push(v);
      saveSettings();
      $('#newSpecies').value = '';
      renderSettings();
    });
    $('#newSpecies').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#addSpeciesBtn').click(); }
    });

    $('#addSizeBtn').addEventListener('click', () => {
      const v = $('#newSize').value.trim();
      if (!v) return;
      if (settings.sizes.some(s => s.toLowerCase() === v.toLowerCase())) {
        toast('Bestaat al', 'error');
        return;
      }
      settings.sizes.push(v);
      saveSettings();
      $('#newSize').value = '';
      renderSettings();
      $$('#pallets .pallet').forEach(node => {
        const sel = $('.size', node);
        populateSizeSelect(sel, sel.value);
      });
    });
    $('#newSize').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#addSizeBtn').click(); }
    });

    $('#addSupplierBtn').addEventListener('click', () => {
      const v = $('#newSupplier').value.trim();
      if (!v) return;
      if (settings.suppliers.some(s => s.toLowerCase() === v.toLowerCase())) {
        toast('Bestaat al', 'error');
        return;
      }
      settings.suppliers.push(v);
      settings.suppliers.sort((a, b) => a.localeCompare(b, 'nl'));
      saveSettings();
      $('#newSupplier').value = '';
      renderSettings();
      const currentSupplier = $('#supplier').value;
      populateSupplierSelect(currentSupplier);
    });
    $('#newSupplier').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#addSupplierBtn').click(); }
    });

    $('#exportAllBtn').addEventListener('click', () => {
      const data = { settings, receipts: loadReceipts() };
      download('vis-ontvangst-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(data, null, 2), 'application/json');
    });
    $('#clearAllBtn').addEventListener('click', () => {
      if (!confirm('Alle ontvangsten en instellingen verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
      localStorage.removeItem(STORAGE_KEYS.receipts);
      localStorage.removeItem(STORAGE_KEYS.settings);
      settings = loadSettings();
      toast('Alles verwijderd', 'success');
      resetForm();
      renderSettings();
    });
  }

  function init() {
    bindEvents();
    $('#receiptDateTime').value = nowLocalIso();
    populateSupplierSelect('');
    addPallet();
    renderSettings();
    window.addEventListener('online', () => {
      if (settings.sheetWebhookUrl && loadQueue().length) flushQueue();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
