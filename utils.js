/* OKATAKYIRE WALLET - shared helpers: money, dates, icons, escaping, downloads */
(function (global) {
  'use strict';

  /* ---------- text ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clean(s, max) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
  }

  function cleanMultiline(s, max) {
    s = String(s == null ? '' : s).replace(/\r\n/g, '\n').trim();
    return max ? s.slice(0, max) : s;
  }

  /* Return the existing spelling when the same text is already used (case-insensitive) */
  function canonical(name, existing) {
    var low = name.toLowerCase();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].toLowerCase() === low) return existing[i];
    }
    return name;
  }

  function uniqueSorted(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) {
      if (!v) return;
      var k = v.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(v); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  /* ---------- money (integer pesewas) ---------- */
  function fmt(p) {
    p = Math.round(p || 0);
    var neg = p < 0; p = Math.abs(p);
    var w = Math.floor(p / 100), f = p % 100;
    var s = String(w).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + 'GH₵' + s + '.' + (f < 10 ? '0' : '') + f;
  }

  function fmtPlain(p) { // no currency symbol, for CSV / inputs
    p = Math.round(p || 0);
    var neg = p < 0; p = Math.abs(p);
    return (neg ? '-' : '') + Math.floor(p / 100) + '.' + ('0' + (p % 100)).slice(-2);
  }

  function fmtCompact(cedis) {
    var a = Math.abs(cedis), sign = cedis < 0 ? '-' : '';
    if (a >= 1e6) return sign + 'GH₵' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return sign + 'GH₵' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return sign + 'GH₵' + Math.round(a);
  }

  /* "1,250.5" -> 125050 ; returns NaN when invalid */
  function parseMoney(str) {
    if (str == null) return NaN;
    var s = String(str).replace(/GH₵|GHS|₵/gi, '').replace(/[\s,]/g, '');
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return NaN;
    var parts = s.split('.');
    var whole = parts[0] || '0';
    var frac = ((parts[1] || '') + '00').slice(0, 2);
    if (whole.length > 11) return NaN;
    return parseInt(whole, 10) * 100 + parseInt(frac, 10);
  }

  function fmtPct(pct) {
    if (!isFinite(pct) || pct < 0) pct = 0;
    if (pct >= 100) return Math.floor(pct) + '%';
    var v = Math.floor(pct * 10) / 10;
    return (v % 1 === 0 ? String(v) : v.toFixed(1)) + '%';
  }

  /* ---------- dates (always 'YYYY-MM-DD' strings, calendar maths in UTC day numbers) ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (y < 1900 || y > 2200) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function dayNum(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000); }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function dow(s) { return new Date(dayNum(s) * 86400000).getUTCDay(); }
  function weekStart(s) { return addDays(s, -((dow(s) + 6) % 7)); } // Monday
  function weekEnd(s) { return addDays(weekStart(s), 6); }
  function monthKey(s) { return s.slice(0, 7); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m = 1..12
  function monthStart(key) { return key.slice(0, 7) + '-01'; }
  function monthEnd(key) { return key.slice(0, 7) + '-' + pad(daysInMonth(+key.slice(0, 4), +key.slice(5, 7))); }
  function addMonths(key, n) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function monthsBetween(fromKey, toKey) {
    var out = [], k = fromKey, guard = 0;
    while (k <= toKey && guard++ < 600) { out.push(k); k = addMonths(k, 1); }
    return out;
  }
  function fmtDate(s) { return DAYS[dow(s)] + ' ' + (+s.slice(8, 10)) + ' ' + MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4); }
  function fmtDateShort(s) { return (+s.slice(8, 10)) + ' ' + MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4); }
  function monthLabel(key) { return MONTHS[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4); }
  function monthLabelShort(key) { return MONTHS[+key.slice(5, 7) - 1] + " '" + key.slice(2, 4); }
  function monthLabelLong(key) { return MONTHS_LONG[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4); }

  /* ---------- ids ---------- */
  function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }

  /* ---------- icons (inline SVG, no network) ---------- */
  var ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    down: '<path d="M17 7L7 17M17 17H7V7"/>',
    up: '<path d="M7 17L17 7M7 7h10v10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    play: '<path d="M6 3l14 9-14 9z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    trend: '<path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'
  };

  function icon(name, size) {
    size = size || 20;
    return '<svg class="ico" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ---------- downloads / csv ---------- */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function csvCell(v, isText) {
    var s = v == null ? '' : String(v);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // block spreadsheet formula injection
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  global.U = {
    esc: esc, clean: clean, cleanMultiline: cleanMultiline, canonical: canonical, uniqueSorted: uniqueSorted,
    fmt: fmt, fmtPlain: fmtPlain, fmtCompact: fmtCompact, parseMoney: parseMoney, fmtPct: fmtPct,
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, DAYS: DAYS, pad: pad,
    todayStr: todayStr, isDateStr: isDateStr, dayNum: dayNum, fromDayNum: fromDayNum, addDays: addDays,
    daysBetween: daysBetween, dow: dow, weekStart: weekStart, weekEnd: weekEnd, monthKey: monthKey,
    daysInMonth: daysInMonth, monthStart: monthStart, monthEnd: monthEnd, addMonths: addMonths,
    monthsBetween: monthsBetween, fmtDate: fmtDate, fmtDateShort: fmtDateShort,
    monthLabel: monthLabel, monthLabelShort: monthLabelShort, monthLabelLong: monthLabelLong,
    uid: uid, icon: icon, download: download, csvCell: csvCell
  };
})(window);
