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
    content: []
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
  }

  function saveKeywords() {
    localStorage.setItem(LS_KEYWORDS, JSON.stringify(state.keywords));
  }
  function saveContent() {
    localStorage.setItem(LS_CONTENT, JSON.stringify(state.content));
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

  // Core decision rule table, per spec.
  function computeDecision(kw) {
    var bucket = volumeBucketLabel(kw);
    var competition = kw.competition;

    if (bucket === null || !competition) return '—';

    if (bucket === '0') return 'Skip';

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
  function confirmAction(message, onConfirm) {
    var dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-dialog-body').textContent = message;
    dialog.showModal();
    var okBtn = document.getElementById('confirm-ok-btn');
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

  /* ===========================================================
     KEYWORD PLANNER
     =========================================================== */

  var kwFilters = { search: '', decision: 'all', sortVolume: 'none', serp: 'all' };

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

  function renderKwTable() {
    var tbody = document.getElementById('kw-tbody');
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

    document.getElementById('kw-empty').hidden = state.keywords.length !== 0;

    tbody.innerHTML = list.map(function (k) {
      var decision = computeDecision(k);
      var canSend = decision === 'Go' || decision === 'Maybe';
      var alreadyAdded = canSend && contentAlreadyExistsForKeyword(k.phrase);
      var sendBtn = '';
      if (canSend) {
        sendBtn = alreadyAdded
          ? '<span class="badge badge-pending" title="A content item already targets this keyword">Already added</span>'
          : '<button type="button" class="btn btn-small" data-action="send" data-id="' + k.id + '">Send to Content</button>';
      }
      return (
        '<tr data-id="' + k.id + '">' +
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
    renderKwCounts();
    renderKwTable();
    refreshClusterDatalists();
    refreshKeywordDatalist();
    updateBulkActionButtons();
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
            saveKeywords();
            renderKeywordsTab();
            showToast('Keyword deleted.');
          });
        });
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
      createdAt: todayISO()
    };
  }

  function sendKeywordToContentPlanner(kw) {
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

  /* ---------- Bulk keyword actions ---------- */

  // Keywords whose Competition is blank/unset (Google Keyword Planner
  // commonly leaves this blank for informational/recipe queries).
  function blankCompetitionKeywords() {
    return state.keywords.filter(function (k) { return !k.competition; });
  }

  // Keywords eligible for the bulk "send to Content Planner" action: a
  // Go decision (plus Maybe when includeMaybe is set) that doesn't already
  // have a linked Content Planner entry — run through the exact same
  // dedupe check the single-row "Send to Content" action uses.
  function eligibleForBulkSend(includeMaybe) {
    return state.keywords.filter(function (k) {
      var d = computeDecision(k);
      if (d !== 'Go' && !(includeMaybe && d === 'Maybe')) return false;
      return !contentAlreadyExistsForKeyword(k.phrase);
    });
  }

  function updateBulkActionButtons() {
    var blankCount = blankCompetitionKeywords().length;
    var competitionBtn = document.getElementById('kw-bulk-competition-btn');
    competitionBtn.disabled = blankCount === 0;
    competitionBtn.textContent = 'Set blank competition to Low' + (blankCount ? ' (' + blankCount + ')' : '');

    // Enable whenever there's anything to send in either mode (Go-only or
    // Go+Maybe) — the dialog's checkbox lets the user pick which.
    var anyEligible = eligibleForBulkSend(true).length > 0;
    document.getElementById('kw-bulk-send-btn').disabled = !anyEligible;

    var serpCount = serpReviewQueue().length;
    var serpBtn = document.getElementById('kw-bulk-serp-btn');
    serpBtn.disabled = serpCount === 0;
    serpBtn.textContent = 'Start SERP Review' + (serpCount ? ' (' + serpCount + ')' : '');
  }

  function bulkSetBlankCompetitionToLow() {
    var count = blankCompetitionKeywords().length;
    if (count === 0) return;
    confirmAction(
      count + ' keyword' + (count === 1 ? '' : 's') + ' currently have unset Competition. They will be set to "Low". Continue?',
      function () {
        var updated = 0;
        state.keywords.forEach(function (k) {
          if (!k.competition) { k.competition = 'Low'; updated++; }
        });
        saveKeywords();
        renderKeywordsTab();
        showToast(updated + ' keyword' + (updated === 1 ? '' : 's') + ' updated to Low competition.');
      }
    );
  }

  function updateBulkSendDialogBody() {
    var includeMaybe = document.getElementById('bulk-send-include-maybe').checked;
    var n = eligibleForBulkSend(includeMaybe).length;
    var decisionLabel = includeMaybe ? 'Go or Maybe' : 'Go';
    document.getElementById('bulk-send-dialog-body').textContent =
      n + ' keyword' + (n === 1 ? '' : 's') + ' with a ' + decisionLabel +
      ' decision (and no existing Content Planner entry) will be sent as new "Idea" items. Continue?';
    document.getElementById('bulk-send-ok-btn').disabled = n === 0;
  }

  function openBulkSendDialog() {
    if (eligibleForBulkSend(true).length === 0) return;
    var checkbox = document.getElementById('bulk-send-include-maybe');
    checkbox.checked = false;
    updateBulkSendDialogBody();
    document.getElementById('bulk-send-dialog').showModal();
  }

  function bulkSendGoToContentPlanner(includeMaybe) {
    var eligible = eligibleForBulkSend(includeMaybe);
    var sent = 0, skipped = 0;
    eligible.forEach(function (kw) {
      // Re-check as we go: two eligible keywords could share a phrase, in
      // which case the first one sent makes the second a duplicate.
      if (contentAlreadyExistsForKeyword(kw.phrase)) { skipped++; return; }
      state.content.push(buildContentItemFromKeyword(kw));
      sent++;
    });
    saveContent();
    renderKeywordsTab();
    renderContentTab();
    var msg = sent + ' keyword' + (sent === 1 ? '' : 's') + ' sent to Content Planner.';
    if (skipped) msg += ' ' + skipped + ' already existed and ' + (skipped === 1 ? 'was' : 'were') + ' skipped.';
    showToast(msg);
  }

  function initBulkActions() {
    document.getElementById('kw-bulk-competition-btn').addEventListener('click', bulkSetBlankCompetitionToLow);
    document.getElementById('kw-bulk-send-btn').addEventListener('click', openBulkSendDialog);

    document.getElementById('bulk-send-include-maybe').addEventListener('change', updateBulkSendDialogBody);
    document.getElementById('bulk-send-cancel-btn').addEventListener('click', function () {
      document.getElementById('bulk-send-dialog').close();
    });
    document.getElementById('bulk-send-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var includeMaybe = document.getElementById('bulk-send-include-maybe').checked;
      document.getElementById('bulk-send-dialog').close();
      bulkSendGoToContentPlanner(includeMaybe);
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

  // Ids skipped ("Review later") during the *current* open review session.
  // Not persisted anywhere — reset each time the dialog is opened/closed —
  // so those keywords simply reappear next time serpReviewQueue() is read
  // fresh, per spec.
  var serpReviewSkippedIds = [];

  function serpReviewRemaining() {
    var full = serpReviewQueue();
    return full.filter(function (k) { return serpReviewSkippedIds.indexOf(k.id) === -1; });
  }

  function renderSerpReview() {
    var full = serpReviewQueue();
    var remaining = full.filter(function (k) { return serpReviewSkippedIds.indexOf(k.id) === -1; });
    var total = full.length;
    var progressEl = document.getElementById('serp-review-progress');
    var bodyEl = document.getElementById('serp-review-body');

    if (total === 0) {
      progressEl.textContent = 'Review complete';
      bodyEl.innerHTML =
        '<div class="serp-review-empty">' +
          '<p>All caught up — every Go/Maybe keyword has a SERP verdict.</p>' +
          '<button type="button" class="btn btn-primary" id="serp-review-done-btn">Close</button>' +
        '</div>';
      document.getElementById('serp-review-done-btn').addEventListener('click', closeSerpReview);
      updateBulkActionButtons();
      return;
    }

    // Everything left in the live queue has been "Review later"-skipped
    // earlier in this same session — nothing new to show right now, but
    // (per spec) those keywords are still unverdicted and will reappear
    // next time the queue is computed fresh, e.g. next time Review opens.
    if (remaining.length === 0) {
      progressEl.textContent = 'Review paused';
      bodyEl.innerHTML =
        '<div class="serp-review-empty">' +
          '<p>' + total + ' keyword' + (total === 1 ? '' : 's') + ' marked "Review later" — ' +
          (total === 1 ? 'it' : 'they') + ' will reappear next time you open SERP Review.</p>' +
          '<button type="button" class="btn btn-primary" id="serp-review-done-btn">Close</button>' +
        '</div>';
      document.getElementById('serp-review-done-btn').addEventListener('click', closeSerpReview);
      return;
    }

    var current = remaining[0];
    var index = total - remaining.length + 1;
    progressEl.textContent = 'Reviewing ' + index + ' of ' + total;

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
    } else {
      serpReviewSkippedIds.push(currentId);
    }
    renderSerpReview();
    renderKeywordsTab();
  }

  function closeSerpReview() {
    document.getElementById('serp-review-dialog').close();
  }

  function initSerpReview() {
    document.getElementById('kw-bulk-serp-btn').addEventListener('click', function () {
      var queue = serpReviewQueue();
      if (queue.length === 0) return;
      serpReviewSkippedIds = [];
      renderSerpReview();
      document.getElementById('serp-review-dialog').showModal();
    });

    document.getElementById('serp-review-close-btn').addEventListener('click', closeSerpReview);
    document.getElementById('serp-review-dialog').addEventListener('close', function () {
      serpReviewSkippedIds = [];
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
    document.getElementById('kw-search').addEventListener('input', debounce(function (e) {
      kwFilters.search = e.target.value;
      renderKwTable();
    }, 150));
    document.getElementById('kw-filter-decision').addEventListener('change', function (e) {
      kwFilters.decision = e.target.value;
      renderKwTable();
    });
    document.getElementById('kw-sort-volume').addEventListener('change', function (e) {
      kwFilters.sortVolume = e.target.value;
      renderKwTable();
    });
    document.getElementById('kw-filter-serp').addEventListener('change', function (e) {
      kwFilters.serp = e.target.value;
      renderKwTable();
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

    var imported = 0, skippedDup = 0, skippedBlank = 0;

    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.every(function (c) { return c.trim() === ''; })) continue;

      var phrase = idxKeyword !== -1 ? (row[idxKeyword] || '').trim() : '';
      if (!phrase) { skippedBlank++; continue; }

      var normPhrase = phrase.toLowerCase();
      if (existingPhrases[normPhrase]) { skippedDup++; continue; }

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
    return { imported: imported, skippedDup: skippedDup, skippedBlank: skippedBlank };
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

  function contentCard(item) {
    var stale = isStale(item);
    var months = monthsSince(freshnessDate(item));
    var freshnessLabel = months === null ? 'No update recorded' : (months + ' month' + (months === 1 ? '' : 's') + ' since last update');
    return (
      '<div class="content-card' + (stale ? ' stale' : '') + '" data-id="' + item.id + '">' +
        '<div class="content-card-top">' +
          '<div>' +
            '<div class="content-card-title">' + escapeHtml(item.title) +
              (stale ? '<span class="badge badge-stale">Needs refresh</span>' : '') +
            '</div>' +
            (item.targetKeyword ? '<div class="content-card-kw">Target: ' + escapeHtml(item.targetKeyword) + '</div>' : '') +
          '</div>' +
          '<span class="status-pill">' + escapeHtml(item.status) + '</span>' +
        '</div>' +
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

  function renderContentList() {
    var container = document.getElementById('content-list');
    var items = state.content.slice();

    if (contentFilters.refreshOnly) {
      items = items.filter(isStale);
    }

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
            saveContent();
            renderContentTab();
            renderKeywordsTab();
            showToast('Content item deleted.');
          });
        });
      }
    });
  }

  function initContentFilters() {
    document.getElementById('content-filter-refresh').addEventListener('change', function (e) {
      contentFilters.refreshOnly = e.target.checked;
      renderContentList();
    });
  }

  /* ===========================================================
     JSON EXPORT / IMPORT (backup / portability)
     =========================================================== */

  function exportJson() {
    var payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      keywords: state.keywords,
      content: state.content
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
      if (!data || (!Array.isArray(data.keywords) && !Array.isArray(data.content))) {
        showToast('That file does not look like a planner backup.');
        return;
      }
      confirmAction(
        'Importing will replace ALL current keywords and content items with the contents of this backup file. This cannot be undone. Continue?',
        function () {
          state.keywords = Array.isArray(data.keywords) ? data.keywords : [];
          state.content = Array.isArray(data.content) ? data.content : [];
          saveKeywords();
          saveContent();
          renderKeywordsTab();
          renderContentTab();
          showToast('Backup imported.');
        }
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
     Init
     =========================================================== */
  function init() {
    loadState();
    initTheme();
    initTabs();
    initKwForm();
    initKwTableActions();
    initKwFilters();
    initCsvImport();
    initBulkActions();
    initSerpReview();
    initSerpPopover();
    initContentForm();
    initContentListActions();
    initContentFilters();
    initJsonBackup();
    renderKeywordsTab();
    renderContentTab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
