/* =========================================================
   Plant-Based Content Planner — app.js
   Plain JS, no build step, no dependencies.
   Data persists to localStorage; JSON export/import for backup.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     Constants
     --------------------------------------------------------- */
  var LS_KEYWORDS = 'pbcp_keywords_v1';
  var LS_CONTENT = 'pbcp_content_v1';
  var LS_THEME = 'pbcp_theme_v1';
  var LS_DELETED_PHRASES = 'pbcp_deleted_keyword_phrases_v1';

  var STATUS_STAGES = ['Idea', 'Tested', 'Photographed', 'Drafted', 'Published (v1)', 'Refined (v2+)'];

  /* ---------------------------------------------------------
     Utilities
     --------------------------------------------------------- */
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Briefly highlights a freshly-added row/card, then removes the class.
  function flashElement(el) {
    if (!el) return;
    if (prefersReducedMotion()) return;
    el.classList.add('flash-add');
    el.addEventListener('animationend', function handler() {
      el.classList.remove('flash-add');
      el.removeEventListener('animationend', handler);
    });
  }

  // Fades an element out (unless reduced motion is on), then invokes the
  // callback to actually remove it from state and re-render.
  function removeWithFade(el, cls, cb) {
    if (!el || prefersReducedMotion()) { cb(); return; }
    el.classList.add(cls);
    setTimeout(cb, 180);
  }

  /* ---------------------------------------------------------
     State (loaded from / saved to localStorage)
     --------------------------------------------------------- */
  var state = {
    keywords: [],
    content: [],
    // "Tombstone" list of keyword phrases the user has deliberately deleted
    // from the Keyword Planner, kept separate from `keywords` so future CSV
    // imports can skip re-adding them. Each entry: { phrase, normPhrase, deletedAt }.
    deletedPhrases: []
  };

  function loadState() {
    try {
      var kw = localStorage.getItem(LS_KEYWORDS);
      state.keywords = kw ? JSON.parse(kw) : [];
    } catch (e) { state.keywords = []; }
    try {
      var ct = localStorage.getItem(LS_CONTENT);
      state.content = ct ? JSON.parse(ct) : [];
    } catch (e) { state.content = []; }
    try {
      var dp = localStorage.getItem(LS_DELETED_PHRASES);
      state.deletedPhrases = dp ? JSON.parse(dp) : [];
    } catch (e) { state.deletedPhrases = []; }
  }

  function saveKeywords() {
    localStorage.setItem(LS_KEYWORDS, JSON.stringify(state.keywords));
  }
  function saveContent() {
    localStorage.setItem(LS_CONTENT, JSON.stringify(state.content));
  }
  function saveDeletedPhrases() {
    localStorage.setItem(LS_DELETED_PHRASES, JSON.stringify(state.deletedPhrases));
  }

  // Same trim/lowercase normalization the CSV duplicate check and the
  // content-planner "already added" check use elsewhere in this file.
  function normalizePhrase(p) {
    return (p || '').trim().toLowerCase();
  }

  // Records phrases into the deleted-phrases tombstone list (deduped by
  // normalized phrase), so a future CSV import can skip them. Safe to call
  // with phrases already present — those are silently skipped.
  function addDeletedPhrases(phrases) {
    var existingNorm = {};
    state.deletedPhrases.forEach(function (d) { existingNorm[d.normPhrase] = true; });
    phrases.forEach(function (p) {
      var norm = normalizePhrase(p);
      if (!norm || existingNorm[norm]) return;
      state.deletedPhrases.push({ phrase: p.trim(), normPhrase: norm, deletedAt: todayISO() });
      existingNorm[norm] = true;
    });
    saveDeletedPhrases();
  }

  /* ---------------------------------------------------------
     Volume bucketing + decision engine
     --------------------------------------------------------- */
  // Parses a raw volume value (number, numeric string, or range-like
  // string such as "1K - 10K") into a numeric estimate, or null if
  // there's nothing usable.
  function parseVolumeToNumber(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return isNaN(raw) ? null : raw;
    var s = String(raw).trim();
    if (s === '' || s === '-' || s === '--') return null;

    // Range-like: "100 - 1K", "1K-10K", "10,000 - 100,000"
    var rangeMatch = s.split(/\s*[-–—]\s*/);
    if (rangeMatch.length === 2) {
      var a = parseSingleVolumeToken(rangeMatch[0]);
      var b = parseSingleVolumeToken(rangeMatch[1]);
      if (a !== null && b !== null) return (a + b) / 2;
      if (a !== null) return a;
      if (b !== null) return b;
    }
    return parseSingleVolumeToken(s);
  }

  function parseSingleVolumeToken(tok) {
    if (tok === null || tok === undefined) return null;
    var s = String(tok).trim().replace(/,/g, '');
    if (s === '') return null;
    var mult = 1;
    var lower = s.toLowerCase();
    if (lower.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
    else if (lower.endsWith('m')) { mult = 1000000; s = s.slice(0, -1); }
    var n = parseFloat(s);
    if (isNaN(n)) return null;
    return n * mult;
  }

  // Buckets a numeric volume into one of the five spec buckets.
  // Returns null if num is null (i.e. genuinely unset).
  function bucketVolume(num) {
    if (num === null || num === undefined || isNaN(num)) return null;
    if (num <= 0) return '0';
    if (num < 100) return '10-100';
    if (num < 1000) return '100-1K';
    if (num < 10000) return '1K-10K';
    return '10K+';
  }

  function volumeBucketLabel(kw) {
    var num = parseVolumeToNumber(kw.volume);
    return bucketVolume(num);
  }

  // Cache of keyword id -> decision, populated only while renderKeywordsTab()
  // is actively rendering (see below). Repeated calls to computeDecision()
  // within a single render pass (counts, table rows, bulk-action eligibility,
  // SERP queue) then reuse the same computed value instead of recomputing it
  // from scratch each time. Always null outside of that window, so a render's
  // cache can never leak stale values into a later, unrelated read — every
  // call outside an active render still computes fresh from current data.
  var kwDecisionCache = null;

  function computeDecision(kw) {
    if (kwDecisionCache && Object.prototype.hasOwnProperty.call(kwDecisionCache, kw.id)) {
      return kwDecisionCache[kw.id];
    }
    return computeDecisionRaw(kw);
  }

  // Core decision rule table, per spec.
  function computeDecisionRaw(kw) {
    var bucket = volumeBucketLabel(kw);
    var competition = kw.competition;

    // Volume bucket 0 (no data) is always Skip, regardless of competition —
    // this must be checked before the "missing data" fallback below, since a
    // bucket of '0' is a truthy string and competition may legitimately be
    // blank/unset at the same time.
    if (bucket === null) return '—';
    if (bucket === '0') return 'Skip';
    if (!competition) return '—';

    if (bucket === '10-100') {
      if (competition === 'Low' || competition === 'Medium') {
        return kw.quick ? 'Go' : 'Maybe';
      }
      if (competition === 'High') {
        return kw.quick ? 'Maybe' : 'Skip';
      }
      return '—';
    }

    if (bucket === '100-1K' || bucket === '1K-10K' || bucket === '10K+') {
      return competition === 'High' ? 'Maybe' : 'Go';
    }

    return '—';
  }

  /* ---------------------------------------------------------
     Cluster suggestions (derived from actual data, not hardcoded)
     --------------------------------------------------------- */
  function getAllClusters() {
    var set = {};
    state.keywords.forEach(function (k) { if (k.cluster && k.cluster.trim()) set[k.cluster.trim()] = true; });
    state.content.forEach(function (c) { if (c.cluster && c.cluster.trim()) set[c.cluster.trim()] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function refreshClusterDatalists() {
    var clusters = getAllClusters();
    var html = clusters.map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join('');
    document.getElementById('cluster-suggestions').innerHTML = html;
    document.getElementById('cluster-suggestions-content').innerHTML = html;
  }

  function refreshKeywordDatalist() {
    var html = state.keywords.map(function (k) {
      return '<option value="' + escapeHtml(k.phrase) + '">';
    }).join('');
    document.getElementById('keyword-suggestions').innerHTML = html;
  }

  /* ---------------------------------------------------------
     Theme handling
     --------------------------------------------------------- */
  function applyTheme(pref) {
    var root = document.documentElement;
    if (pref === 'light' || pref === 'dark') {
      root.setAttribute('data-theme', pref);
    } else {
      root.removeAttribute('data-theme');
    }
    var label = pref === 'light' ? 'Light' : pref === 'dark' ? 'Dark' : 'System';
    var icon = pref === 'light' ? '☀️' : pref === 'dark' ? '🌙' : '🌓';
    document.getElementById('theme-label').textContent = label;
    document.getElementById('theme-icon').textContent = icon;
  }

  function initTheme() {
    var pref = localStorage.getItem(LS_THEME) || 'system';
    applyTheme(pref);
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var order = ['system', 'light', 'dark'];
      var current = localStorage.getItem(LS_THEME) || 'system';
      var next = order[(order.indexOf(current) + 1) % order.length];
      localStorage.setItem(LS_THEME, next);
      applyTheme(next);
    });
  }

  /* ---------------------------------------------------------
     Tabs
     --------------------------------------------------------- */
  function initTabs() {
    var tabButtons = [document.getElementById('tab-btn-keywords'), document.getElementById('tab-btn-content')];
    var panels = { 'tab-btn-keywords': document.getElementById('tab-keywords'), 'tab-btn-content': document.getElementById('tab-content') };

    function activate(btn) {
      tabButtons.forEach(function (b) {
        var selected = b === btn;
        b.setAttribute('aria-selected', String(selected));
        b.tabIndex = selected ? 0 : -1;
        panels[b.id].hidden = !selected;
      });
      btn.focus();
    }

    tabButtons.forEach(function (btn, i) {
      btn.addEventListener('click', function () { activate(btn); });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var next = e.key === 'ArrowRight' ? (i + 1) % tabButtons.length : (i - 1 + tabButtons.length) % tabButtons.length;
          activate(tabButtons[next]);
        }
      });
    });
  }

  /* ---------------------------------------------------------
     Toast
     --------------------------------------------------------- */
  var toastTimer;
  function showToast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }

  /* ---------------------------------------------------------
     Confirm dialog helper
     --------------------------------------------------------- */
  // opts: { label: string, danger: boolean }
  // label defaults to "Delete" and danger defaults to true, matching this
  // dialog's original delete-only behavior — pass both explicitly for any
  // non-destructive confirmation (send, update, etc.) so the button never
  // reads "Delete" (or shows red danger styling) for an action that isn't one.
  function confirmAction(message, onConfirm, opts) {
    opts = opts || {};
    var label = opts.label || 'Delete';
    var danger = opts.danger !== false;

    var dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-dialog-body').textContent = message;
    var okBtn = document.getElementById('confirm-ok-btn');
    okBtn.textContent = label;
    okBtn.classList.toggle('btn-danger', danger);
    okBtn.classList.toggle('btn-primary', !danger);
    dialog.showModal();
    var cancelBtn = document.getElementById('confirm-cancel-btn');

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onDialogClose);
    }
    function onOk(e) { e.preventDefault(); cleanup(); dialog.close(); onConfirm(); }
    function onCancel(e) { e.preventDefault(); cleanup(); dialog.close(); }
    // Covers dismissal via Escape (or any other native close) that bypasses
    // the button handlers above, so listeners never leak onto the next call.
    function onDialogClose() { cleanup(); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('close', onDialogClose);
  }

  /* ---------------------------------------------------------
     Shared bulk-select / bulk-delete controller
     Both tabs need identical "select all visible / select row / show
     selection count / bulk delete" behavior. This used to be hand-copied
     per tab, which is exactly how the Keyword tab's header checkbox fell
     out of sync with its filters (see Bug 1 in the audit) — one copy got
     touched, the other didn't. Now both tabs share one implementation,
     parameterized by which dataset and DOM ids they operate on, so a fix
     here can't drift between tabs again.
     --------------------------------------------------------- */
  // config: {
  //   selectAllId, containerId, selectionRowId, selectionCountId, bulkDeleteBtnId,
  //   getVisibleItems: () => items currently visible (id-bearing objects) —
  //     drives both "select all visible" and the header checkbox state,
  //   getAllItems: () => the full backing array (to resolve selected ids),
  //   getItemLabel: (item) => string used in the delete-confirmation message,
  //   nounSingular, nounPlural: strings for delete-confirmation wording,
  //   extraDeleteWarning: string appended after "This cannot be undone" (the
  //     Keyword tab's CSV-reimport-exclusion note; the Content tab passes ''
  //     since it isn't tombstoned),
  //   performDelete: (idSet, selectedItems) => mutates + saves backing state,
  //   afterDelete: (count) => re-renders the tab(s) and shows a toast,
  //   renderVisibleList: () => re-renders just the rows/cards (used when the
  //     "select all" checkbox toggles, to redraw the now-(un)checked boxes)
  // }
  function createBulkSelection(config) {
    var selected = {};

    function selectedIdList() {
      return Object.keys(selected).filter(function (id) { return selected[id]; });
    }

    function isSelected(id) { return !!selected[id]; }

    function unselect(id) { delete selected[id]; }

    function getSelectedItems() {
      var idSet = {};
      selectedIdList().forEach(function (id) { idSet[id] = true; });
      return config.getAllItems().filter(function (item) { return idSet[item.id]; });
    }

    // Updates the header "select all" checkbox's checked/indeterminate state
    // based on the *currently visible* rows only, per spec (a narrowed
    // filter never treats hidden rows as part of "all"). Called after every
    // selection change AND every filter-triggered re-render, so it can never
    // go stale the way the Keyword tab's copy used to.
    function updateSelectAllState() {
      var box = document.getElementById(config.selectAllId);
      var visible = config.getVisibleItems();
      if (visible.length === 0) { box.checked = false; box.indeterminate = false; return; }
      var selectedCount = visible.filter(function (item) { return selected[item.id]; }).length;
      box.checked = selectedCount === visible.length;
      box.indeterminate = selectedCount > 0 && selectedCount < visible.length;
    }

    // Renders the selection count chip, adding a de-emphasized "(m not
    // shown)" qualifier whenever some selected ids fall outside the
    // currently-visible (filtered) set — selection persists across filter
    // changes, so this keeps that fact visible instead of silently hiding
    // it, without it reading as a warning (informational only).
    function updateSelectionCount(idList) {
      var countEl = document.getElementById(config.selectionCountId);
      var count = idList.length;
      if (count === 0) {
        countEl.textContent = '0 selected';
        return;
      }
      var visibleIds = {};
      config.getVisibleItems().forEach(function (item) { visibleIds[item.id] = true; });
      var notShown = idList.filter(function (id) { return !visibleIds[id]; }).length;
      if (notShown > 0) {
        countEl.innerHTML = count + ' selected <span class="selection-count-qualifier">(' + notShown + ' not shown)</span>';
      } else {
        countEl.textContent = count + ' selected';
      }
    }

    function updateSelectionUI() {
      var idList = selectedIdList();
      var count = idList.length;
      document.getElementById(config.selectionRowId).hidden = count === 0;
      updateSelectionCount(idList);
      document.getElementById(config.bulkDeleteBtnId).textContent = 'Delete ' + count + ' selected';
      updateSelectAllState();
      if (config.afterSelectionUIUpdate) config.afterSelectionUIUpdate(count);
    }

    function clear() { selected = {}; }

    function bulkDelete() {
      var chosen = getSelectedItems();
      var count = chosen.length;
      if (count === 0) return;

      var message;
      if (count <= 8) {
        message = 'Delete ' + count + ' ' + (count === 1 ? config.nounSingular : config.nounPlural) + ' — "' +
          chosen.map(config.getItemLabel).join('", "') +
          '"? This cannot be undone' + (config.extraDeleteWarning || '') + '.';
      } else {
        message = 'Delete ' + count + ' selected ' + config.nounPlural + '? This cannot be undone' + (config.extraDeleteWarning || '') + '.';
      }

      confirmAction(message, function () {
        var idSet = {};
        chosen.forEach(function (item) { idSet[item.id] = true; });
        config.performDelete(idSet, chosen);
        clear();
        config.afterDelete(count);
      }, { label: 'Delete', danger: true });
    }

    function init() {
      document.getElementById(config.selectAllId).addEventListener('change', function (e) {
        var checked = e.target.checked;
        config.getVisibleItems().forEach(function (item) {
          if (checked) selected[item.id] = true;
          else delete selected[item.id];
        });
        config.renderVisibleList();
        updateSelectionUI();
      });

      document.getElementById(config.containerId).addEventListener('change', function (e) {
        var cb = e.target.closest('.row-checkbox');
        if (!cb) return;
        var id = cb.getAttribute('data-id');
        if (cb.checked) selected[id] = true;
        else delete selected[id];
        updateSelectionUI();
      });

      document.getElementById(config.bulkDeleteBtnId).addEventListener('click', bulkDelete);
    }

    return {
      init: init,
      isSelected: isSelected,
      unselect: unselect,
      getSelectedItems: getSelectedItems,
      updateSelectionUI: updateSelectionUI,
      updateSelectAllState: updateSelectAllState,
      clear: clear
    };
  }

  /* ===========================================================
     KEYWORD PLANNER
     =========================================================== */

  var kwFilters = { search: '', decision: 'all', sortVolume: 'none', serp: 'all' };

  var kwSelection = createBulkSelection({
    selectAllId: 'kw-select-all',
    containerId: 'kw-tbody',
    selectionRowId: 'kw-selection-row',
    selectionCountId: 'kw-selection-count',
    bulkDeleteBtnId: 'kw-bulk-delete-btn',
    getVisibleItems: function () { return getVisibleKeywords(); },
    getAllItems: function () { return state.keywords; },
    getItemLabel: function (k) { return k.phrase; },
    nounSingular: 'keyword',
    nounPlural: 'keywords',
    extraDeleteWarning: ', and these phrases will be excluded from future CSV imports',
    performDelete: function (idSet, chosen) {
      addDeletedPhrases(chosen.map(function (k) { return k.phrase; }));
      state.keywords = state.keywords.filter(function (k) { return !idSet[k.id]; });
      saveKeywords();
    },
    afterDelete: function (count) {
      renderKeywordsTab();
      showToast(count + ' keyword' + (count === 1 ? '' : 's') + ' deleted.');
    },
    renderVisibleList: function () { renderKwTable(); },
    // The selection row and the "select keywords to…" hint are mutually
    // exclusive: the hint only makes sense once there's at least one
    // keyword to select and nothing is currently selected.
    afterSelectionUIUpdate: function (count) {
      var hint = document.getElementById('kw-selection-hint');
      if (hint) hint.hidden = !(count === 0 && state.keywords.length >= 1);
    }
  });

  function kwCountsSummary() {
    var counts = { Go: 0, Maybe: 0, Skip: 0, pending: 0 };
    state.keywords.forEach(function (k) {
      var d = computeDecision(k);
      if (d === 'Go') counts.Go++;
      else if (d === 'Maybe') counts.Maybe++;
      else if (d === 'Skip') counts.Skip++;
      else counts.pending++;
    });
    return counts;
  }

  function renderKwCounts() {
    var c = kwCountsSummary();
    var el = document.getElementById('kw-counts');
    el.innerHTML =
      '<span class="count-chip go">' + c.Go + ' Go</span>' +
      '<span class="count-chip maybe">' + c.Maybe + ' Maybe</span>' +
      '<span class="count-chip skip">' + c.Skip + ' Skip</span>' +
      '<span class="count-chip pending">' + c.pending + ' pending</span>';
  }

  function decisionBadge(d) {
    var cls = d === 'Go' ? 'badge-go' : d === 'Maybe' ? 'badge-maybe' : d === 'Skip' ? 'badge-skip' : 'badge-pending';
    return '<span class="badge ' + cls + '">' + escapeHtml(d) + '</span>';
  }

  /* ---------------------------------------------------------
     SERP verdict helpers
     --------------------------------------------------------- */
  function serpVerdictLabel(v) {
    if (v === 'gap') return 'Gap';
    if (v === 'doable') return 'Doable';
    if (v === 'skip') return 'Skip';
    return 'Not checked';
  }

  function serpBadgeClass(v) {
    if (v === 'gap') return 'badge-go';
    if (v === 'doable') return 'badge-maybe';
    if (v === 'skip') return 'badge-skip';
    return 'badge-pending';
  }

  // Renders the SERP verdict as a clickable badge that opens the inline
  // popover editor (see initSerpPopover). Works for both set and unset
  // verdicts, matching the neutral "Not checked" state from the spec.
  function serpBadgeHtml(kw) {
    var v = kw.serpVerdict || null;
    return '<button type="button" class="badge badge-btn ' + serpBadgeClass(v) + '" ' +
      'data-action="serp-edit" data-id="' + kw.id + '" aria-haspopup="true" aria-expanded="false">' +
      (v ? serpVerdictLabel(v) : 'Not checked') + '</button>';
  }

  // Keywords eligible for SERP review: a Go/Maybe decision with no verdict
  // yet recorded. Sorted Go before Maybe, then by the same volume-estimate
  // comparator the "Sort by volume" (High -> Low) control uses. Computed
  // fresh on every call so a review session always reflects live state.
  function serpReviewQueue() {
    var list = state.keywords.filter(function (k) {
      var d = computeDecision(k);
      return (d === 'Go' || d === 'Maybe') && !k.serpVerdict;
    });
    list.sort(function (a, b) {
      var da = computeDecision(a), db = computeDecision(b);
      if (da !== db) return da === 'Go' ? -1 : 1;
      var av = parseVolumeToNumber(a.volume); av = av === null ? -1 : av;
      var bv = parseVolumeToNumber(b.volume); bv = bv === null ? -1 : bv;
      return bv - av;
    });
    return list;
  }

  function volumeDisplay(kw) {
    var num = parseVolumeToNumber(kw.volume);
    var bucket = bucketVolume(num);
    if (bucket === null) return '<span class="mono">—</span>';
    var raw = kw.volume !== null && kw.volume !== undefined && kw.volume !== '' ? kw.volume : num;
    return '<span class="mono">' + escapeHtml(raw) + '<br><small>(' + bucket + ')</small></span>';
  }

  function contentAlreadyExistsForKeyword(phrase) {
    var norm = phrase.trim().toLowerCase();
    return state.content.some(function (c) { return (c.targetKeyword || '').trim().toLowerCase() === norm; });
  }

  // Keywords currently visible under the active search/decision/SERP filters
  // (and volume sort), i.e. exactly what's rendered in the table right now.
  // Shared by renderKwTable and the "select all visible" checkbox so bulk
  // selection always matches what the user can actually see.
  function getVisibleKeywords() {
    var list = state.keywords.slice();

    // filter: search
    if (kwFilters.search.trim()) {
      var q = kwFilters.search.trim().toLowerCase();
      list = list.filter(function (k) { return k.phrase.toLowerCase().indexOf(q) !== -1; });
    }
    // filter: decision
    if (kwFilters.decision !== 'all') {
      list = list.filter(function (k) { return computeDecision(k) === kwFilters.decision; });
    }
    // filter: SERP verdict
    if (kwFilters.serp !== 'all') {
      list = list.filter(function (k) {
        var v = k.serpVerdict || null;
        return kwFilters.serp === 'none' ? !v : v === kwFilters.serp;
      });
    }
    // sort: volume
    if (kwFilters.sortVolume !== 'none') {
      list.sort(function (a, b) {
        var av = parseVolumeToNumber(a.volume);
        var bv = parseVolumeToNumber(b.volume);
        av = av === null ? -1 : av;
        bv = bv === null ? -1 : bv;
        return kwFilters.sortVolume === 'asc' ? av - bv : bv - av;
      });
    }
    return list;
  }

  function renderKwTable() {
    var tbody = document.getElementById('kw-tbody');
    var list = getVisibleKeywords();

    document.getElementById('kw-empty').hidden = state.keywords.length !== 0;

    tbody.innerHTML = list.map(function (k) {
      var decision = computeDecision(k);
      var verdict = k.serpVerdict || null;
      var eligible = eligibleForContentPlanner(k);
      var alreadyAdded = eligible && contentAlreadyExistsForKeyword(k.phrase);
      var sendBtn = '';
      if (alreadyAdded) {
        sendBtn = '<span class="badge badge-pending" title="A content item already targets this keyword">Already added</span>';
      } else if (eligible) {
        sendBtn = '<button type="button" class="btn btn-small" data-action="send" data-id="' + k.id + '">Send to Content</button>';
      } else if (decision === 'Go') {
        var reason = verdict === 'skip' ? 'Marked skip in SERP review' : 'Complete SERP review first';
        sendBtn = '<button type="button" class="btn btn-small" data-action="send" data-id="' + k.id + '" disabled title="' + reason + '">Send to Content</button>';
      }
      return (
        '<tr data-id="' + k.id + '">' +
        '<td class="checkbox-cell"><input type="checkbox" class="row-checkbox" data-id="' + k.id + '"' +
          (kwSelection.isSelected(k.id) ? ' checked' : '') +
          ' aria-label="Select ' + escapeHtml(k.phrase) + '"></td>' +
        '<td class="phrase-cell">' + escapeHtml(k.phrase) + '</td>' +
        '<td>' + escapeHtml(k.note || '') + '</td>' +
        '<td>' + volumeDisplay(k) + '</td>' +
        '<td>' + escapeHtml(k.competition || '—') + '</td>' +
        '<td>' + (k.quick ? 'Yes' : 'No') + '</td>' +
        '<td>' + escapeHtml(k.cluster || '') + '</td>' +
        '<td>' + decisionBadge(decision) + '</td>' +
        '<td>' + serpBadgeHtml(k) + '</td>' +
        '<td><div class="row-actions">' +
          '<button type="button" class="btn btn-small" data-action="edit" data-id="' + k.id + '">Edit</button>' +
          '<button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="' + k.id + '">Delete</button>' +
          sendBtn +
        '</div></td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderKeywordsTab() {
    // Compute each keyword's decision exactly once for this render pass and
    // reuse it everywhere below (counts, table rows, bulk-send eligibility,
    // SERP queue) instead of recomputing computeDecision() redundantly for
    // the same keyword multiple times per render. The cache is cleared at
    // the end so it never persists between renders — every read outside this
    // function still computes fresh from current data.
    kwDecisionCache = {};
    state.keywords.forEach(function (k) { kwDecisionCache[k.id] = computeDecisionRaw(k); });

    renderKwCounts();
    renderKwTable();
    refreshClusterDatalists();
    refreshKeywordDatalist();
    kwSelection.updateSelectionUI();
    updateDeletedPhrasesButton();

    kwDecisionCache = null;
  }

  /* ---------- Keyword add/edit dialog ---------- */
  function openKwDialog(kw) {
    var dialog = document.getElementById('kw-dialog');
    var title = document.getElementById('kw-dialog-title');
    document.getElementById('kw-id').value = kw ? kw.id : '';
    document.getElementById('kw-phrase').value = kw ? kw.phrase : '';
    document.getElementById('kw-note').value = kw ? (kw.note || '') : '';
    document.getElementById('kw-volume').value = (kw && kw.volume !== null && kw.volume !== undefined) ? kw.volume : '';
    document.getElementById('kw-competition').value = kw ? (kw.competition || '') : '';
    document.getElementById('kw-cluster').value = kw ? (kw.cluster || '') : '';
    document.getElementById('kw-quick').checked = kw ? !!kw.quick : false;
    title.textContent = kw ? 'Edit keyword' : 'Add keyword';
    refreshClusterDatalists();
    dialog.showModal();
    document.getElementById('kw-phrase').focus();
  }

  function initKwForm() {
    document.getElementById('kw-add-btn').addEventListener('click', function () { openKwDialog(null); });
    document.getElementById('kw-cancel-btn').addEventListener('click', function () {
      document.getElementById('kw-dialog').close();
    });

    document.getElementById('kw-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var phrase = document.getElementById('kw-phrase').value.trim();
      if (!phrase) { document.getElementById('kw-phrase').focus(); return; }

      var id = document.getElementById('kw-id').value;
      var volumeRaw = document.getElementById('kw-volume').value;
      var volume = volumeRaw === '' ? null : Number(volumeRaw);
      var competition = document.getElementById('kw-competition').value || null;
      var cluster = document.getElementById('kw-cluster').value.trim();
      var note = document.getElementById('kw-note').value.trim();
      var quick = document.getElementById('kw-quick').checked;

      if (id) {
        var existing = state.keywords.find(function (k) { return k.id === id; });
        if (existing) {
          existing.phrase = phrase;
          existing.note = note;
          existing.volume = volume;
          existing.competition = competition;
          existing.cluster = cluster;
          existing.quick = quick;
        }
        showToast('Keyword updated.');
      } else {
        var newId = uid();
        state.keywords.push({
          id: newId,
          phrase: phrase,
          note: note,
          volume: volume,
          competition: competition,
          cluster: cluster,
          quick: quick,
          serpVerdict: null,
          serpCheckedAt: null,
          createdAt: todayISO()
        });
        showToast('Keyword added.');
      }
      saveKeywords();
      document.getElementById('kw-dialog').close();
      renderKeywordsTab();
      if (!id && typeof newId !== 'undefined') {
        flashElement(document.querySelector('#kw-tbody tr[data-id="' + newId + '"]'));
      }
    });
  }

  function initKwTableActions() {
    document.getElementById('kw-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      var kw = state.keywords.find(function (k) { return k.id === id; });
      if (!kw) return;

      if (action === 'edit') {
        openKwDialog(kw);
      } else if (action === 'delete') {
        confirmAction('Delete the keyword "' + kw.phrase + '"? This cannot be undone.', function () {
          var rowEl = document.querySelector('#kw-tbody tr[data-id="' + id + '"]');
          removeWithFade(rowEl, 'row-removing', function () {
            state.keywords = state.keywords.filter(function (k) { return k.id !== id; });
            kwSelection.unselect(id);
            saveKeywords();
            renderKeywordsTab();
            showToast('Keyword deleted.');
          });
        }, { label: 'Delete', danger: true });
      } else if (action === 'send') {
        sendKeywordToContentPlanner(kw);
      } else if (action === 'serp-edit') {
        if (serpPopoverTargetId === id && !document.getElementById('serp-popover').hidden) {
          closeSerpPopover();
        } else {
          openSerpPopover(btn, id);
        }
      }
    });
  }

  // Builds a new Content Planner item from a keyword, using the same
  // pre-fill rules everywhere a keyword gets sent over (single-row action
  // and the bulk "Send all Go" action both call this).
  function buildContentItemFromKeyword(kw) {
    return {
      id: uid(),
      title: kw.phrase.charAt(0).toUpperCase() + kw.phrase.slice(1),
      targetKeyword: kw.phrase,
      cluster: kw.cluster || '',
      status: 'Idea',
      targetPublishDate: '',
      publishedDate: '',
      lastUpdatedDate: '',
      notes: '',
      createdAt: todayISO(),
      // Links back to the originating keyword so its SERP verdict and
      // rationale note stay visible on the content item instead of getting
      // orphaned. Degrades gracefully if the source keyword is later
      // deleted — see findKeywordById() and its use in contentCard().
      sourceKeywordId: kw.id
    };
  }

  // Resolves a content item's sourceKeywordId back to the live keyword
  // object, or null if it's unset or the keyword was since deleted.
  function findKeywordById(id) {
    if (!id) return null;
    return state.keywords.find(function (k) { return k.id === id; }) || null;
  }

  // A keyword is eligible to be sent to the Content Planner only once it
  // has an exact "Go" decision AND has been SERP-reviewed as "gap" or
  // "doable" (not still unreviewed and not "skip"). This is the single
  // combined rule used everywhere sending eligibility is checked.
  function eligibleForContentPlanner(kw) {
    var verdict = kw.serpVerdict || null;
    return computeDecision(kw) === 'Go' && (verdict === 'gap' || verdict === 'doable');
  }

  function sendKeywordToContentPlanner(kw) {
    if (!eligibleForContentPlanner(kw)) return;
    if (contentAlreadyExistsForKeyword(kw.phrase)) {
      showToast('Already added to Content Planner.');
      return;
    }
    state.content.push(buildContentItemFromKeyword(kw));
    saveContent();
    renderKeywordsTab();
    renderContentTab();
    showToast('Sent "' + kw.phrase + '" to Content Planner as a new idea.');
  }

  /* ---------- Selection-driven bulk keyword actions ----------
     Replaces the old standalone "Set blank competition to Low" / "Send
     SERP-approved Go keywords" / global "Start SERP Review" buttons with a
     single unified action bar on whatever's currently selected (see
     #kw-selection-row). Per product decision, "Set competition to Low" and
     "Set volume to 0" apply unconditionally to every selected keyword
     (overwriting existing values), and "Send to Content Planner" from a
     selection has no eligibility gate — every selected keyword is sent
     (still deduped against existing links). Only the per-row "Send to
     Content" button in the table keeps the Go+verdict eligibility gate. */

  function bulkSetSelectedCompetitionToLow() {
    var items = kwSelection.getSelectedItems();
    var n = items.length;
    if (n === 0) return;
    confirmAction(
      'Competition will be set to Low on all ' + n + ' selected keyword' + (n === 1 ? '' : 's') +
        ', including any that already have a different value. Continue?',
      function () {
        items.forEach(function (k) { k.competition = 'Low'; });
        saveKeywords();
        renderKeywordsTab();
        showToast(n + ' keyword' + (n === 1 ? '' : 's') + ' updated to Low competition.');
      },
      { label: 'Set to Low', danger: false }
    );
  }

  function bulkSetSelectedVolumeToZero() {
    var items = kwSelection.getSelectedItems();
    var n = items.length;
    if (n === 0) return;
    confirmAction(
      'Volume will be set to 0 (no data) on all ' + n + ' selected keyword' + (n === 1 ? '' : 's') +
        ', overwriting existing values. This also changes their computed Decision to Skip. Continue?',
      function () {
        items.forEach(function (k) { k.volume = 0; });
        saveKeywords();
        renderKeywordsTab();
        showToast(n + ' keyword' + (n === 1 ? '' : 's') + ' set to volume 0.');
      },
      { label: 'Set to 0', danger: false }
    );
  }

  // Reuses the existing #bulk-send-dialog component. Unlike the old
  // "Send SERP-approved Go keywords" global action, this has no eligibility
  // gate — every currently-selected keyword is sent regardless of Decision
  // or SERP verdict. The dedupe-by-target-keyword check still applies (data
  // integrity, not a policy gate): a keyword already linked to a Content
  // Planner item is skipped rather than creating a duplicate.
  function updateSelectionSendDialogBody() {
    var n = kwSelection.getSelectedItems().length;
    document.getElementById('bulk-send-dialog-body').textContent =
      'Send ' + n + ' selected keyword' + (n === 1 ? '' : 's') + ' to Content Planner as new Idea items? ' +
      'This applies to every selected keyword regardless of Decision or SERP status. ' +
      'Keywords already linked to a Content Planner item will be skipped.';
    document.getElementById('bulk-send-ok-btn').disabled = n === 0;
  }

  function openSelectionSendDialog() {
    if (kwSelection.getSelectedItems().length === 0) return;
    updateSelectionSendDialogBody();
    document.getElementById('bulk-send-dialog').showModal();
  }

  function sendSelectionToContentPlanner() {
    var items = kwSelection.getSelectedItems();
    var sent = 0, skipped = 0;
    items.forEach(function (kw) {
      if (contentAlreadyExistsForKeyword(kw.phrase)) { skipped++; return; }
      state.content.push(buildContentItemFromKeyword(kw));
      sent++;
    });
    saveContent();
    renderKeywordsTab();
    renderContentTab();
    var msg = sent + ' keyword' + (sent === 1 ? '' : 's') + ' sent to Content Planner.';
    if (skipped) msg += ' ' + skipped + ' already linked and ' + (skipped === 1 ? 'was' : 'were') + ' skipped.';
    showToast(msg);
  }

  /* ---------- Mobile "Actions ▾" popover for the selection row ----------
     Below the responsive breakpoint the 5 non-destructive selection actions
     collapse into a popover, reusing the same positioning / open-close /
     keyboard / outside-click pattern as the inline SERP verdict popover
     (see openSerpPopover/closeSerpPopover below). Delete is never part of
     this menu — it stays flat next to the count on every viewport. */
  function openKwActionsPopover() {
    var pop = document.getElementById('kw-selection-actions-popover');
    var btn = document.getElementById('kw-selection-actions-toggle');
    var rect = btn.getBoundingClientRect();
    pop.style.top = (window.scrollY + rect.bottom + 4) + 'px';
    pop.style.left = (window.scrollX + rect.left) + 'px';
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    var firstBtn = pop.querySelector('button');
    if (firstBtn) firstBtn.focus();
  }

  function closeKwActionsPopover() {
    var pop = document.getElementById('kw-selection-actions-popover');
    if (pop.hidden) return;
    pop.hidden = true;
    document.getElementById('kw-selection-actions-toggle').setAttribute('aria-expanded', 'false');
  }

  // Binds one shared handler to both the flat desktop button (id) and its
  // mobile popover-menu counterpart (id + "-m"), so there's exactly one
  // source of truth for each action's behavior regardless of which control
  // triggered it.
  function bindSelectionAction(id, handler) {
    ['', '-m'].forEach(function (suffix) {
      var el = document.getElementById(id + suffix);
      if (el) {
        el.addEventListener('click', function () {
          closeKwActionsPopover();
          handler();
        });
      }
    });
  }

  function initKwSelectionActions() {
    bindSelectionAction('kw-bulk-set-cluster-btn', openKwBulkClusterDialog);
    bindSelectionAction('kw-sel-competition-btn', bulkSetSelectedCompetitionToLow);
    bindSelectionAction('kw-sel-volume-btn', bulkSetSelectedVolumeToZero);
    bindSelectionAction('kw-sel-send-btn', openSelectionSendDialog);
    bindSelectionAction('kw-sel-serp-btn', openSerpReviewForSelection);

    document.getElementById('kw-selection-actions-toggle').addEventListener('click', function () {
      var pop = document.getElementById('kw-selection-actions-popover');
      if (pop.hidden) openKwActionsPopover();
      else closeKwActionsPopover();
    });
    document.addEventListener('click', function (e) {
      var pop = document.getElementById('kw-selection-actions-popover');
      if (pop.hidden) return;
      if (pop.contains(e.target) || e.target.closest('#kw-selection-actions-toggle')) return;
      closeKwActionsPopover();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeKwActionsPopover();
    });
    window.addEventListener('scroll', function () { closeKwActionsPopover(); }, true);

    document.getElementById('bulk-send-cancel-btn').addEventListener('click', function () {
      document.getElementById('bulk-send-dialog').close();
    });
    document.getElementById('bulk-send-form').addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('bulk-send-dialog').close();
      sendSelectionToContentPlanner();
    });
  }

  /* ---------- SERP Review queue ---------- */

  // Opens Google search results for a phrase in a new tab. Must always be
  // called synchronously inside a user-gesture click handler, never from a
  // render/effect callback afterward — popup blockers only allow
  // window.open within that synchronous gesture window. Returns the new
  // window reference (or null/undefined if blocked); callers should treat
  // a falsy result as "silently fall back to the manual link," not an error.
  function openGoogleSearchFor(phrase) {
    try {
      return window.open('https://www.google.com/search?q=' + encodeURIComponent(phrase), '_blank', 'noopener');
    } catch (e) {
      return null;
    }
  }

  // Fixed ordered list of keyword ids for the *current* open review
  // session, built once when the session starts (see
  // openSerpReviewForSelection) from the Go-then-Maybe-then-rest priority
  // order below — unlike the old global queue, this does NOT get
  // recomputed as verdicts are recorded, because a selection-scoped review
  // deliberately doesn't filter by decision or existing verdict (already-
  // verdicted keywords can be re-reviewed if they were selected).
  var serpReviewQueueIds = [];
  // Ids skipped ("Review later") during the *current* open review session.
  var serpReviewSkippedIds = [];
  // Ids that were given a verdict during the *current* open review session
  // (tracked separately from serpReviewSkippedIds so progress/remaining
  // math is unambiguous). Neither list is persisted — both reset each time
  // a new review session starts or the dialog closes.
  var serpReviewDoneIds = [];

  function serpReviewPriority(decision) {
    return decision === 'Go' ? 0 : decision === 'Maybe' ? 1 : 2;
  }

  // Builds the review queue for a set of selected keywords: every keyword
  // passed in, any decision (including already-Skip or already-verdicted
  // ones), ordered Go-then-Maybe-then-rest, and by volume (High -> Low)
  // within each group — reusing the same volume comparator as elsewhere.
  // Separate from the old serpReviewQueue() below, which filters to
  // unverdicted Go/Maybe keywords app-wide and is no longer the entry point
  // for SERP Review (kept as-is in case anything else needs that logic).
  function serpReviewQueueForSelection(items) {
    var list = items.slice();
    list.sort(function (a, b) {
      var pa = serpReviewPriority(computeDecision(a));
      var pb = serpReviewPriority(computeDecision(b));
      if (pa !== pb) return pa - pb;
      var av = parseVolumeToNumber(a.volume); av = av === null ? -1 : av;
      var bv = parseVolumeToNumber(b.volume); bv = bv === null ? -1 : bv;
      return bv - av;
    });
    return list;
  }

  function serpReviewRemaining() {
    return serpReviewQueueIds
      .filter(function (id) {
        return serpReviewSkippedIds.indexOf(id) === -1 && serpReviewDoneIds.indexOf(id) === -1;
      })
      .map(function (id) { return state.keywords.find(function (k) { return k.id === id; }); })
      .filter(Boolean); // defensive: a selected keyword could be deleted mid-session
  }

  function renderSerpReview() {
    var total = serpReviewQueueIds.length;
    var remaining = serpReviewRemaining();
    var progressEl = document.getElementById('serp-review-progress');
    var bodyEl = document.getElementById('serp-review-body');

    if (total === 0) {
      progressEl.textContent = 'Review complete';
      bodyEl.innerHTML =
        '<div class="serp-review-empty">' +
          '<p>No keywords to review.</p>' +
          '<button type="button" class="btn btn-primary" id="serp-review-done-btn">Close</button>' +
        '</div>';
      document.getElementById('serp-review-done-btn').addEventListener('click', closeSerpReview);
      return;
    }

    // Everything left in the queue has either been given a verdict or
    // "Review later"-skipped earlier in this same session.
    if (remaining.length === 0) {
      var skippedCount = serpReviewSkippedIds.length;
      if (skippedCount > 0) {
        progressEl.textContent = 'Review paused';
        bodyEl.innerHTML =
          '<div class="serp-review-empty">' +
            '<p>' + skippedCount + ' selected keyword' + (skippedCount === 1 ? '' : 's') + ' marked "Review later" — ' +
            (skippedCount === 1 ? 'it' : 'they') + ' will reappear next time you start a SERP review on this selection.</p>' +
            '<button type="button" class="btn btn-primary" id="serp-review-done-btn">Close</button>' +
          '</div>';
      } else {
        progressEl.textContent = 'Review complete';
        bodyEl.innerHTML =
          '<div class="serp-review-empty">' +
            '<p>All ' + total + ' selected keyword' + (total === 1 ? '' : 's') + ' reviewed.</p>' +
            '<button type="button" class="btn btn-primary" id="serp-review-done-btn">Close</button>' +
          '</div>';
      }
      document.getElementById('serp-review-done-btn').addEventListener('click', closeSerpReview);
      return;
    }

    var current = remaining[0];
    var reviewedCount = total - remaining.length;
    progressEl.textContent = reviewedCount + ' of ' + total + ' selected keywords reviewed';

    var decision = computeDecision(current);

    bodyEl.innerHTML =
      '<div class="serp-review-card" tabindex="-1">' +
        '<p class="serp-review-phrase">' + escapeHtml(current.phrase) + '</p>' +
        '<div class="serp-review-meta">' +
          '<span>Volume: ' + volumeDisplay(current) + '</span>' +
          '<span>Competition: ' + escapeHtml(current.competition || '—') + '</span>' +
          '<span>Decision: ' + decisionBadge(decision) + '</span>' +
        '</div>' +
        (current.note ? '<p class="serp-review-note">' + escapeHtml(current.note) + '</p>' : '') +
        '<button type="button" class="btn serp-review-open-btn" data-action="open-search" data-id="' + current.id + '">Open Google search for this phrase</button>' +
        '<div class="serp-review-verdicts">' +
          '<button type="button" class="btn serp-verdict-btn serp-verdict-gap" data-action="verdict" data-verdict="gap" data-id="' + current.id + '">Genuine gap</button>' +
          '<button type="button" class="btn serp-verdict-btn serp-verdict-doable" data-action="verdict" data-verdict="doable" data-id="' + current.id + '">Doable, need an angle</button>' +
          '<button type="button" class="btn serp-verdict-btn serp-verdict-skip" data-action="verdict" data-verdict="skip" data-id="' + current.id + '">Skip, dominated by majors</button>' +
        '</div>' +
        '<div class="serp-review-footer">' +
          '<button type="button" class="btn btn-ghost" data-action="skip-later" data-id="' + current.id + '">Review later</button>' +
        '</div>' +
      '</div>';

    var cardEl = bodyEl.querySelector('.serp-review-card');
    if (cardEl) cardEl.focus();
  }

  // Records a verdict (or a "review later" skip) for the current card, then
  // advances the queue. Does NOT auto-open a Google search for the next
  // card — the user must click "Open Google search for this phrase" on the
  // card themselves.
  function advanceSerpReview(currentId, verdict) {
    if (verdict) {
      var kw = state.keywords.find(function (k) { return k.id === currentId; });
      if (kw) {
        kw.serpVerdict = verdict;
        kw.serpCheckedAt = todayISO();
        saveKeywords();
      }
      serpReviewDoneIds.push(currentId);
    } else {
      serpReviewSkippedIds.push(currentId);
    }
    renderSerpReview();
    renderKeywordsTab();
  }

  function closeSerpReview() {
    document.getElementById('serp-review-dialog').close();
  }

  // Entry point for "Start SERP Review" from the selection action bar (the
  // desktop button and its mobile popover counterpart both call this — see
  // initKwSelectionActions). Purely navigational: no confirm dialog, since
  // every verdict recorded inside the review flow is already its own
  // committed action.
  function openSerpReviewForSelection() {
    var items = kwSelection.getSelectedItems();
    if (items.length === 0) return;
    var queue = serpReviewQueueForSelection(items);
    serpReviewQueueIds = queue.map(function (k) { return k.id; });
    serpReviewSkippedIds = [];
    serpReviewDoneIds = [];
    renderSerpReview();
    document.getElementById('serp-review-dialog').showModal();
  }

  function initSerpReview() {
    document.getElementById('serp-review-close-btn').addEventListener('click', closeSerpReview);
    document.getElementById('serp-review-dialog').addEventListener('close', function () {
      serpReviewQueueIds = [];
      serpReviewSkippedIds = [];
      serpReviewDoneIds = [];
      renderKeywordsTab();
    });

    document.getElementById('serp-review-body').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');

      if (action === 'open-search') {
        var kw = state.keywords.find(function (k) { return k.id === id; });
        if (kw) openGoogleSearchFor(kw.phrase);
      } else if (action === 'verdict') {
        advanceSerpReview(id, btn.getAttribute('data-verdict'));
      } else if (action === 'skip-later') {
        advanceSerpReview(id, null);
      }
    });
  }

  /* ---------- SERP inline verdict popover (table badge) ---------- */
  var serpPopoverTargetId = null;

  function openSerpPopover(anchorBtn, id) {
    var pop = document.getElementById('serp-popover');
    serpPopoverTargetId = id;
    var rect = anchorBtn.getBoundingClientRect();
    pop.style.top = (window.scrollY + rect.bottom + 4) + 'px';
    pop.style.left = (window.scrollX + rect.left) + 'px';
    pop.hidden = false;
    anchorBtn.setAttribute('aria-expanded', 'true');
    var firstBtn = pop.querySelector('button');
    if (firstBtn) firstBtn.focus();
  }

  function closeSerpPopover() {
    var pop = document.getElementById('serp-popover');
    if (pop.hidden) return;
    pop.hidden = true;
    if (serpPopoverTargetId) {
      var anchor = document.querySelector('.badge-btn[data-id="' + serpPopoverTargetId + '"]');
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
    }
    serpPopoverTargetId = null;
  }

  function initSerpPopover() {
    document.getElementById('serp-popover').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-verdict]');
      if (!btn || !serpPopoverTargetId) return;
      var kw = state.keywords.find(function (k) { return k.id === serpPopoverTargetId; });
      if (kw) {
        kw.serpVerdict = btn.getAttribute('data-verdict');
        kw.serpCheckedAt = todayISO();
        saveKeywords();
      }
      closeSerpPopover();
      renderKeywordsTab();
      showToast('SERP verdict updated.');
    });

    document.addEventListener('click', function (e) {
      var pop = document.getElementById('serp-popover');
      if (pop.hidden) return;
      if (pop.contains(e.target) || e.target.closest('[data-action="serp-edit"]')) return;
      closeSerpPopover();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSerpPopover();
    });
    window.addEventListener('scroll', function () { closeSerpPopover(); }, true);
  }

  /* ---------- Keyword filters ---------- */
  function initKwFilters() {
    // Every filter-triggered render also refreshes the "select all" header
    // checkbox state (matching the Content tab's pattern) — a narrower
    // filter can change which rows count as "all visible" without a single
    // checkbox actually changing, and skipping this is exactly how that
    // checkbox went stale before.
    document.getElementById('kw-search').addEventListener('input', debounce(function (e) {
      kwFilters.search = e.target.value;
      renderKwTable();
      kwSelection.updateSelectionUI();
    }, 150));
    document.getElementById('kw-filter-decision').addEventListener('change', function (e) {
      kwFilters.decision = e.target.value;
      renderKwTable();
      kwSelection.updateSelectionUI();
    });
    document.getElementById('kw-sort-volume').addEventListener('change', function (e) {
      kwFilters.sortVolume = e.target.value;
      renderKwTable();
      kwSelection.updateSelectionUI();
    });
    document.getElementById('kw-filter-serp').addEventListener('change', function (e) {
      kwFilters.serp = e.target.value;
      renderKwTable();
      kwSelection.updateSelectionUI();
    });
  }

  function updateDeletedPhrasesButton() {
    document.getElementById('kw-deleted-list-btn').textContent = 'Previously deleted (' + state.deletedPhrases.length + ')';
  }

  /* ---------- Keyword bulk cluster-tagging ---------- */
  // The highest-value bulk action for this user: after a big CSV import
  // every new keyword has an empty cluster, and tagging them one-by-one via
  // the Edit dialog isn't realistic at 1700+ rows. Reuses the same cluster
  // autocomplete datalist ("cluster-suggestions") as the single-keyword Edit
  // form, populated by refreshClusterDatalists().

  function openKwBulkClusterDialog() {
    var items = kwSelection.getSelectedItems();
    if (items.length === 0) return;
    document.getElementById('kw-bulk-cluster-desc').textContent =
      'Sets the cluster for ' + items.length + ' selected keyword' + (items.length === 1 ? '' : 's') + '.';
    var input = document.getElementById('kw-bulk-cluster-input');
    input.value = '';
    refreshClusterDatalists();
    document.getElementById('kw-bulk-cluster-dialog').showModal();
    input.focus();
  }

  function initKwBulkCluster() {
    // The "Set cluster for selected" button itself is bound in
    // initKwSelectionActions (shared with its mobile popover counterpart) —
    // this only wires the dialog that button opens.
    document.getElementById('kw-bulk-cluster-cancel-btn').addEventListener('click', function () {
      document.getElementById('kw-bulk-cluster-dialog').close();
    });
    document.getElementById('kw-bulk-cluster-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('kw-bulk-cluster-input');
      var cluster = input.value.trim();
      if (!cluster) { input.focus(); return; }
      var items = kwSelection.getSelectedItems();
      items.forEach(function (k) { k.cluster = cluster; });
      saveKeywords();
      document.getElementById('kw-bulk-cluster-dialog').close();
      renderKeywordsTab();
      showToast(items.length + ' keyword' + (items.length === 1 ? '' : 's') + ' set to cluster "' + cluster + '".');
    });
  }

  /* ---------- Previously deleted keywords dialog ---------- */

  function renderDeletedList() {
    var body = document.getElementById('deleted-list-body');
    if (state.deletedPhrases.length === 0) {
      body.innerHTML = '<p class="empty-state">No previously deleted keywords.</p>';
      return;
    }
    var sorted = state.deletedPhrases.slice().sort(function (a, b) { return a.phrase.localeCompare(b.phrase); });
    body.innerHTML = sorted.map(function (d) {
      return (
        '<div class="deleted-list-item">' +
          '<span class="deleted-list-phrase">' + escapeHtml(d.phrase) + '</span>' +
          '<button type="button" class="btn btn-small" data-action="restore" data-phrase="' + escapeHtml(d.normPhrase) + '">Remove from exclusion list</button>' +
        '</div>'
      );
    }).join('');
  }

  function initDeletedPhrasesDialog() {
    document.getElementById('kw-deleted-list-btn').addEventListener('click', function () {
      renderDeletedList();
      document.getElementById('deleted-list-dialog').showModal();
    });
    document.getElementById('deleted-list-close-btn').addEventListener('click', function () {
      document.getElementById('deleted-list-dialog').close();
    });
    document.getElementById('deleted-list-body').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action="restore"]');
      if (!btn) return;
      var norm = btn.getAttribute('data-phrase');
      state.deletedPhrases = state.deletedPhrases.filter(function (d) { return d.normPhrase !== norm; });
      saveDeletedPhrases();
      renderDeletedList();
      updateDeletedPhrasesButton();
      showToast('Removed from exclusion list.');
    });
  }

  /* ---------------------------------------------------------
     CSV import (Google Keyword Planner "Keyword Ideas" export)
     --------------------------------------------------------- */

  // Minimal CSV/TSV parser with quote handling.
  function parseDelimited(text, delimiter) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === delimiter) {
          row.push(field);
          field = '';
        } else if (c === '\n') {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else if (c === '\r') {
          // ignore, \n handles line breaks
        } else {
          field += c;
        }
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function detectDelimiter(text) {
    var firstLines = text.split('\n').slice(0, 5).join('\n');
    var tabCount = (firstLines.match(/\t/g) || []).length;
    var commaCount = (firstLines.match(/,/g) || []).length;
    return tabCount > commaCount ? '\t' : ',';
  }

  function normalizeCompetition(raw) {
    if (!raw) return null;
    var s = String(raw).trim().toLowerCase();
    if (s === 'low') return 'Low';
    if (s === 'medium') return 'Medium';
    if (s === 'high') return 'High';
    return null;
  }

  function importKeywordsCsv(text) {
    var delimiter = detectDelimiter(text);
    var rows = parseDelimited(text, delimiter);

    // Find the header row: the first row containing a cell that
    // equals (case-insensitively) "Keyword".
    var headerIdx = -1;
    var headerRow = null;
    for (var i = 0; i < rows.length; i++) {
      var found = rows[i].some(function (cell) { return cell.trim().toLowerCase() === 'keyword'; });
      if (found) { headerIdx = i; headerRow = rows[i]; break; }
    }

    if (headerIdx === -1) {
      return { error: 'Could not find a "Keyword" column header in this file. Please check it is a Google Keyword Planner "Keyword Ideas" export.' };
    }

    function colIndex(name) {
      return headerRow.findIndex(function (cell) { return cell.trim().toLowerCase() === name.toLowerCase(); });
    }

    var idxKeyword = colIndex('Keyword');
    var idxVolume = colIndex('Avg. monthly searches');
    var idxCompetition = colIndex('Competition');

    var existingPhrases = {};
    state.keywords.forEach(function (k) { existingPhrases[k.phrase.trim().toLowerCase()] = true; });

    var deletedPhrasesSet = {};
    state.deletedPhrases.forEach(function (d) { deletedPhrasesSet[d.normPhrase] = true; });

    var imported = 0, skippedDup = 0, skippedDeleted = 0, skippedBlank = 0;

    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.every(function (c) { return c.trim() === ''; })) continue;

      var phrase = idxKeyword !== -1 ? (row[idxKeyword] || '').trim() : '';
      if (!phrase) { skippedBlank++; continue; }

      var normPhrase = phrase.toLowerCase();
      if (existingPhrases[normPhrase]) { skippedDup++; continue; }
      if (deletedPhrasesSet[normPhrase]) { skippedDeleted++; continue; }

      var volumeRaw = idxVolume !== -1 ? (row[idxVolume] || '').trim() : '';
      var volumeNum = parseVolumeToNumber(volumeRaw);
      var competition = idxCompetition !== -1 ? normalizeCompetition(row[idxCompetition]) : null;

      state.keywords.push({
        id: uid(),
        phrase: phrase,
        note: '',
        volume: volumeNum,
        competition: competition,
        cluster: '',
        quick: false,
        serpVerdict: null,
        serpCheckedAt: null,
        createdAt: todayISO()
      });
      existingPhrases[normPhrase] = true;
      imported++;
    }

    saveKeywords();
    return { imported: imported, skippedDup: skippedDup, skippedDeleted: skippedDeleted, skippedBlank: skippedBlank };
  }

  function initCsvImport() {
    var importBtn = document.getElementById('kw-import-btn');
    var fileInput = document.getElementById('kw-csv-input');
    importBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        var result = importKeywordsCsv(String(e.target.result));
        var summaryEl = document.getElementById('kw-import-summary');
        if (result.error) {
          summaryEl.textContent = result.error;
          summaryEl.hidden = false;
        } else {
          var parts = [result.imported + ' keyword' + (result.imported === 1 ? '' : 's') + ' imported'];
          if (result.skippedDup) parts.push(result.skippedDup + ' skipped as duplicate' + (result.skippedDup === 1 ? '' : 's'));
          if (result.skippedDeleted) parts.push(result.skippedDeleted + ' skipped as previously deleted');
          if (result.skippedBlank) parts.push(result.skippedBlank + ' skipped as blank');
          summaryEl.textContent = parts.join(', ') + '.';
          summaryEl.hidden = false;
          renderKeywordsTab();
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
  }

  /* ===========================================================
     CONTENT PLANNER
     =========================================================== */

  var contentFilters = { refreshOnly: false };

  var contentSelection = createBulkSelection({
    selectAllId: 'content-select-all',
    containerId: 'content-list',
    selectionRowId: 'content-selection-row',
    selectionCountId: 'content-selection-count',
    bulkDeleteBtnId: 'content-bulk-delete-btn',
    getVisibleItems: function () { return getVisibleContentItems(); },
    getAllItems: function () { return state.content; },
    getItemLabel: function (c) { return c.title; },
    nounSingular: 'content item',
    nounPlural: 'content items',
    extraDeleteWarning: '', // no tombstone list here — not sourced from a re-importable CSV
    performDelete: function (idSet) {
      state.content = state.content.filter(function (c) { return !idSet[c.id]; });
      saveContent();
    },
    afterDelete: function (count) {
      renderContentTab();
      renderKeywordsTab(); // "already added" state may change
      showToast(count + ' content item' + (count === 1 ? '' : 's') + ' deleted.');
    },
    renderVisibleList: function () { renderContentList(); }
  });

  function monthsSince(dateStr) {
    if (!dateStr) return null;
    var then = new Date(dateStr + 'T00:00:00');
    if (isNaN(then.getTime())) return null;
    var now = new Date();
    var months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
    if (now.getDate() < then.getDate()) months -= 1;
    return Math.max(0, months);
  }

  function freshnessDate(item) {
    return item.lastUpdatedDate || item.publishedDate || null;
  }

  function isStale(item) {
    if (item.status !== 'Published (v1)' && item.status !== 'Refined (v2+)') return false;
    var d = freshnessDate(item);
    if (!d) return false;
    var m = monthsSince(d);
    return m !== null && m > 6;
  }

  function contentCountsSummary() {
    var counts = { total: state.content.length, stale: 0 };
    state.content.forEach(function (c) { if (isStale(c)) counts.stale++; });
    return counts;
  }

  function renderContentCounts() {
    var c = contentCountsSummary();
    var el = document.getElementById('content-counts');
    el.innerHTML =
      '<span class="count-chip">' + c.total + ' item' + (c.total === 1 ? '' : 's') + '</span>' +
      (c.stale ? '<span class="count-chip skip">' + c.stale + ' need refresh</span>' : '<span class="count-chip go">0 need refresh</span>');
  }

  function groupByCluster(items) {
    var groups = {};
    items.forEach(function (item) {
      var key = item.cluster && item.cluster.trim() ? item.cluster.trim() : 'Uncategorized';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }

  function clusterProgressSummary(items) {
    var counts = {};
    STATUS_STAGES.forEach(function (s) { counts[s] = 0; });
    items.forEach(function (i) { counts[i.status] = (counts[i.status] || 0) + 1; });
    var doneLike = counts['Published (v1)'] + counts['Refined (v2+)'];
    var parts = STATUS_STAGES
      .filter(function (s) { return counts[s] > 0; })
      .map(function (s) { return counts[s] + ' ' + s; })
      .join(', ');
    return (parts || 'No items yet') + ' (' + doneLike + '/' + items.length + ' done)';
  }

  // Renders the "From keyword: … — SERP: …" line linking back to the
  // originating keyword (see buildContentItemFromKeyword's sourceKeywordId).
  // Degrades gracefully to nothing if there's no source id, or the source
  // keyword was since deleted — never throws.
  function contentSourceKeywordLine(item) {
    var kw = item.sourceKeywordId ? findKeywordById(item.sourceKeywordId) : null;
    if (!kw) return '';
    var verdict = kw.serpVerdict ? serpVerdictLabel(kw.serpVerdict) : 'Not checked';
    return (
      '<div class="content-card-source">From keyword: <span class="mono">' + escapeHtml(kw.phrase) + '</span>' +
      ' — SERP: ' + escapeHtml(verdict) +
      (kw.note ? '<br><em>' + escapeHtml(kw.note) + '</em>' : '') +
      '</div>'
    );
  }

  function contentCard(item) {
    var stale = isStale(item);
    var months = monthsSince(freshnessDate(item));
    var freshnessLabel = months === null ? 'No update recorded' : (months + ' month' + (months === 1 ? '' : 's') + ' since last update');
    return (
      '<div class="content-card' + (stale ? ' stale' : '') + '" data-id="' + item.id + '">' +
        '<div class="content-card-top">' +
          '<div class="card-checkbox-wrap">' +
            '<input type="checkbox" class="row-checkbox" data-id="' + item.id + '"' +
              (contentSelection.isSelected(item.id) ? ' checked' : '') +
              ' aria-label="Select ' + escapeHtml(item.title) + '">' +
          '</div>' +
          '<div>' +
            '<div class="content-card-title">' + escapeHtml(item.title) +
              (stale ? '<span class="badge badge-stale">Needs refresh</span>' : '') +
            '</div>' +
            (item.targetKeyword ? '<div class="content-card-kw">Target: ' + escapeHtml(item.targetKeyword) + '</div>' : '') +
          '</div>' +
          '<span class="status-pill">' + escapeHtml(item.status) + '</span>' +
        '</div>' +
        contentSourceKeywordLine(item) +
        '<div class="content-card-meta">' +
          '<span>Target publish: ' + escapeHtml(item.targetPublishDate || '—') + '</span>' +
          '<span>Published: ' + escapeHtml(item.publishedDate || '—') + '</span>' +
          '<span>Last updated: ' + escapeHtml(item.lastUpdatedDate || '—') + '</span>' +
          '<span>' + freshnessLabel + '</span>' +
        '</div>' +
        (item.notes ? '<div class="content-card-notes">' + escapeHtml(item.notes) + '</div>' : '') +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-small" data-action="edit" data-id="' + item.id + '">Edit</button>' +
          '<button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="' + item.id + '">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }

  // Content items currently visible under the active "Needs refresh only"
  // filter, i.e. exactly what's rendered right now (regardless of which
  // cluster accordion sections happen to be expanded/collapsed on screen).
  // Shared by renderContentList and the "select all visible" checkbox.
  function getVisibleContentItems() {
    var items = state.content.slice();
    if (contentFilters.refreshOnly) {
      items = items.filter(isStale);
    }
    return items;
  }

  function renderContentList() {
    var container = document.getElementById('content-list');
    var items = getVisibleContentItems();

    document.getElementById('content-empty').hidden = state.content.length !== 0;

    if (items.length === 0) {
      container.innerHTML = contentFilters.refreshOnly && state.content.length
        ? '<p class="empty-state">Nothing needs a refresh right now.</p>'
        : '';
      return;
    }

    var groups = groupByCluster(items);
    var clusterNames = Object.keys(groups).sort(function (a, b) {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });

    container.innerHTML = clusterNames.map(function (name) {
      var groupItems = groups[name];
      var summary = clusterProgressSummary(groupItems);
      return (
        '<details class="cluster-section" open>' +
          '<summary class="cluster-summary">' +
            '<span>' + escapeHtml(name) + '</span>' +
            '<span class="cluster-meta">' + escapeHtml(summary) + '</span>' +
          '</summary>' +
          '<div class="cluster-body">' +
            groupItems.map(contentCard).join('') +
          '</div>' +
        '</details>'
      );
    }).join('');
  }

  function renderContentTab() {
    renderContentCounts();
    renderContentList();
    refreshClusterDatalists();
    refreshKeywordDatalist();
    contentSelection.updateSelectionUI();
  }

  /* ---------- Content add/edit dialog ---------- */
  var contentDialogPrevStatus = null;

  function openContentDialog(item) {
    var dialog = document.getElementById('content-dialog');
    document.getElementById('content-dialog-title').textContent = item ? 'Edit content item' : 'Add content item';
    document.getElementById('content-id').value = item ? item.id : '';
    document.getElementById('content-title').value = item ? item.title : '';
    document.getElementById('content-keyword').value = item ? (item.targetKeyword || '') : '';
    document.getElementById('content-cluster').value = item ? (item.cluster || '') : '';
    document.getElementById('content-status').value = item ? item.status : 'Idea';
    document.getElementById('content-target-date').value = item ? (item.targetPublishDate || '') : '';
    document.getElementById('content-published-date').value = item ? (item.publishedDate || '') : '';
    document.getElementById('content-updated-date').value = item ? (item.lastUpdatedDate || '') : '';
    document.getElementById('content-notes').value = item ? (item.notes || '') : '';
    contentDialogPrevStatus = item ? item.status : null;
    refreshClusterDatalists();
    refreshKeywordDatalist();
    dialog.showModal();
    document.getElementById('content-title').focus();
  }

  function initContentForm() {
    document.getElementById('content-add-btn').addEventListener('click', function () { openContentDialog(null); });
    document.getElementById('content-cancel-btn').addEventListener('click', function () {
      document.getElementById('content-dialog').close();
    });

    document.getElementById('content-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = document.getElementById('content-title').value.trim();
      if (!title) { document.getElementById('content-title').focus(); return; }

      var id = document.getElementById('content-id').value;
      var targetKeyword = document.getElementById('content-keyword').value.trim();
      var cluster = document.getElementById('content-cluster').value.trim();
      var status = document.getElementById('content-status').value;
      var targetPublishDate = document.getElementById('content-target-date').value;
      var publishedDate = document.getElementById('content-published-date').value;
      var lastUpdatedDate = document.getElementById('content-updated-date').value;
      var notes = document.getElementById('content-notes').value.trim();

      // Auto-fill dates on status transition, per spec.
      var prevStatus = contentDialogPrevStatus;
      if (status === 'Published (v1)' && prevStatus !== 'Published (v1)' && !publishedDate) {
        publishedDate = todayISO();
      }
      if (status === 'Refined (v2+)' && prevStatus !== 'Refined (v2+)') {
        lastUpdatedDate = todayISO();
      }

      if (id) {
        var existing = state.content.find(function (c) { return c.id === id; });
        if (existing) {
          existing.title = title;
          existing.targetKeyword = targetKeyword;
          existing.cluster = cluster;
          existing.status = status;
          existing.targetPublishDate = targetPublishDate;
          existing.publishedDate = publishedDate;
          existing.lastUpdatedDate = lastUpdatedDate;
          existing.notes = notes;
        }
        showToast('Content item updated.');
      } else {
        var newContentId = uid();
        state.content.push({
          id: newContentId,
          title: title,
          targetKeyword: targetKeyword,
          cluster: cluster,
          status: status,
          targetPublishDate: targetPublishDate,
          publishedDate: publishedDate,
          lastUpdatedDate: lastUpdatedDate,
          notes: notes,
          createdAt: todayISO()
        });
        showToast('Content item added.');
      }
      saveContent();
      document.getElementById('content-dialog').close();
      renderContentTab();
      renderKeywordsTab(); // "already added" state may change
      if (!id && typeof newContentId !== 'undefined') {
        flashElement(document.querySelector('.content-card[data-id="' + newContentId + '"]'));
      }
    });
  }

  function initContentListActions() {
    document.getElementById('content-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      var item = state.content.find(function (c) { return c.id === id; });
      if (!item) return;

      if (action === 'edit') {
        openContentDialog(item);
      } else if (action === 'delete') {
        confirmAction('Delete the content item "' + item.title + '"? This cannot be undone.', function () {
          var cardEl = document.querySelector('.content-card[data-id="' + id + '"]');
          removeWithFade(cardEl, 'card-removing', function () {
            state.content = state.content.filter(function (c) { return c.id !== id; });
            contentSelection.unselect(id);
            saveContent();
            renderContentTab();
            renderKeywordsTab();
            showToast('Content item deleted.');
          });
        }, { label: 'Delete', danger: true });
      }
    });
  }

  function initContentFilters() {
    document.getElementById('content-filter-refresh').addEventListener('change', function (e) {
      contentFilters.refreshOnly = e.target.checked;
      renderContentList();
      contentSelection.updateSelectionUI();
    });
  }

  /* ---------- Content bulk cluster-tagging ---------- */
  // Same pattern as the Keyword tab's bulk cluster action (see
  // openKwBulkClusterDialog) — small enough to add here too given the
  // shared selection controller already does the heavy lifting.

  function openContentBulkClusterDialog() {
    var items = contentSelection.getSelectedItems();
    if (items.length === 0) return;
    document.getElementById('content-bulk-cluster-desc').textContent =
      'Sets the cluster for ' + items.length + ' selected content item' + (items.length === 1 ? '' : 's') + '.';
    var input = document.getElementById('content-bulk-cluster-input');
    input.value = '';
    refreshClusterDatalists();
    document.getElementById('content-bulk-cluster-dialog').showModal();
    input.focus();
  }

  function initContentBulkCluster() {
    document.getElementById('content-bulk-set-cluster-btn').addEventListener('click', openContentBulkClusterDialog);
    document.getElementById('content-bulk-cluster-cancel-btn').addEventListener('click', function () {
      document.getElementById('content-bulk-cluster-dialog').close();
    });
    document.getElementById('content-bulk-cluster-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('content-bulk-cluster-input');
      var cluster = input.value.trim();
      if (!cluster) { input.focus(); return; }
      var items = contentSelection.getSelectedItems();
      items.forEach(function (c) { c.cluster = cluster; });
      saveContent();
      document.getElementById('content-bulk-cluster-dialog').close();
      renderContentTab();
      showToast(items.length + ' content item' + (items.length === 1 ? '' : 's') + ' set to cluster "' + cluster + '".');
    });
  }

  /* ===========================================================
     JSON EXPORT / IMPORT (backup / portability)
     =========================================================== */

  var BACKUP_VERSION = 1;

  function exportJson() {
    var payload = {
      exportedAt: new Date().toISOString(),
      version: BACKUP_VERSION,
      keywords: state.keywords,
      content: state.content,
      deletedPhrases: state.deletedPhrases
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = todayISO();
    a.href = url;
    a.download = 'plant-based-content-planner-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Backup exported.');
  }

  // Minimal shape validation for an imported backup file: confirms the
  // version marker (when present) matches what this app writes, and that
  // every keyword/content item has at minimum the fields the rest of the
  // app assumes exist (id, and phrase/title respectively) before any of it
  // touches state — malformed data here would otherwise crash rendering
  // later, potentially after the user's *current* data has already been
  // overwritten. Returns an error string, or null if the file looks valid
  // enough to import.
  function validateBackupData(data) {
    if (!data || typeof data !== 'object') {
      return 'That file does not look like a planner backup.';
    }
    if (data.version !== undefined && data.version !== BACKUP_VERSION) {
      return 'This backup is version ' + data.version + ', but this app expects version ' +
        BACKUP_VERSION + '. Export a fresh backup from the current version of this app, or double-check you picked the right file.';
    }

    var hasKeywords = Array.isArray(data.keywords);
    var hasContent = Array.isArray(data.content);
    if (!hasKeywords && !hasContent) {
      return 'That file does not look like a planner backup — no keywords or content arrays found.';
    }

    if (hasKeywords) {
      for (var i = 0; i < data.keywords.length; i++) {
        var k = data.keywords[i];
        if (!k || typeof k !== 'object' || !k.id || !k.phrase) {
          return 'Keyword #' + (i + 1) + ' in this file is missing an id or phrase. Import cancelled so it doesn\'t corrupt your data — check the file wasn\'t edited or truncated.';
        }
      }
    }
    if (hasContent) {
      for (var j = 0; j < data.content.length; j++) {
        var c = data.content[j];
        if (!c || typeof c !== 'object' || !c.id || !c.title) {
          return 'Content item #' + (j + 1) + ' in this file is missing an id or title. Import cancelled so it doesn\'t corrupt your data — check the file wasn\'t edited or truncated.';
        }
      }
    }
    if (data.deletedPhrases !== undefined && !Array.isArray(data.deletedPhrases)) {
      return 'This file\'s deletedPhrases field is malformed. Import cancelled so it doesn\'t corrupt your data.';
    }
    return null;
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var data;
      try {
        data = JSON.parse(String(e.target.result));
      } catch (err) {
        showToast('Could not parse that file as JSON.');
        return;
      }

      var validationError = validateBackupData(data);
      if (validationError) {
        showToast(validationError);
        return;
      }

      var versionMissing = data.version === undefined;
      var confirmMsg = 'Importing will replace ALL current keywords and content items with the contents of this backup file. This cannot be undone.' +
        (versionMissing ? ' (This file has no version marker — it will be imported as-is.)' : '') +
        ' Continue?';

      confirmAction(
        confirmMsg,
        function () {
          state.keywords = Array.isArray(data.keywords) ? data.keywords : [];
          state.content = Array.isArray(data.content) ? data.content : [];
          state.deletedPhrases = Array.isArray(data.deletedPhrases) ? data.deletedPhrases : [];
          kwSelection.clear();
          contentSelection.clear();
          saveKeywords();
          saveContent();
          saveDeletedPhrases();
          renderKeywordsTab();
          renderContentTab();
          showToast('Backup imported.' + (versionMissing ? ' (No version marker found in the file.)' : ''));
        },
        { label: 'Replace data', danger: true }
      );
    };
    reader.readAsText(file);
  }

  function initJsonBackup() {
    document.getElementById('export-json-btn').addEventListener('click', exportJson);
    var importBtn = document.getElementById('import-json-btn');
    var fileInput = document.getElementById('json-input');
    importBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (file) importJson(file);
      fileInput.value = '';
    });
  }

  /* ===========================================================
     Multi-tab awareness
     =========================================================== */
  // Warns the user when this tab's copy of the data has gone stale because
  // another tab/window (same browser, same origin) wrote to localStorage.
  // The storage event only fires in *other* tabs than the one that made the
  // write, which is exactly the tab we need to warn — it still has the old
  // data in memory and would silently clobber the newer write on its next
  // save otherwise. Deliberately does not auto-reload or auto-merge; the
  // user chooses when it's safe to reload.
  function initMultiTabWarning() {
    var watchedKeys = { };
    watchedKeys[LS_KEYWORDS] = true;
    watchedKeys[LS_CONTENT] = true;
    watchedKeys[LS_DELETED_PHRASES] = true;

    window.addEventListener('storage', function (e) {
      // e.key is null when the change was a full localStorage.clear() in the
      // other tab — treat that as relevant too, since it affects our data.
      if (e.key !== null && !watchedKeys[e.key]) return;
      if (e.key !== null && e.newValue === e.oldValue) return;
      document.getElementById('multi-tab-banner').hidden = false;
    });

    document.getElementById('multi-tab-reload-btn').addEventListener('click', function () {
      window.location.reload();
    });
    document.getElementById('multi-tab-dismiss-btn').addEventListener('click', function () {
      document.getElementById('multi-tab-banner').hidden = true;
    });
  }

  /* ===========================================================
     Init
     =========================================================== */
  function init() {
    loadState();
    initTheme();
    initTabs();
    initKwForm();
    initKwTableActions();
    initKwFilters();
    kwSelection.init();
    initKwBulkCluster();
    initDeletedPhrasesDialog();
    initCsvImport();
    initKwSelectionActions();
    initSerpReview();
    initSerpPopover();
    initContentForm();
    initContentListActions();
    initContentFilters();
    contentSelection.init();
    initContentBulkCluster();
    initJsonBackup();
    initMultiTabWarning();
    renderKeywordsTab();
    renderContentTab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
