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
    var totalPages = Math.max(1, Math.ceil(_totalRecords / PAGE_SIZE));
    var startIdx = currentPage * PAGE_SIZE;
    var pageRecs = filteredRecords;

    var headers = BED_HEADERS.slice(0, ncols);
    // Add computed Length column
    var showLen = ncols >= 3;

    var html = '<div class="bed-plugin">';

    // Summary
    html += '<div class="bed-summary">';
    html += '<span class="stat"><b>' + formatNum(_totalRecords) + '</b> regions</span>';
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

    // Pagination buttons — server-side
    var pageBtns = target.querySelectorAll('.bed-pagination button');
    for (var bi = 0; bi < pageBtns.length; bi++) {
      pageBtns[bi].addEventListener('click', function() {
        var pg = this.getAttribute('data-page');
        var tp = Math.ceil(_totalRecords / PAGE_SIZE);
        if (pg === 'prev') { if (currentPage > 0) _loadPage(currentPage - 1); }
        else if (pg === 'next') { if (currentPage < tp - 1) _loadPage(currentPage + 1); }
        else { _loadPage(parseInt(pg, 10)); }
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
  var _igvBrowser = null;

  // Minimum width of the region IGV opens at, so a single narrow feature still
  // lands in a readable window rather than a few pixels wide.
  var IGV_MIN_WINDOW = 10000;

  function _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // The reference arrives either as a genome ID, a bare filename, or a full
  // path (show_results passes whatever the caller supplied). /file/ is keyed by
  // filename alone, so strip any directory part.
  function _refUrl(ref) {
    var base = String(ref).replace(/\\/g, '/').split('/').pop();
    return '/file/' + encodeURIComponent(base);
  }

  function _disposeIgvBrowser() {
    if (_igvBrowser) {
      // The host never calls destroy(), and igv.js keeps every browser it
      // creates in a module-level list. Without this, each tab switch leaks a
      // browser plus its listeners and caches.
      try { igv.removeBrowser(_igvBrowser); } catch (e) { /* already detached */ }
      _igvBrowser = null;
    }
  }

  // A 1-byte ranged GET is used rather than HEAD so this works on any server
  // that serves /file/.
  function _probeUrl(url) {
    return fetch(url, { headers: { Range: 'bytes=0-0' } })
      .then(function(r) { return r.ok ? url : null; })
      .catch(function() { return null; });
  }

  function _findIndex(fileUrl, exts) {
    var candidates = [];
    for (var i = 0; i < exts.length; i++) {
      candidates.push(fileUrl + '.' + exts[i]);
      candidates.push(fileUrl.replace(/\.[^.\/]+$/, '.' + exts[i]));
    }
    return candidates.reduce(function(chain, url) {
      return chain.then(function(found) { return found || _probeUrl(url); });
    }, Promise.resolve(null));
  }

  // Without an explicit locus igv.js opens at the whole first chromosome, or
  // the whole genome when the reference has several contigs — features are
  // then sub-pixel. Anchor the initial view on the first record instead.
  function _resolveLocus(filename) {
    // Reuse _fetchPage so a .gz file's first record comes from the same
    // browser-side stream as its table, not the server /data/ endpoint.
    return Promise.resolve(_fetchPage(filename, 0))
      .then(function(d) {
        var rec = d && d.rows && d.rows[0];
        if (!rec) return null;
        var chrom = rec[0];
        var start = parseInt(rec[1], 10);   // BED start is 0-based
        var end = parseInt(rec[2], 10);
        if (!chrom || isNaN(start)) return null;
        if (isNaN(end) || end <= start) end = start + 1;
        var pad = Math.max(0, Math.floor((IGV_MIN_WINDOW - (end - start)) / 2));
        return chrom + ':' + Math.max(1, start + 1 - pad) + '-' + (end + pad);
      })
      .catch(function() { return null; });
  }

  function _fetchReference() {
    return fetch('/api/reference').then(function(r) { return r.json(); })
      .then(function(d) { _igvRef = d.reference || null; })
      .catch(function() { _igvRef = null; });
  }

  // igv.js ships inside the plugin so the viewer works on machines with no
  // internet access. The CDN stays as a fallback for installs that predate the
  // bundled copy.
  var IGV_LOCAL = '/plugin/bed-viewer/igv.min.js';
  var IGV_CDN = 'https://cdn.jsdelivr.net/npm/igv@3/dist/igv.min.js';

  function _loadIgvJs() {
    if (window.igv) return Promise.resolve();
    function load(src) {
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function() { resolve(); };
        s.onerror = function() { reject(new Error('Failed to load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return load(IGV_LOCAL).catch(function() { return load(IGV_CDN); });
  }

  function _buildGenomeDropdown() {
    var current = _selectedGenome || _igvRef || '';
    var refLabel = _igvRef ? String(_igvRef).replace(/\\/g, '/').split('/').pop() : '';
    var html = '<span style="font-size:12px;color:#888;font-weight:500;margin-right:4px">Reference:</span>';
    html += '<select id="__igv_genome_select__" style="font-size:12px;padding:4px 8px;max-width:220px;border:1px solid #ddd;border-radius:4px">';
    html += '<option value="' + _escapeHtml(_igvRef || '') + '"' + (current === _igvRef ? ' selected' : '') + '>' + _escapeHtml(refLabel || 'none') + '</option>';
    KNOWN_GENOMES.forEach(function(g) {
      if (g.id !== _igvRef) {
        html += '<option value="' + g.id + '"' + (current === g.id ? ' selected' : '') + '>' + g.label + '</option>';
      }
    });
    html += '</select>';
    return html;
  }

  function _renderIgv(container, fileUrl, filename, trackType, trackFormat) {
    _disposeIgvBrowser();
    container.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'ap-loading';
    div.textContent = 'Loading...';
    container.appendChild(div);

    var activeRef = _selectedGenome || _igvRef;
    var knownIds = KNOWN_GENOMES.map(function(g) { return g.id; });
    var isKnownGenome = knownIds.indexOf(activeRef) >= 0;

    return Promise.all([
      _loadIgvJs(),
      _resolveLocus(filename),
      isKnownGenome ? Promise.resolve(null) : _findIndex(_refUrl(activeRef), ['fai']),
      /\.gz$/i.test(fileUrl) ? _findIndex(fileUrl, ['tbi', 'csi']) : Promise.resolve(null)
    ]).then(function(results) {
      var locus = results[1], refIndex = results[2], trackIndex = results[3];
      // The user may have switched tabs while the probes were in flight.
      if (!div.isConnected) return;
      div.textContent = '';
      div.className = '';

      var opts = {};
      if (isKnownGenome) {
        opts.genome = activeRef;
      } else {
        opts.reference = { fastaURL: _refUrl(activeRef) };
        if (refIndex) {
          // Indexed means igv.js range-reads the FASTA instead of pulling the
          // whole file into memory — the difference between a few KB and the
          // entire reference.
          opts.reference.indexURL = refIndex;
          opts.reference.indexed = true;
        } else {
          opts.reference.indexed = false;
        }
      }
      if (locus) opts.locus = locus;
      var track = { type: trackType, format: trackFormat, url: fileUrl, name: filename };
      if (trackIndex) track.indexURL = trackIndex;
      opts.tracks = [track];

      // Returned, not fire-and-forget: a rejected createBrowser used to become
      // an unhandled rejection and leave a blank pane with no explanation.
      return igv.createBrowser(div, opts).then(function(browser) {
        _igvBrowser = browser;
      });
    }).catch(function(e) {
      container.innerHTML = '<div style="color:red;padding:16px;">IGV Error: ' +
        _escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    });
  }

  var TRACK_TYPE = 'annotation';
  var TRACK_FORMAT = 'bed';

  var _totalRecords = 0;
  var _currentFilename = '';

  function _isGz(name) { return /\.gz$/i.test(name); }

  function _ensureBgzf() {
    if (window.AutoPipeBgzf) return Promise.resolve();
    return new Promise(function(resolve) {
      var el = document.createElement('script');
      el.src = '/plugin/bed-viewer/bgzf.js';
      el.onload = function() { resolve(); };
      el.onerror = function() { resolve(); };
      document.head.appendChild(el);
    });
  }

  var _gzCursor = null;

  // A .bed.gz is bgzipped text; decode it in the browser over /file/ Range
  // requests so no server tool is needed and large files stream a page at a
  // time. Plain .bed keeps using /data/ (grep/sed on the server).
  function _fetchPage(filename, page) {
    if (_isGz(filename)) {
      return _ensureBgzf().then(function() {
        if (window.AutoPipeBgzf && window.AutoPipeBgzf.available) {
          return _fetchPageGz(filename, page);
        }
        return _fetchPageServer(filename, page);
      });
    }
    return _fetchPageServer(filename, page);
  }

  function _fetchPageServer(filename, page) {
    return fetch('/data/' + encodeURIComponent(filename) + '?page=' + page + '&page_size=' + PAGE_SIZE)
      .then(function(resp) { return resp.json(); });
  }

  function _isComment(l) { return l.charAt(0) === '#' || l.indexOf('track') === 0 || l.indexOf('browser') === 0; }

  function _fetchPageGz(filename, page) {
    var fileUrl = _savedFileUrl || ('/file/' + encodeURIComponent(filename));
    var reuse = _gzCursor && _gzCursor.name === filename && _gzCursor.page === page - 1;
    var start;
    if (reuse) {
      start = Promise.resolve(_gzCursor);
    } else {
      var rd = window.AutoPipeBgzf.lineReader(fileUrl);
      _gzCursor = { name: filename, page: -1, rd: rd };
      start = _skipRows(_gzCursor, page * PAGE_SIZE).then(function() { return _gzCursor; });
    }
    return start.then(function(cur) {
      return _takeRows(cur, PAGE_SIZE).then(function(rows) {
        cur.page = page;
        return {
          rows: rows,
          total: page * PAGE_SIZE + rows.length,
          page: page,
          page_size: PAGE_SIZE
        };
      });
    });
  }

  // Comment/track lines are skipped so they never count as records.
  function _takeRows(cur, n) {
    var rows = [];
    function pull() {
      if (rows.length >= n) return Promise.resolve(rows);
      return cur.rd.readLines(n - rows.length + 4).then(function(lines) {
        if (!lines.length) return rows;
        for (var i = 0; i < lines.length && rows.length < n; i++) {
          var l = lines[i];
          if (l.length && !_isComment(l)) rows.push(l.split('\t'));
        }
        if (cur.rd.state.eof && rows.length < n) return rows;
        return pull();
      });
    }
    return pull();
  }

  function _skipRows(cur, n) {
    if (n <= 0) return Promise.resolve();
    return _takeRows(cur, n).then(function() {});
  }

  function _loadPage(page) {
    var target = (rootEl && rootEl.querySelector('#__plugin_content__')) || rootEl;
    if (!target) return;
    target.innerHTML = '<div class="ap-loading">Loading...</div>';

    _fetchPage(_currentFilename, page).then(function(data) {
      if (data.error) {
        target.innerHTML = '<p style="color:red;padding:16px;">Error: ' + data.error + '</p>';
        return;
      }
      _totalRecords = data.total || _totalRecords;
      currentPage = page;
      var text = '';
      if (data.rows) {
        for (var i = 0; i < data.rows.length; i++) {
          var row = data.rows[i];
          text += (Array.isArray(row) ? row.join('\t') : row) + '\n';
        }
      }
      allRecords = parse(text);
      ncols = 0;
      for (var i = 0; i < allRecords.length; i++) {
        if (allRecords[i].length > ncols) ncols = allRecords[i].length;
      }
      ncols = Math.min(ncols, 12);
      filteredRecords = allRecords.slice();
      sortCol = -1; sortAsc = true; filterText = ''; filterChrom = '';
      render();
    }).catch(function(err) {
      target.innerHTML = '<p style="color:red;padding:16px;">Error: ' + err.message + '</p>';
    });
  }

  function _renderData(container, fileUrl, filename) {
    container.innerHTML = '<div class="ap-loading">Loading...</div>';
    allRecords = []; filteredRecords = []; sortCol = -1; sortAsc = true;
    currentPage = 0; filterText = ''; filterChrom = '';
    _currentFilename = filename;
    _loadPage(0);
  }

  function _showView(container, fileUrl, filename) {
    // Every path through here replaces container.innerHTML, detaching any live
    // IGV browser — drop it before the DOM goes away.
    _disposeIgvBrowser();
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
      // The host caches the plugin instance and only ever calls render(), so
      // this is the one reliable teardown point between files.
      _disposeIgvBrowser();
      rootEl = container;
      rootEl.innerHTML = '<div class="ap-loading">Loading...</div>';
      _savedFileUrl = fileUrl;
      _savedFilename = filename;
      _gzCursor = null;
      _igvMode = 'data';
      _selectedGenome = null;

      _fetchReference().then(function() {
        _showView(container, fileUrl, filename);
      });
    },

    destroy: function() {
      _disposeIgvBrowser();
      allRecords = [];
      filteredRecords = [];
      rootEl = null;
    }
  };
})();
