// Shared BGZF streaming reader for AutoPipe text-format viewers.
//
// A .vcf.gz / .bed.gz / .gff.gz file is BGZF: a run of standalone gzip members.
// The /file/ endpoint only returns bytes for ranged requests, so the file is
// pulled in 1 MB chunks, each member inflated on its own (no reliance on
// multi-member DecompressionStream), and handed to the caller line by line.
// One page needs only the leading chunks, so large files never fully download.
//
// Exposes window.AutoPipeBgzf = { lineReader(fileUrl) -> { readLines(n) } }.
// A plain (non-bgzipped) .gz still decodes: DecompressionStream handles the
// single member, and the walk simply stops after it.

(function () {
  if (window.AutoPipeBgzf) return;

  var CHUNK = 1 << 20;

  function rangeFetch(url, start, end) {
    return fetch(url, { headers: { Range: 'bytes=' + start + '-' + end } })
      .then(function (r) {
        if (!r.ok) throw new Error('range request failed: ' + r.status);
        return r.arrayBuffer();
      });
  }

  function inflateMember(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  // Inflate the leading gzip members of `buffer`. Returns the decompressed
  // bytes plus how many compressed bytes were consumed, so the caller knows
  // where the next fetch begins.
  function bgzfInflate(buffer) {
    var view = new DataView(buffer);
    var parts = [];
    var off = 0;

    function step() {
      if (off + 18 > buffer.byteLength) return Promise.resolve(parts);
      if (view.getUint8(off) !== 0x1f || view.getUint8(off + 1) !== 0x8b) {
        return Promise.resolve(parts);
      }
      // BGZF members carry a BC extra subfield with the member length - 1.
      // A plain gzip member has no BC field; fall back to consuming the whole
      // remaining buffer as one member in that case.
      var xlen = view.getUint16(off + 10, true);
      var bsize = -1;
      var p = off + 12;
      var xend = p + xlen;
      while (p + 4 <= xend) {
        var slen = view.getUint16(p + 2, true);
        if (view.getUint8(p) === 66 && view.getUint8(p + 1) === 67) {
          bsize = view.getUint16(p + 4, true) + 1;
          break;
        }
        p += 4 + slen;
      }
      if (bsize <= 0) {
        // Plain gzip (no BC field): inflate the rest as a single member.
        var whole = new Uint8Array(buffer, off);
        return inflateMember(whole).then(function (out) {
          parts.push(new Uint8Array(out));
          off = buffer.byteLength;
          return parts;
        });
      }
      if (off + bsize > buffer.byteLength) return Promise.resolve(parts);
      var member = new Uint8Array(buffer, off, bsize);
      off += bsize;
      return inflateMember(member).then(function (out) {
        parts.push(new Uint8Array(out));
        return step();
      });
    }

    return step().then(function (list) {
      var total = 0;
      list.forEach(function (a) { total += a.length; });
      var merged = new Uint8Array(total);
      var at = 0;
      list.forEach(function (a) { merged.set(a, at); at += a.length; });
      return { data: merged, consumed: off };
    });
  }

  // Sequential reader over the decompressed byte stream. `text` accumulates
  // the inflated tail that has not yet been split into complete lines.
  function lineReader(fileUrl) {
    var st = { coffset: 0, tail: '', eof: false, decoder: new TextDecoder() };

    function refill() {
      if (st.eof) return Promise.resolve(false);
      return rangeFetch(fileUrl, st.coffset, st.coffset + CHUNK - 1)
        .then(function (ab) {
          if (ab.byteLength === 0) { st.eof = true; return false; }
          return bgzfInflate(ab).then(function (res) {
            if (!res.consumed) { st.eof = true; return false; }
            st.coffset += res.consumed;
            if (ab.byteLength < CHUNK) st.eof = true;
            st.tail += st.decoder.decode(res.data, { stream: true });
            return true;
          });
        })
        .catch(function () { st.eof = true; return false; });
    }

    // Read up to `n` complete lines. Fewer means end of file.
    function readLines(n) {
      var out = [];

      function pull() {
        var nl;
        while (out.length < n && (nl = st.tail.indexOf('\n')) >= 0) {
          out.push(st.tail.slice(0, nl));
          st.tail = st.tail.slice(nl + 1);
        }
        if (out.length >= n) return Promise.resolve(out);
        if (st.eof) {
          if (st.tail.length) { out.push(st.tail); st.tail = ''; }
          return Promise.resolve(out);
        }
        return refill().then(pull);
      }
      return pull();
    }

    return { readLines: readLines, state: st };
  }

  window.AutoPipeBgzf = {
    available: typeof DecompressionStream !== 'undefined',
    lineReader: lineReader
  };
})();
