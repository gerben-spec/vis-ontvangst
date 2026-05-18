/* Vis Ontvangst Registratie Tool */
(function () {
  'use strict';

  const STORAGE_KEYS = {
    receipts: 'vor.receipts',
    settings: 'vor.settings',
    syncQueue: 'vor.syncQueue',
  };

  const DEFAULT_SUPPLIERS = [
    'MARISA26',
    'JONATHAN ALLI26',
    'VAYU26',
    'SSC26',
    'SERGIO 26',
    'ANSU26',
    'TANDOR26',
    'ANNEGRE26',
    'VIERGEBROEDERS26',
    'PETRA26',
  ];

  const DEFAULT_SPECIES = [
    '1-KANDRA',
    '2-LANE SNAPPER',
    '4-BOTERVIS',
    '5-CROAKER',
    '7-BARRACUDA',
    '8-MAKREEL',
    '9-POJO',
    '10-YARABAKKA',
    '11-RIEMVIS',
    '13-GRUNTS',
    '14-WIT WITTIE',
    '15-BANG BANG',
    '18-COBIA/KABELJAUW',
    '19-SILVER SNAPPER',
    '22-RED SNAPPER',
    '24-DAGOETIFI',
    '25-CREVALLY JACK',
    '30-MELKVIS',
    '32-HERRING',
    '40-BLUE FISH',
    '41-SILVER POMFRET',
    '90-GREEN SNAPPER',
    '98-BARBAMAN',
    '100-POES',
    '101-KOEPILA',
    'KK-KUMAKUMA',
    '102-KODOKOE',
    '180-BLAKKA FREE',
    '200-POMPIDOE',
    '300-SPARI',
    '724-PORGY',
    'GARN-GARNALEN',
    'INK-INKVIS',
    'GLUE-GLUE',
  ];

  const DEFAULT_SETTINGS = {
    defaultCrateWeight: 2.0,
    defaultCrateCount: 20,
    defaultPalletWeight: 25,
    defaultIcePercent: 0,
    species: DEFAULT_SPECIES.slice(),
    suppliers: DEFAULT_SUPPLIERS.slice(),
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
  function buildSheetPayload(receipt, startIndex = 1) {
    return {
      receiptId: receipt.id,
      dateTime: receipt.dateTime,
      supplier: receipt.supplier || '',
      deliveryNumber: receipt.deliveryNumber || '',
      createdAt: receipt.createdAt,
      pallets: receipt.pallets.map((p, i) => ({
        palletIndex: startIndex + i,
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
        boatName: p.boatName || '',
        unloadLocation: p.unloadLocation || '',
        registrationNr: p.registrationNr || '',
        licenceNr: p.licenceNr || '',
        departureDate: p.departureDate || '',
        arrivalDate: p.arrivalDate || '',
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

  async function trySync(receipt, startIndex = 1) {
    if (!settings.sheetWebhookUrl) return { synced: false, reason: 'disabled' };
    try {
      await postToSheet(buildSheetPayload(receipt, startIndex));
      return { synced: true };
    } catch (err) {
      const q = loadQueue();
      if (!q.find(r => r.id === receipt.id)) q.push({ ...receipt, _startIndex: startIndex });
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
        const startIndex = receipt._startIndex || 1;
        const { _startIndex, ...cleanReceipt } = receipt;
        await postToSheet(buildSheetPayload(cleanReceipt, startIndex));
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

  function correctionTotals(receipt) {
    const list = (receipt && receipt.corrections) || [];
    return list.reduce((acc, c) => ({
      crates: acc.crates + (Number(c.crateCount) || 0),
      kg: acc.kg + (Number(c.netWeight) || 0),
    }), { crates: 0, kg: 0 });
  }

  function palletsNet(receipt) {
    return (receipt.pallets || []).reduce((s, p) => s + (Number(p.netWeight) || 0), 0);
  }

  function netAfterCorrections(receipt) {
    return palletsNet(receipt) - correctionTotals(receipt).kg;
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

  function fmtDate(iso) {
    if (!iso) return '';
    // yyyy-mm-dd → dd-mm-yyyy (avoid timezone shifts)
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('nl-NL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
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
    $('.boatName', node).value = preset?.boatName ?? '';
    $('.unloadLocation', node).value = preset?.unloadLocation ?? '';
    $('.registrationNr', node).value = preset?.registrationNr ?? '';
    $('.licenceNr', node).value = preset?.licenceNr ?? '';
    $('.departureDate', node).value = preset?.departureDate ?? '';
    $('.arrivalDate', node).value = preset?.arrivalDate ?? '';

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
      boatName: $('.boatName', n).value.trim(),
      unloadLocation: $('.unloadLocation', n).value.trim(),
      registrationNr: $('.registrationNr', n).value.trim(),
      licenceNr: $('.licenceNr', n).value.trim(),
      departureDate: $('.departureDate', n).value,
      arrivalDate: $('.arrivalDate', n).value,
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

    const supplier = $('#supplier').value;
    const deliveryNumber = $('#deliveryNumber').value.trim();
    const dateTime = $('#receiptDateTime').value || nowLocalIso();

    const receipts = loadReceipts();
    const matchKey = (s, d) => `${(s || '').trim().toLowerCase()}||${(d || '').trim().toLowerCase()}`;
    const targetKey = matchKey(supplier, deliveryNumber);
    const existingIdx = receipts.findIndex(r => matchKey(r.supplier, r.deliveryNumber) === targetKey);

    let receipt, isMerge, startIndex;
    if (existingIdx >= 0) {
      const existing = receipts[existingIdx];
      startIndex = (existing.pallets ? existing.pallets.length : 0) + 1;
      existing.pallets = (existing.pallets || []).concat(cleanedPallets);
      existing.lastUpdatedAt = new Date().toISOString();
      receipts.splice(existingIdx, 1);
      receipts.unshift(existing);
      receipt = existing;
      isMerge = true;
    } else {
      receipt = {
        id: 'r' + Date.now().toString(36),
        dateTime,
        supplier,
        deliveryNumber,
        pallets: cleanedPallets,
        createdAt: new Date().toISOString(),
      };
      receipts.unshift(receipt);
      startIndex = 1;
      isMerge = false;
    }
    saveReceipts(receipts);

    const syncReceipt = isMerge
      ? { ...receipt, pallets: cleanedPallets }
      : receipt;

    if (settings.sheetWebhookUrl) {
      toast(isMerge ? `${cleanedPallets.length} pallet(s) toegevoegd — sync...` : 'Opslaan + synchroniseren...', 'success');
      trySync(syncReceipt, startIndex).then(res => {
        if (res.synced) toast(isMerge ? 'Pallets toegevoegd & in Google Sheet gezet' : 'Opgeslagen & in Google Sheet gezet', 'success');
        else toast('Opgeslagen — in wachtrij voor sync', 'error');
      });
    } else {
      toast(isMerge ? `${cleanedPallets.length} pallet(s) toegevoegd aan bestaande levering` : 'Ontvangst opgeslagen', 'success');
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
      const totalNet = netAfterCorrections(r);
      const corr = correctionTotals(r);
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
          ${r.pallets.length} pallet${r.pallets.length === 1 ? '' : 's'}${corr.kg > 0 ? ` • <span class="corr-tag">−${fmtNum(corr.kg)} kg corr.</span>` : ''}
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
    const palletsTotal = palletsNet(receipt);
    const corr = correctionTotals(receipt);
    const totalNet = palletsTotal - corr.kg;
    const corrections = receipt.corrections || [];
    $('#detailTitle').textContent = 'Ontvangst — ' + fmtDateTime(receipt.dateTime);
    const body = $('#detailBody');

    const speciesOptions = ['<option value="">Kies vissoort...</option>']
      .concat((settings.species || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`))
      .join('');
    const sizeOptions = ['<option value="">Kies size...</option>']
      .concat((settings.sizes || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`))
      .join('');

    body.innerHTML = `
      <div style="margin-bottom:1rem">
        ${receipt.supplier ? `<div><span style="color:var(--text-muted)">Leverancier:</span> <strong>${escapeHtml(receipt.supplier)}</strong></div>` : ''}
        ${receipt.deliveryNumber ? `<div><span style="color:var(--text-muted)">Leveringsnummer:</span> <strong>${escapeHtml(receipt.deliveryNumber)}</strong></div>` : ''}
        <div><span style="color:var(--text-muted)">Pallets netto:</span> <strong>${fmtNum(palletsTotal)} kg</strong> (${receipt.pallets.length} pallets)</div>
        ${corr.kg > 0 ? `<div><span style="color:var(--text-muted)">Correcties:</span> <strong style="color:#c00">−${fmtNum(corr.kg)} kg</strong></div>` : ''}
        <div><span style="color:var(--text-muted)">Netto totaal:</span> <strong>${fmtNum(totalNet)} kg</strong></div>
      </div>
      ${receipt.pallets.map((p, i) => {
        const hasVangst = p.boatName || p.unloadLocation || p.registrationNr || p.licenceNr || p.departureDate || p.arrivalDate;
        return `
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
          ${hasVangst ? `
            <div class="detail-vangst">
              <h5>Vangstgegevens</h5>
              <div class="detail-grid">
                ${p.boatName ? `<div><span>Bootnaam</span><strong>${escapeHtml(p.boatName)}</strong></div>` : ''}
                ${p.unloadLocation ? `<div><span>Losplaats</span><strong>${escapeHtml(p.unloadLocation)}</strong></div>` : ''}
                ${p.registrationNr ? `<div><span>Registratie Nr</span><strong>${escapeHtml(p.registrationNr)}</strong></div>` : ''}
                ${p.licenceNr ? `<div><span>Licence Nr</span><strong>${escapeHtml(p.licenceNr)}</strong></div>` : ''}
                ${p.departureDate ? `<div><span>Vertrek vangst</span><strong>${escapeHtml(fmtDate(p.departureDate))}</strong></div>` : ''}
                ${p.arrivalDate ? `<div><span>Aankomst vangst</span><strong>${escapeHtml(fmtDate(p.arrivalDate))}</strong></div>` : ''}
              </div>
            </div>
          ` : ''}
          ${p.notes ? `<div style="margin-top:.5rem;font-size:.9rem"><span style="color:var(--text-muted)">Notitie:</span> ${escapeHtml(p.notes)}</div>` : ''}
          ${p.photo ? `<img class="detail-photo" src="${p.photo}" alt="Pallet foto" data-full="1">` : ''}
        </div>
      `;}).join('')}

      <div class="corrections-section">
        <h3>Correcties${corrections.length ? ` (${corrections.length})` : ''}</h3>
        ${corrections.length === 0 ? '<p style="color:var(--text-muted);margin:.5rem 0">Geen correcties.</p>' : ''}
        ${corrections.map(c => `
          <div class="correction-item" data-cid="${c.id}">
            <div>
              <strong>${escapeHtml(c.reason || 'Correctie')}</strong> —
              ${escapeHtml(c.species || '')}${c.size ? ' (size ' + escapeHtml(c.size) + ')' : ''}
              <span style="color:#c00">−${fmtNum(c.netWeight)} kg</span>${c.crateCount ? ` • ${c.crateCount} bak(ken)` : ''}
              ${c.notes ? `<div style="font-size:.85rem;color:var(--text-muted)">${escapeHtml(c.notes)}</div>` : ''}
            </div>
            <button class="icon-btn delete-correction" aria-label="Verwijder correctie" data-cid="${c.id}">🗑</button>
          </div>
        `).join('')}
        <button class="btn secondary" id="toggleCorrectionFormBtn" type="button">+ Correctie toevoegen</button>
        <div id="correctionForm" class="correction-form hidden">
          <div class="row">
            <label class="field grow">
              <span>Vissoort</span>
              <select id="corrSpecies">${speciesOptions}</select>
            </label>
            <label class="field">
              <span>Size</span>
              <select id="corrSize">${sizeOptions}</select>
            </label>
          </div>
          <label class="field">
            <span>Reden</span>
            <input type="text" id="corrReason" list="corrReasonList" placeholder="bv. bedorven, weeg-correctie" />
            <datalist id="corrReasonList">
              <option value="Bedorven"></option>
              <option value="Weeg-correctie"></option>
              <option value="Beschadigde verpakking"></option>
              <option value="Verkeerd ingevoerd"></option>
            </datalist>
          </label>
          <div class="row">
            <label class="field">
              <span>Aantal bakken (optioneel)</span>
              <input type="number" id="corrCrates" min="0" step="1" inputmode="numeric" />
            </label>
            <label class="field grow">
              <span>Kg af te trekken <em class="req">*</em></span>
              <input type="number" id="corrKg" min="0" step="0.01" inputmode="decimal" />
            </label>
          </div>
          <label class="field">
            <span>Notitie (optioneel)</span>
            <textarea id="corrNotes" rows="2" placeholder="Toelichting..."></textarea>
          </label>
          <div class="row" style="margin-top:.5rem">
            <button class="btn secondary" id="cancelCorrectionBtn" type="button">Annuleren</button>
            <button class="btn primary" id="saveCorrectionBtn" type="button" style="margin-left:auto">Correctie opslaan</button>
          </div>
        </div>
      </div>

      <div class="detail-actions">
        <button class="btn danger" id="deleteReceiptBtn">Verwijderen</button>
        <button class="btn primary" id="shareWhatsAppBtn" style="margin-left:auto">Bon via WhatsApp</button>
        <button class="btn primary" id="printBonBtn">Bon als PDF</button>
        <button class="btn secondary" id="closeDetailFootBtn">Sluiten</button>
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
    $('#printBonBtn').addEventListener('click', async () => {
      const sig = await openSignatureModal(receipt);
      if (sig === 'abort') return;
      if (sig !== undefined) persistSignature(receipt, sig);
      printBon(receipt);
    });
    $('#shareWhatsAppBtn').addEventListener('click', async () => {
      const sig = await openSignatureModal(receipt);
      if (sig === 'abort') return;
      if (sig !== undefined) persistSignature(receipt, sig);
      shareBonWhatsApp(receipt);
    });
    $('#closeDetailFootBtn').addEventListener('click', closeDetail);

    // Correction form
    const toggleBtn = $('#toggleCorrectionFormBtn');
    const form = $('#correctionForm');
    if (toggleBtn && form) {
      toggleBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) {
          $('#corrSpecies').focus();
        }
      });
      $('#cancelCorrectionBtn').addEventListener('click', () => {
        form.classList.add('hidden');
        $('#corrSpecies').value = '';
        $('#corrSize').value = '';
        $('#corrReason').value = '';
        $('#corrCrates').value = '';
        $('#corrKg').value = '';
        $('#corrNotes').value = '';
      });
      $('#saveCorrectionBtn').addEventListener('click', () => addCorrection(id));
    }
    body.querySelectorAll('.delete-correction').forEach(btn => {
      btn.addEventListener('click', () => deleteCorrection(id, btn.dataset.cid));
    });
  }

  function addCorrection(receiptId) {
    const species = $('#corrSpecies').value;
    const size = $('#corrSize').value;
    const reason = $('#corrReason').value.trim();
    const crateCount = Number($('#corrCrates').value) || 0;
    const netWeight = Number($('#corrKg').value);
    const notes = $('#corrNotes').value.trim();

    if (!species) { toast('Kies een vissoort', 'error'); return; }
    if (!reason) { toast('Vul een reden in', 'error'); return; }
    if (!netWeight || netWeight <= 0) { toast('Vul kg af te trekken in (> 0)', 'error'); return; }

    const all = loadReceipts();
    const idx = all.findIndex(r => r.id === receiptId);
    if (idx === -1) return;
    if (!all[idx].corrections) all[idx].corrections = [];
    const correction = {
      id: 'c' + Date.now().toString(36),
      species, size, reason, crateCount, netWeight, notes,
      createdAt: new Date().toISOString(),
    };
    all[idx].corrections.push(correction);
    saveReceipts(all);

    if (settings.sheetWebhookUrl) {
      syncCorrection(all[idx], correction).then(res => {
        toast(res.synced ? 'Correctie opgeslagen & in Sheet gezet' : 'Correctie opgeslagen — sync mislukt', res.synced ? 'success' : 'error');
      });
    } else {
      toast('Correctie opgeslagen', 'success');
    }
    openDetail(receiptId);
    renderHistory();
  }

  function deleteCorrection(receiptId, correctionId) {
    if (!confirm('Deze correctie verwijderen?\n\nLet op: een eerder gesynchroniseerde regel in Google Sheets blijft staan; verwijder die handmatig indien nodig.')) return;
    const all = loadReceipts();
    const idx = all.findIndex(r => r.id === receiptId);
    if (idx === -1) return;
    all[idx].corrections = (all[idx].corrections || []).filter(c => c.id !== correctionId);
    saveReceipts(all);
    toast('Correctie verwijderd', 'success');
    openDetail(receiptId);
    renderHistory();
  }

  async function syncCorrection(receipt, correction) {
    if (!settings.sheetWebhookUrl) return { synced: false, reason: 'disabled' };
    const idxLabel = 'C' + (receipt.corrections || []).findIndex(c => c.id === correction.id) + 1;
    const payload = {
      receiptId: receipt.id,
      dateTime: receipt.dateTime,
      supplier: receipt.supplier || '',
      deliveryNumber: receipt.deliveryNumber || '',
      createdAt: receipt.createdAt,
      pallets: [{
        palletIndex: idxLabel,
        species: correction.species,
        size: correction.size || '',
        quality: 'CORRECTIE',
        crateCount: -(Number(correction.crateCount) || 0),
        crateWeight: 0,
        palletWeight: 0,
        grossWeight: 0,
        netGross: 0,
        icePercent: 0,
        iceDeduction: 0,
        netWeight: -(Number(correction.netWeight) || 0),
        temperature: '',
        notes: correction.reason + (correction.notes ? ' — ' + correction.notes : ''),
        photo: '',
      }],
    };
    try {
      await postToSheet(payload);
      return { synced: true };
    } catch (err) {
      return { synced: false, reason: err.message };
    }
  }

  function persistSignature(receipt, signature) {
    receipt.signature = signature;
    const all = loadReceipts();
    const idx = all.findIndex(r => r.id === receipt.id);
    if (idx !== -1) {
      all[idx].signature = signature;
      saveReceipts(all);
    }
  }

  let signaturePadInstance = null;

  function openSignatureModal(receipt) {
    return new Promise(resolve => {
      const modal = $('#signatureModal');
      const canvas = $('#signaturePad');

      if (typeof SignaturePad !== 'function') {
        toast('Handtekening-lib niet geladen, ga online en herlaad', 'error');
        resolve('abort');
        return;
      }

      modal.classList.remove('hidden');

      requestAnimationFrame(() => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(ratio, ratio);

        if (signaturePadInstance) signaturePadInstance.off();
        signaturePadInstance = new SignaturePad(canvas, {
          backgroundColor: 'rgba(255,255,255,0)',
          penColor: '#000',
          minWidth: 1,
          maxWidth: 2.5,
        });
        signaturePadInstance.clear();

        if (receipt.signature) {
          try { signaturePadInstance.fromDataURL(receipt.signature); } catch (e) { /* ignore */ }
        }
      });

      const cleanup = () => {
        modal.classList.add('hidden');
        if (signaturePadInstance) {
          signaturePadInstance.off();
          signaturePadInstance = null;
        }
        $('#clearSignatureBtn').removeEventListener('click', onClear);
        $('#skipSignatureBtn').removeEventListener('click', onSkip);
        $('#confirmSignatureBtn').removeEventListener('click', onConfirm);
        $('#closeSignatureBtn').removeEventListener('click', onClose);
      };

      const onClear = () => signaturePadInstance && signaturePadInstance.clear();
      const onSkip = () => { cleanup(); resolve(null); };
      const onConfirm = () => {
        if (!signaturePadInstance || signaturePadInstance.isEmpty()) {
          cleanup();
          resolve(null);
          return;
        }
        const dataUrl = signaturePadInstance.toDataURL('image/png');
        cleanup();
        resolve(dataUrl);
      };
      const onClose = () => { cleanup(); resolve('abort'); };

      $('#clearSignatureBtn').addEventListener('click', onClear);
      $('#skipSignatureBtn').addEventListener('click', onSkip);
      $('#confirmSignatureBtn').addEventListener('click', onConfirm);
      $('#closeSignatureBtn').addEventListener('click', onClose);
    });
  }

  function buildBonText(receipt) {
    const groups = groupPalletsForBon(receipt.pallets);
    const totalCrates = groups.reduce((s, g) => s + g.crates, 0);
    const totalNet = groups.reduce((s, g) => s + g.netWeight, 0);

    const lines = [];
    lines.push('*N.V. HOLSU — ONTVANGSTBON*');
    lines.push('');
    lines.push(`Bonnr: ${receipt.deliveryNumber || receipt.id || ''}`);
    lines.push(`Datum: ${fmtDateTime(receipt.dateTime)}`);
    lines.push(`Leverancier: ${receipt.supplier || ''}`);
    lines.push('');

    groups.forEach(g => {
      lines.push(`*${g.species}*${g.size ? ' (size ' + g.size + ')' : ''} [${g.quality || '-'}]`);
      lines.push(`  Bakken: ${g.crates} | Netto: ${fmtNum(g.netWeight)} kg${g.tempLabel ? ' | Temp: ' + g.tempLabel + '°C' : ''}`);
    });

    const palletNotes = receipt.pallets
      .map((p, i) => p.notes ? `  Pallet ${i + 1}: ${p.notes}` : '')
      .filter(Boolean);
    if (palletNotes.length) {
      lines.push('');
      lines.push('Opmerkingen:');
      palletNotes.forEach(n => lines.push(n));
    }

    lines.push('');
    lines.push(`*Totaal:* ${totalCrates} bakken — *${fmtNum(totalNet)} kg netto*`);

    return lines.join('\n');
  }

  function shareBonWhatsApp(receipt) {
    shareBonImage(receipt).catch(err => {
      console.warn('JPG share failed, fallback naar tekst:', err);
      shareBonText(receipt);
    });
  }

  function shareBonText(receipt) {
    const text = buildBonText(receipt);
    const title = `Ontvangstbon ${receipt.supplier || ''} ${receipt.deliveryNumber || ''}`.trim();
    if (navigator.share) {
      navigator.share({ text, title }).catch(err => {
        if (err && err.name === 'AbortError') return;
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      });
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  }

  async function shareBonImage(receipt) {
    if (typeof html2canvas !== 'function') {
      throw new Error('html2canvas niet beschikbaar');
    }

    renderBonInPrintArea(receipt);
    const area = $('#printArea');
    area.classList.add('rendering');

    const logoImg = area.querySelector('img');
    if (logoImg && !logoImg.complete) {
      await new Promise(res => {
        logoImg.addEventListener('load', res, { once: true });
        logoImg.addEventListener('error', res, { once: true });
      });
    }

    let blob, fileName;
    try {
      const canvas = await html2canvas(area, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
      blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
      const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
      fileName = [safe(receipt.supplier), safe(receipt.deliveryNumber)].filter(Boolean).join(' ') || 'Ontvangstbon';
      fileName += '.jpg';
    } finally {
      area.classList.remove('rendering');
    }

    if (!blob) throw new Error('Kon JPG niet genereren');

    const file = new File([blob], fileName, { type: 'image/jpeg' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Ontvangstbon',
          text: `Ontvangstbon ${receipt.supplier || ''} ${receipt.deliveryNumber || ''}`.trim(),
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        throw err;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('JPG gedownload — deel handmatig via WhatsApp', 'success');
  }

  function groupPalletsForBon(pallets) {
    const groups = new Map();
    pallets.forEach(p => {
      const key = `${p.species || ''}||${p.size || ''}`;
      if (!groups.has(key)) {
        groups.set(key, {
          species: p.species || '',
          size: p.size || '',
          qualities: new Set(),
          crates: 0,
          netWeight: 0,
          temps: [],
        });
      }
      const g = groups.get(key);
      if (p.quality) g.qualities.add(p.quality);
      g.crates += Number(p.crateCount) || 0;
      g.netWeight += Number(p.netWeight) || 0;
      if (p.temperature !== null && p.temperature !== undefined && p.temperature !== '') {
        const t = Number(p.temperature);
        if (!Number.isNaN(t)) g.temps.push(t);
      }
    });
    return Array.from(groups.values()).map(g => {
      let tempLabel = '';
      if (g.temps.length === 1) tempLabel = fmtNum(g.temps[0], 1);
      else if (g.temps.length > 1) {
        const min = Math.min(...g.temps);
        const max = Math.max(...g.temps);
        tempLabel = min === max ? fmtNum(min, 1) : `${fmtNum(min, 1)}–${fmtNum(max, 1)}`;
      }
      return {
        species: g.species,
        size: g.size,
        quality: Array.from(g.qualities).sort().join(', '),
        crates: g.crates,
        netWeight: g.netWeight,
        tempLabel,
      };
    }).sort((a, b) => a.species.localeCompare(b.species, 'nl') || a.size.localeCompare(b.size, 'nl'));
  }

  function renderBonInPrintArea(receipt) {
    const groups = groupPalletsForBon(receipt.pallets);
    const totalCrates = groups.reduce((s, g) => s + g.crates, 0);
    const palletsKg = groups.reduce((s, g) => s + g.netWeight, 0);
    const corrections = receipt.corrections || [];
    const corrTotalKg = corrections.reduce((s, c) => s + (Number(c.netWeight) || 0), 0);
    const corrTotalCrates = corrections.reduce((s, c) => s + (Number(c.crateCount) || 0), 0);
    const totalNet = palletsKg - corrTotalKg;
    const finalCrates = totalCrates - corrTotalCrates;

    const rows = groups.map(g => `
      <tr>
        <td>${escapeHtml(g.species)}</td>
        <td>${escapeHtml(g.size)}</td>
        <td>${escapeHtml(g.quality)}</td>
        <td class="num">${g.crates}</td>
        <td class="num">${fmtNum(g.netWeight)}</td>
        <td class="num">${g.tempLabel}</td>
      </tr>
    `).join('');

    const correctionsBlock = corrections.length ? `
      <h3 class="bon-section-title">Correcties</h3>
      <table class="bon-table bon-corr-table">
        <thead>
          <tr>
            <th>Reden</th>
            <th>Vissoort</th>
            <th>Size</th>
            <th class="num">Bakken</th>
            <th class="num">Kg</th>
          </tr>
        </thead>
        <tbody>
          ${corrections.map(c => `
            <tr class="corr-row">
              <td>${escapeHtml(c.reason || '')}</td>
              <td>${escapeHtml(c.species || '')}</td>
              <td>${escapeHtml(c.size || '')}</td>
              <td class="num">−${Number(c.crateCount) || 0}</td>
              <td class="num">−${fmtNum(c.netWeight)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Totaal correcties</td>
            <td class="num">−${corrTotalCrates}</td>
            <td class="num">−${fmtNum(corrTotalKg)}</td>
          </tr>
        </tfoot>
      </table>
    ` : '';

    const notes = receipt.pallets
      .map((p, i) => p.notes ? `<div><strong>Pallet ${i + 1}:</strong> ${escapeHtml(p.notes)}</div>` : '')
      .filter(Boolean)
      .join('');

    const bonNr = (receipt.deliveryNumber || receipt.id || '').toString();
    const printedAt = new Date().toLocaleString('nl-NL');

    $('#printArea').innerHTML = `
      <div class="bon-header">
        <div class="bon-logo">
          <img src="logo.png" alt="N.V. HOLSU" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'bon-logo-text',textContent:'N.V. HOLSU'}))">
        </div>
        <div class="bon-title">
          <h1>ONTVANGSTBON</h1>
          <div class="sub bon-datetime"><strong>${escapeHtml(fmtDateTime(receipt.dateTime))}</strong></div>
          <div class="sub">Bonnr: <strong>${escapeHtml(bonNr)}</strong></div>
          <div class="sub">Afdruk: ${escapeHtml(printedAt)}</div>
        </div>
      </div>

      <div class="bon-meta">
        <div><span class="label">Leverancier / Leveringsnr:</span> <strong>${escapeHtml(receipt.supplier || '')}${receipt.supplier && receipt.deliveryNumber ? ' — ' : ''}${escapeHtml(receipt.deliveryNumber || '')}</strong></div>
      </div>

      <table class="bon-table">
        <thead>
          <tr>
            <th>Vissoort</th>
            <th>Size</th>
            <th>Kw</th>
            <th class="num">Bakken</th>
            <th class="num">Kg</th>
            <th class="num">°C</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3">${corrections.length ? 'Subtotaal pallets' : 'Totaal'}</td>
            <td class="num">${totalCrates}</td>
            <td class="num">${fmtNum(palletsKg)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      ${correctionsBlock}

      ${corrections.length ? `
        <div class="bon-final-total">
          <span>NETTO TOTAAL:</span>
          <strong>${finalCrates} bakken &middot; ${fmtNum(totalNet)} kg</strong>
        </div>
      ` : ''}

      ${notes ? `<div class="bon-notes"><strong>Opmerkingen:</strong>${notes}</div>` : ''}

      <div class="bon-signatures one">
        <div class="sig-box">
          ${receipt.signature ? `<img class="sig-img" src="${receipt.signature}" alt="handtekening">` : ''}
          <div class="sig-label">Ontvangen door (naam + handtekening)</div>
        </div>
      </div>

      <div class="bon-footer">
        N.V. HOLSU &middot; Ontvangstbon &middot; Gegenereerd door Vis Ontvangst app
      </div>
    `;
  }

  function printBon(receipt) {
    renderBonInPrintArea(receipt);

    const originalTitle = document.title;
    const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
    const supplierPart = safe(receipt.supplier);
    const deliveryPart = safe(receipt.deliveryNumber);
    const fileName = [supplierPart, deliveryPart].filter(Boolean).join(' ') || 'Ontvangstbon';
    document.title = fileName;

    const restore = () => {
      document.title = originalTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    setTimeout(() => window.print(), 50);
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
    $('#deliveryNumber').addEventListener('input', e => {
      const cleaned = e.target.value.replace(/\D+/g, '');
      if (cleaned !== e.target.value) e.target.value = cleaned;
    });
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

    $('#importDefaultSuppliersBtn').addEventListener('click', () => {
      const existing = new Set(settings.suppliers.map(s => s.toLowerCase()));
      let added = 0;
      DEFAULT_SUPPLIERS.forEach(s => {
        if (!existing.has(s.toLowerCase())) {
          settings.suppliers.push(s);
          added++;
        }
      });
      settings.suppliers.sort((a, b) => a.localeCompare(b, 'nl'));
      saveSettings();
      renderSettings();
      const currentSupplier = $('#supplier').value;
      populateSupplierSelect(currentSupplier);
      toast(added === 0 ? 'Alle standaardleveranciers staan er al in' : added + ' leverancier(s) toegevoegd', 'success');
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
