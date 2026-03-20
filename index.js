// AutoPipe Plugin: bed-viewer
// Interactive BED file viewer with column detection, sorting, filtering, pagination

(function() {
  var BED_HEADERS = ['chrom','chromStart','chromEnd','name','score','strand',
    'thickStart','thickEnd','itemRgb','blockCount','blockSizes','blockStarts'];
  var PAGE_SIZE = 100;

  // State
  var allRecords = [];
  var filteredRecords = [];
  var ncols = 0;
  var sortCol = -1;
  var sortAsc = true;
  var currentPage = 0;
  var filterText = '';
  var filterChrom = '';
  var rootEl = null;

  // Saved params for re-render after tab switch
  var _savedFileUrl = '';
  var _savedFilename = '';

  function parse(text) {
    var lines = text.split('\n');
    var recs = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l || l[0] === '#' || l.indexOf('track') === 0 || l.indexOf('browser') === 0) continue;
      recs.push(l.split('\t'));
    }
    return recs;
  }

  function getChromList(recs) {
    var seen = {};
    var list = [];
    for (var i = 0; i < recs.length; i++) {
      var c = recs[i][0];
      if (!seen[c]) { seen[c] = true; list.push(c); }
    }
    return list;
  }

  function regionLen(rec) {
    var s = parseInt(rec[1], 10);
    var e = parseInt(rec[2], 10);
    return isNaN(s) || isNaN(e) ? 0 : e - s;
  }

  function formatNum(n) {
    return n.toLocaleString();
  }

  function computeStats(recs) {
    var totalLen = 0;
    var minLen = Infinity;
    var maxLen = 0;
    for (var i = 0; i < recs.length; i++) {
      var len = regionLen(recs[i]);
      totalLen += len;
      if (len < minLen) minLen = len;
      if (len > maxLen) maxLen = len;
    }
    if (recs.length === 0) { minLen = 0; }
    return { total: totalLen, min: minLen, max: maxLen, avg: recs.length > 0 ? Math.round(totalLen / recs.length) : 0 };
  }

  function applyFilter() {
    var ft = filterText.toLowerCase();
    filteredRecords = allRecords.filter(function(rec) {
      if (filterChrom && rec[0] !== filterChrom) return false;
      if (ft) {
        var match = false;
        for (var i = 0; i < rec.length; i++) {
          if (rec[i].toLowerCase().indexOf(ft) >= 0) { match = true; break; }
        }
        if (!match) return false;
      }
      return true;
    });
    currentPage = 0;
  }

  function doSort(col) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
    filteredRecords.sort(function(a, b) {
      var va = a[col] || '';
      var vb = b[col] || '';
      // Numeric sort for start, end, score columns
      if (col === 1 || col === 2 || col === 4 || col === 6 || col === 7 || col === 9) {
        var na = parseFloat(va);
        var nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) {
          return sortAsc ? na - nb : nb - na;
        }
      }
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    currentPage = 0;
  }

  function renderChromCell(val) {
    return '<span class="chr-badge">' + val + '</span>';
  }

  function renderStrandCell(val) {
    if (val === '+') return '<span class="strand-plus">+</span>';
    if (val === '-') return '<span class="strand-minus">-</span>';
    return val || '.';
  }

  function renderScoreCell(val) {
    var n = parseFloat(val);
    if (isNaN(n)) return val || '.';
    var pct = Math.min(100, Math.max(0, n / 1000 * 100));
    return '<span class="score-bar-bg"><span class="score-bar-fill" style="width:' + pct + '%"></span></span>' + val;
  }

  function render() {
    // Target the #__plugin_content__ div if it exists (tab mode), else rootEl
    var target = (rootEl && rootEl.querySelector('#__plugin_content__')) || rootEl;
    if (!target) return;

    var stats = computeStats(filteredRecords);
    var chroms = getChromList(allRecords);
    var totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    var startIdx = currentPage * PAGE_SIZE;
    var pageRecs = filteredRecords.slice(startIdx, startIdx + PAGE_SIZE);

    var headers = BED_HEADERS.slice(0, ncols);
    // Add computed Length column
    var showLen = ncols >= 3;

    var html = '<div class="bed-plugin">';

    // Summary
    html += '<div class="bed-summary">';
    html += '<span class="stat"><b>' + formatNum(filteredRecords.length) + '</b> regions</span>';
    html += '<span class="stat"><b>' + chroms.length + '</b> chromosomes</span>';
    html += '<span class="stat">BED' + ncols + ' format</span>';
    if (showLen) {
      html += '<span class="stat">Avg length: <b>' + formatNum(stats.avg) + ' bp</b></span>';
      html += '<span class="stat">Range: <b>' + formatNum(stats.min) + ' - ' + formatNum(stats.max) + ' bp</b></span>';
    }
    if (filteredRecords.length !== allRecords.length) {
      html += '<span class="stat" style="color:#c62828">(' + formatNum(allRecords.length - filteredRecords.length) + ' filtered out)</span>';
    }
    html += '</div>';

    // Controls
    html += '<div class="bed-controls">';
    html += '<input type="text" id="bedFilter" placeholder="Search regions..." value="' + filterText.replace(/"/g, '&quot;') + '">';
    html += '<select id="bedChromFilter"><option value="">All chromosomes</option>';
    for (var ci = 0; ci < chroms.length; ci++) {
      var sel = chroms[ci] === filterChrom ? ' selected' : '';
      html += '<option value="' + chroms[ci] + '"' + sel + '>' + chroms[ci] + '</option>';
    }
    html += '</select>';
    html += '</div>';

    // Table
    html += '<div class="bed-table-wrap" style="max-height:500px;overflow:auto;">';
    html += '<table class="bed-table"><thead><tr>';
    html += '<th>#</th>';
    for (var hi = 0; hi < headers.length; hi++) {
      var arrow = '';
      if (sortCol === hi) arrow = '<span class="sort-arrow">' + (sortAsc ? '\u25B2' : '\u25BC') + '</span>';
      html += '<th data-col="' + hi + '">' + headers[hi] + arrow + '</th>';
    }
    if (showLen) html += '<th>length</th>';
    html += '</tr></thead><tbody>';

    for (var ri = 0; ri < pageRecs.length; ri++) {
      var rec = pageRecs[ri];
      html += '<tr>';
      html += '<td style="color:#aaa">' + (startIdx + ri + 1) + '</td>';
      for (var ci2 = 0; ci2 < ncols; ci2++) {
        var val = rec[ci2] || '';
        if (ci2 === 0) html += '<td>' + renderChromCell(val) + '</td>';
        else if (ci2 === 1 || ci2 === 2) html += '<td>' + formatNum(parseInt(val, 10) || 0) + '</td>';
        else if (ci2 === 4) html += '<td>' + renderScoreCell(val) + '</td>';
        else if (ci2 === 5) html += '<td>' + renderStrandCell(val) + '</td>';
        else html += '<td>' + val + '</td>';
      }
      if (showLen) {
        html += '<td><span class="region-len">' + formatNum(regionLen(rec)) + ' bp</span></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Pagination
    if (totalPages > 1) {
      html += '<div class="bed-pagination">';
      html += '<button data-page="prev">&laquo; Prev</button>';
      var startP = Math.max(0, currentPage - 3);
      var endP = Math.min(totalPages, startP + 7);
      if (startP > 0) html += '<button data-page="0">1</button><span>...</span>';
      for (var p = startP; p < endP; p++) {
        var cls = p === currentPage ? ' class="current"' : '';
        html += '<button data-page="' + p + '"' + cls + '>' + (p + 1) + '</button>';
      }
      if (endP < totalPages) html += '<span>...</span><button data-page="' + (totalPages - 1) + '">' + totalPages + '</button>';
      html += '<button data-page="next">Next &raquo;</button>';
      html += '<span class="page-info">Page ' + (currentPage + 1) + ' of ' + totalPages + '</span>';
      html += '</div>';
    }

    html += '</div>';
    target.innerHTML = html;

    // Event listeners
    var filterInput = target.querySelector('#bedFilter');
    if (filterInput) {
      filterInput.addEventListener('input', function() {
        filterText = this.value;
        applyFilter();
        render();
      });
    }
    var chromSelect = target.querySelector('#bedChromFilter');
    if (chromSelect) {
      chromSelect.addEventListener('change', function() {
        filterChrom = this.value;
        applyFilter();
        render();
      });
    }

    // Sort headers
    var ths = target.querySelectorAll('.bed-table th[data-col]');
    for (var ti = 0; ti < ths.length; ti++) {
      ths[ti].addEventListener('click', function() {
        doSort(parseInt(this.getAttribute('data-col'), 10));
        render();
      });
    }

    // Pagination buttons
    var pageBtns = target.querySelectorAll('.bed-pagination button');
    for (var bi = 0; bi < pageBtns.length; bi++) {
      pageBtns[bi].addEventListener('click', function() {
        var pg = this.getAttribute('data-page');
        if (pg === 'prev') { if (currentPage > 0) currentPage--; }
        else if (pg === 'next') { var tp = Math.ceil(filteredRecords.length / PAGE_SIZE); if (currentPage < tp - 1) currentPage++; }
        else { currentPage = parseInt(pg, 10); }
        render();
      });
    }
  }

  // ── IGV.js integration ──
  var KNOWN_GENOMES = [
    {id:'hg38', label:'Human (GRCh38/hg38)'},
    {id:'hg19', label:'Human (GRCh37/hg19)'},
    {id:'mm39', label:'Mouse (GRCm39/mm39)'},
    {id:'mm10', label:'Mouse (GRCm38/mm10)'},
    {id:'rn7',  label:'Rat (mRatBN7.2/rn7)'},
    {id:'rn6',  label:'Rat (Rnor_6.0/rn6)'},
    {id:'dm6',  label:'Fruit fly (BDGP6/dm6)'},
    {id:'ce11', label:'C. elegans (WBcel235/ce11)'},
    {id:'danRer11', label:'Zebrafish (GRCz11/danRer11)'},
    {id:'sacCer3',  label:'Yeast (sacCer3)'},
    {id:'tair10',   label:'Arabidopsis (TAIR10)'},
    {id:'galGal6',  label:'Chicken (GRCg6a/galGal6)'}
  ];
  var _igvRef = null;
  var _igvMode = 'data';
  var _selectedGenome = null;

  function _fetchReference() {
    return fetch('/api/reference').then(function(r) { return r.json(); })
      .then(function(d) { _igvRef = d.reference || null; })
      .catch(function() { _igvRef = null; });
  }

  function _loadIgvJs() {
    return new Promise(function(resolve, reject) {
      if (window.igv) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/igv@3/dist/igv.min.js';
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load igv.js')); };
      document.head.appendChild(s);
    });
  }

  function _buildGenomeDropdown() {
    var current = _selectedGenome || _igvRef || '';
    var html = '<span style="font-size:12px;color:#888;font-weight:500;margin-right:4px">Reference:</span>';
    html += '<select id="__igv_genome_select__" style="font-size:12px;padding:4px 8px;max-width:220px;border:1px solid #ddd;border-radius:4px">';
    html += '<option value="' + (_igvRef || '') + '"' + (current === _igvRef ? ' selected' : '') + '>' + (_igvRef || 'none') + '</option>';
    KNOWN_GENOMES.forEach(function(g) {
      if (g.id !== _igvRef) {
        html += '<option value="' + g.id + '"' + (current === g.id ? ' selected' : '') + '>' + g.label + '</option>';
      }
    });
    html += '</select>';
    return html;
  }

  function _renderIgv(container, fileUrl, filename, trackType, trackFormat) {
    container.innerHTML = '<div id="__igv_div__" class="ap-loading">Loading...</div>';
    _loadIgvJs().then(function() {
      var div = document.getElementById('__igv_div__');
      if (!div) return;
      div.innerHTML = '';
      var activeRef = _selectedGenome || _igvRef;
      var opts = {};
      var knownIds = KNOWN_GENOMES.map(function(g) { return g.id; });
      if (knownIds.indexOf(activeRef) >= 0) {
        opts.genome = activeRef;
      } else {
        opts.reference = { fastaURL: '/file/' + encodeURIComponent(activeRef), indexed: false };
      }
      opts.tracks = [{ type: trackType, format: trackFormat, url: fileUrl, name: filename }];
      igv.createBrowser(div, opts);
    }).catch(function(e) {
      container.innerHTML = '<div style="color:red;padding:16px;">IGV Error: ' + e.message + '</div>';
    });
  }

  var TRACK_TYPE = 'annotation';
  var TRACK_FORMAT = 'bed';

  function _renderData(container, fileUrl, filename) {
    container.innerHTML = '<div class="ap-loading">Loading...</div>';

    // Reset state
    allRecords = [];
    filteredRecords = [];
    sortCol = -1;
    sortAsc = true;
    currentPage = 0;
    filterText = '';
    filterChrom = '';

    fetch(fileUrl)
      .then(function(resp) { return resp.text(); })
      .then(function(data) {
        allRecords = parse(data);
        ncols = 0;
        for (var i = 0; i < allRecords.length; i++) {
          if (allRecords[i].length > ncols) ncols = allRecords[i].length;
        }
        ncols = Math.min(ncols, 12); // BED12 max
        filteredRecords = allRecords.slice();
        render();
      })
      .catch(function(err) {
        container.innerHTML = '<p style="color:red;padding:16px;">Error loading BED file: ' + err.message + '</p>';
      });
  }

  function _showView(container, fileUrl, filename) {
    if (_igvRef) {
      var tabsHtml = '<div style="display:flex;gap:4px;margin-bottom:12px">';
      tabsHtml += '<button id="__tab_data__" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:13px;' + (_igvMode === 'data' ? 'background:#007bff;color:white;border-color:#007bff' : 'background:#f8f8f8') + '">Data</button>';
      tabsHtml += '<button id="__tab_igv__" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:13px;' + (_igvMode === 'igv' ? 'background:#007bff;color:white;border-color:#007bff' : 'background:#f8f8f8') + '">IGV</button>';
      tabsHtml += '</div>';
      if (_igvMode === 'igv') tabsHtml += _buildGenomeDropdown();
      container.innerHTML = tabsHtml + '<div id="__plugin_content__"></div>';

      container.querySelector('#__tab_data__').onclick = function() { _igvMode = 'data'; _showView(container, fileUrl, filename); };
      container.querySelector('#__tab_igv__').onclick = function() { _igvMode = 'igv'; _showView(container, fileUrl, filename); };
      var genomeSelect = container.querySelector('#__igv_genome_select__');
      if (genomeSelect) genomeSelect.onchange = function() { _selectedGenome = this.value; _showView(container, fileUrl, filename); };

      var content = container.querySelector('#__plugin_content__');
      if (_igvMode === 'igv') {
        _renderIgv(content, fileUrl, filename, TRACK_TYPE, TRACK_FORMAT);
      } else {
        _renderData(content, fileUrl, filename);
      }
    } else {
      _renderData(container, fileUrl, filename);
    }
  }

  window.AutoPipePlugin = {
    render: function(container, fileUrl, filename) {
      rootEl = container;
      _savedFileUrl = fileUrl;
      _savedFilename = filename;
      _igvMode = 'data';
      _selectedGenome = null;

      _fetchReference().then(function() {
        _showView(container, fileUrl, filename);
      });
    },

    destroy: function() {
      allRecords = [];
      filteredRecords = [];
      rootEl = null;
    }
  };
})();
