/* OKATAKYIRE WALLET - screens: home, history, goals, reports, calendar, more, settings.
 * Each view = { html(), after(), act() }. Core logic lives in app.js. */
(function () {
  'use strict';

  var U = window.U, A = window.App, S = A.state;
  var esc = U.esc, fmt = U.fmt, icon = U.icon, $ = A.$, $$ = A.$$;

  /* =====================================================================
   * SHARED HELPERS
   * ===================================================================== */
  function pal() {
    var d = A.isDark();
    return {
      sav: d ? '#4ade80' : '#15803d', savFill: d ? 'rgba(74,222,128,.16)' : 'rgba(21,128,61,.13)',
      exp: d ? '#fb7185' : '#dc2626', gold: d ? '#fbbf24' : '#d99a00',
      text: d ? '#a9bdb0' : '#5b6b61', grid: d ? 'rgba(255,255,255,.07)' : 'rgba(10,61,31,.08)',
      cats: ['#15803d', '#f5a800', '#2563eb', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#db2777', '#65a30d', '#64748b']
    };
  }

  function mkChart(id, cfg) {
    var el = document.getElementById(id);
    if (!el || !window.Chart) return;
    var p = pal();
    Chart.defaults.color = p.text;
    Chart.defaults.borderColor = p.grid;
    Chart.defaults.font.family = '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 450 } }, cfg.options || {});
    A.charts.push(new Chart(el, cfg));
  }

  function yMoney() { return { beginAtZero: true, ticks: { callback: function (v) { return U.fmtCompact(v); }, maxTicksLimit: 6 } }; }
  function tipMoney(c) {
    var v = c.parsed && typeof c.parsed === 'object' ? c.parsed.y : c.parsed;
    return ' ' + (c.dataset.label ? c.dataset.label + ': ' : '') + fmt(Math.round(v * 100));
  }

  function monthAgg(list) {
    var m = {};
    list.forEach(function (t) {
      var k = U.monthKey(t.date), o = m[k] || (m[k] = { s: 0, e: 0 });
      if (t.type === 'savings') o.s += t.amountP; else o.e += t.amountP;
    });
    return m;
  }

  function groupSum(list, keyFn) {
    var map = {}, out = [];
    list.forEach(function (t) {
      var name = keyFn(t) || 'Uncategorised', k = name.toLowerCase();
      if (!map[k]) { map[k] = { name: name, p: 0, n: 0 }; out.push(map[k]); }
      map[k].p += t.amountP; map[k].n++;
    });
    return out.sort(function (a, b) { return b.p - a.p; });
  }

  function inRange(t, from, to) { return t.date >= from && t.date <= to; }

  function dayLabel(d) {
    var t = U.todayStr();
    if (d === t) return 'Today';
    if (d === U.addDays(t, -1)) return 'Yesterday';
    return U.fmtDate(d);
  }

  function txRow(t, o) {
    o = o || {};
    var sv = t.type === 'savings', g = t.goalId ? A.getGoal(t.goalId) : null, meta = [];
    if (o.showDate) meta.push(U.fmtDateShort(t.date));
    if (t.category) meta.push(t.category);
    if (g) meta.push('Goal: ' + g.name);
    if (t.notes) meta.push(t.notes);
    return '<li class="tx" data-act="edit-tx" data-id="' + esc(t.id) + '">' +
      '<span class="tx-ico ' + (sv ? 'sv' : 'ex') + '">' + icon(sv ? 'down' : 'up', 20) + '</span>' +
      '<div class="tx-body"><b>' + esc(A.txTitle(t)) + '</b><small>' + esc(meta.join(' • ')) + '</small></div>' +
      '<div class="tx-side"><b class="amt ' + (sv ? 'sv' : 'ex') + '">' + (sv ? '+' : '−') + fmt(t.amountP) + '</b>' +
      (o.actions ?
        '<span class="tx-act"><button class="icon-btn sm" data-act="edit-tx" data-id="' + esc(t.id) + '" aria-label="Edit">' + icon('edit', 16) + '</button>' +
        '<button class="icon-btn sm del" data-act="del-tx" data-id="' + esc(t.id) + '" aria-label="Delete">' + icon('trash', 16) + '</button></span>' : '') +
      '</div></li>';
  }

  function progressBar(pct, done) {
    return '<div class="bar' + (done ? ' done' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.floor(Math.min(100, pct)) + '"><i style="width:' + Math.min(100, Math.max(pct, pct > 0 ? 1.5 : 0)).toFixed(1) + '%"></i></div>';
  }

  function daysText(st) {
    if (st.completed) return 'Completed';
    var d = st.days;
    if (d > 1) return d + ' days left';
    if (d === 1) return '1 day left';
    if (d === 0) return 'Due today';
    return Math.abs(d) + (d === -1 ? ' day' : ' days') + ' overdue';
  }

  function needText(g, st) {
    if (st.achieved || st.completed || g.status !== 'active' || st.days <= 0 || st.remaining <= 0) return '';
    var days = st.days, p, unit;
    if (days >= 60) { p = Math.ceil(st.remaining / (days / 30.4375)); unit = 'month'; }
    else if (days >= 14) { p = Math.ceil(st.remaining / (days / 7)); unit = 'week'; }
    else { p = Math.ceil(st.remaining / days); unit = 'day'; }
    return 'Save about ' + fmt(p) + ' per ' + unit + ' to reach it in time.';
  }

  function goalMini(g) {
    var st = A.goalStats(g);
    return '<div class="mini-goal"><div class="mini-top"><b>' + esc(g.name) + '</b><span>' + U.fmtPct(st.pct) + '</span></div>' +
      progressBar(st.pct, st.achieved) +
      '<div class="mini-bot"><span>' + fmt(st.allocated) + ' of ' + fmt(g.targetP) + '</span><span>' + esc(daysText(st)) + '</span></div></div>';
  }

  function emptyBox(emoji, title, text, btns) {
    return '<div class="empty-box"><div class="emoji">' + emoji + '</div><h3>' + title + '</h3><p>' + text + '</p>' + (btns || '') + '</div>';
  }

  function backupBanner() {
    if (!S.tx.length && !S.goals.length) return '';
    var lb = S.settings.lastBackup, days = lb ? Math.floor((Date.now() - lb) / 864e5) : null;
    if (lb && days < 7) return '';
    return '<div class="banner warn">' + icon('shield', 24) + '<div><b>' +
      (lb ? 'Your last backup was ' + (days <= 0 ? 'today' : days + (days === 1 ? ' day' : ' days') + ' ago') : 'You have not backed up yet') + '</b>' +
      '<p>Your records live only on this phone. Save a backup file regularly so you never lose them.</p></div>' +
      '<button class="btn gold sm" data-act="export-json">Back up now</button></div>';
  }

  function legendList(rows, total, colors) {
    return '<ul class="legend">' + rows.map(function (r, i) {
      return '<li><i style="background:' + colors[i % colors.length] + '"></i><span class="lg-name">' + esc(r.name) + '</span>' +
        '<span class="lg-pct">' + (total ? Math.round(r.p / total * 100) : 0) + '%</span><b>' + fmt(r.p) + '</b></li>';
    }).join('') + '</ul>';
  }

  function doughnut(id, rows, colors) {
    mkChart(id, {
      type: 'doughnut',
      data: { labels: rows.map(function (r) { return r.name; }), datasets: [{ data: rows.map(function (r) { return r.p / 100; }), backgroundColor: rows.map(function (r, i) { return colors[i % colors.length]; }), borderWidth: 2, borderColor: A.isDark() ? '#132a1e' : '#ffffff' }] },
      options: { cutout: '64%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + fmt(Math.round(c.parsed * 100)); } } } } }
    });
  }

  /* =====================================================================
   * HOME
   * ===================================================================== */
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

  function homeExpenses() {
    var cur = U.monthKey(U.todayStr());
    return S.tx.filter(function (t) { return t.type === 'expense' && (A.ui.homeCat === 'all' || U.monthKey(t.date) === cur); });
  }

  A.views.home = {
    html: function () {
      var T = A.totals(S.tx), active = S.goals.filter(function (g) { return g.status === 'active'; })
        .sort(function (a, b) { return a.targetDate < b.targetDate ? -1 : 1; });
      var tgt = 0, got = 0;
      active.forEach(function (g) { var st = A.goalStats(g); tgt += g.targetP; got += Math.min(st.allocated, g.targetP); });
      var overall = tgt ? got / tgt * 100 : 0;
      var h = '';

      h += '<section class="hero"><p class="hero-hi">' + greeting() + ' 👋</p><h1 class="hero-welcome">Welcome to OKATAKYIRE WALLET</h1>' +
        '<p class="hero-label">Available Balance</p><p class="hero-amt' + (T.balance < 0 ? ' neg' : '') + '">' + fmt(T.balance) + '</p>' +
        '<p class="hero-sub">Total Savings − Total Expenses' + (T.balance < 0 ? ' · you have spent more than you saved' : '') + '</p></section>';

      h += '<div class="stats">' +
        '<div class="stat"><span class="stat-ico sv">' + icon('down', 20) + '</span><small>Total Money Saved</small><b class="sv">' + fmt(T.savings) + '</b></div>' +
        '<div class="stat"><span class="stat-ico ex">' + icon('up', 20) + '</span><small>Total Expenses</small><b class="ex">' + fmt(T.expenses) + '</b></div></div>';

      h += '<div class="quick"><button class="btn primary" data-act="add-savings">' + icon('plus', 18) + ' Add Savings</button>' +
        '<button class="btn expense-btn" data-act="add-expense">' + icon('plus', 18) + ' Add Expense</button></div>';

      h += backupBanner();

      if (!S.tx.length && !S.goals.length) {
        h += '<div class="card">' + emptyBox('🌱', 'Start with your first saving',
          'Record the money you save and spend, and set targets you want to reach. Everything is stored privately on this phone.',
          '<div class="empty-actions"><button class="btn primary" data-act="add-savings">Record savings</button><button class="btn ghost" data-act="goal-new">Set a goal</button></div>') + '</div>';
      }

      h += '<section class="card"><div class="card-head"><h3>' + icon('target', 20) + ' Savings Targets</h3><button class="link" data-act="goto" data-to="goals">View all</button></div>';
      if (active.length) {
        h += '<div class="tgt-sum"><div><small>Active targets</small><b>' + active.length + '</b></div><div class="grow"><small>Savings progress</small>' +
          progressBar(overall, overall >= 100) + '<span class="tgt-note">' + fmt(got) + ' of ' + fmt(tgt) + ' (' + U.fmtPct(overall) + ')</span></div></div>' +
          active.slice(0, 3).map(goalMini).join('') +
          (active.length > 3 ? '<button class="link center" data-act="goto" data-to="goals">+ ' + (active.length - 3) + ' more</button>' : '');
      } else {
        h += '<p class="muted">No active savings targets yet. Set a goal — like a laptop or emergency fund — and watch your progress here.</p>' +
          '<button class="btn ghost sm" data-act="goal-new">' + icon('plus', 16) + ' New goal</button>';
      }
      h += '</section>';

      if (S.tx.length) {
        h += '<section class="card"><div class="card-head"><h3>' + icon('trend', 20) + ' Savings Progress</h3></div>' +
          '<div class="chart-box"><canvas id="chSavings" aria-label="Total saved and available balance over the last 6 months" role="img"></canvas></div></section>';

        var ex = homeExpenses();
        h += '<section class="card"><div class="card-head"><h3>' + icon('chart', 20) + ' Expense Breakdown</h3>' +
          '<div class="mini-seg"><button data-act="homecat" data-v="month" class="' + (A.ui.homeCat === 'month' ? 'on' : '') + '">This month</button>' +
          '<button data-act="homecat" data-v="all" class="' + (A.ui.homeCat === 'all' ? 'on' : '') + '">All time</button></div></div>';
        if (ex.length) {
          var rows = groupSum(ex, function (t) { return t.category; }), tot = rows.reduce(function (a, r) { return a + r.p; }, 0);
          h += '<div class="donut-wrap"><div class="donut-box"><canvas id="chExpCat" aria-label="Expenses by category" role="img"></canvas><div class="donut-mid"><small>Spent</small><b>' + fmt(tot) + '</b></div></div>' +
            legendList(rows, tot, pal().cats) + '</div>';
        } else {
          h += '<p class="muted">No expenses ' + (A.ui.homeCat === 'month' ? 'recorded this month' : 'recorded yet') + '.</p>';
        }
        h += '</section>';

        h += '<section class="card"><div class="card-head"><h3>' + icon('list', 20) + ' Recent Transactions</h3><button class="link" data-act="goto" data-to="history">See all</button></div>' +
          '<ul class="tx-list">' + A.sortTx(S.tx).slice(0, 5).map(function (t) { return txRow(t, { showDate: true }); }).join('') + '</ul></section>';
      }
      return h;
    },

    after: function () {
      if (!S.tx.length) return;
      var p = pal(), cur = U.monthKey(U.todayStr()), keys = [];
      for (var i = 5; i >= 0; i--) keys.push(U.addMonths(cur, -i));
      var m = monthAgg(S.tx), s = 0, e = 0;
      Object.keys(m).forEach(function (k) { if (k < keys[0]) { s += m[k].s; e += m[k].e; } });
      var sav = [], bal = [];
      keys.forEach(function (k) { var o = m[k] || { s: 0, e: 0 }; s += o.s; e += o.e; sav.push(s / 100); bal.push((s - e) / 100); });
      mkChart('chSavings', {
        type: 'line',
        data: {
          labels: keys.map(U.monthLabelShort), datasets: [
            { label: 'Total saved', data: sav, borderColor: p.sav, backgroundColor: p.savFill, fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: p.sav, borderWidth: 2.5 },
            { label: 'Available balance', data: bal, borderColor: p.gold, borderDash: [6, 4], fill: false, tension: .35, pointRadius: 3, pointBackgroundColor: p.gold, borderWidth: 2.5 }
          ]
        },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: tipMoney } } }, scales: { y: yMoney(), x: { grid: { display: false } } } }
      });
      var ex = homeExpenses();
      if (ex.length) doughnut('chExpCat', groupSum(ex, function (t) { return t.category; }), p.cats);
    },

    act: function (act, el) {
      if (act === 'homecat') { A.ui.homeCat = el.getAttribute('data-v'); A.render(true); }
    }
  };

  /* =====================================================================
   * HISTORY
   * ===================================================================== */
  function histList() {
    var h = A.ui.hist, q = (h.q || '').trim().toLowerCase(), t = U.todayStr(), from = '0000-00-00', to = '9999-99-99';
    if (h.period === 'today') { from = to = t; }
    else if (h.period === 'week') { from = U.weekStart(t); to = U.weekEnd(t); }
    else if (h.period === 'month') { from = U.monthStart(t); to = U.monthEnd(t); }
    else if (h.period === 'custom') {
      var a = h.from || from, b = h.to || to;
      if (a > b) { var x = a; a = b; b = x; }
      from = a; to = b;
    }
    return A.sortTx(S.tx.filter(function (x) {
      if (h.type === 'savings' && x.type !== 'savings') return false;
      if (h.type === 'expense' && x.type !== 'expense') return false;
      if (!inRange(x, from, to)) return false;
      if (q) {
        var g = x.goalId ? A.getGoal(x.goalId) : null;
        var hay = [A.txTitle(x), x.category, x.notes, x.date, U.fmtDateShort(x.date), U.fmtPlain(x.amountP), g ? g.name : '', x.type === 'savings' ? 'saving savings' : 'expense'].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }));
  }

  function histBody() {
    var h = A.ui.hist, list = histList(), limit = h.limit || 100;
    if (!S.tx.length) {
      return emptyBox('📒', 'No transactions yet', 'Your savings and expenses will appear here.',
        '<div class="empty-actions"><button class="btn primary" data-act="add-savings">Add savings</button><button class="btn expense-btn" data-act="add-expense">Add expense</button></div>');
    }
    if (!list.length) {
      return emptyBox('🔎', 'Nothing found', 'No transactions match these filters.', '<button class="btn ghost" data-act="hist-reset">Clear filters</button>');
    }
    var T = A.totals(list);
    var out = '<div class="sum-strip"><div><small>Entries</small><b>' + list.length + '</b></div><div><small>Saved</small><b class="sv">' + fmt(T.savings) + '</b></div><div><small>Spent</small><b class="ex">' + fmt(T.expenses) + '</b></div></div>';
    var shown = list.slice(0, limit), cur = null;
    shown.forEach(function (t) {
      if (t.date !== cur) {
        if (cur !== null) out += '</ul>';
        cur = t.date;
        out += '<h4 class="day-head">' + esc(dayLabel(t.date)) + '</h4><ul class="tx-list">';
      }
      out += txRow(t, { actions: true });
    });
    out += '</ul>';
    if (list.length > limit) out += '<button class="btn ghost block" data-act="hist-more">Show more (' + (list.length - limit) + ' remaining)</button>';
    return out;
  }

  A.views.history = {
    html: function () {
      var h = A.ui.hist;
      function chip(v, label) { return '<button class="chip' + (h.type === v ? ' on' : '') + '" data-act="hist-type" data-v="' + v + '">' + label + '</button>'; }
      function opt(v, label) { return '<option value="' + v + '"' + (h.period === v ? ' selected' : '') + '>' + label + '</option>'; }
      return '<div class="page-head"><h2>Transaction History</h2><button class="btn ghost sm" data-act="hist-csv">' + icon('download', 16) + ' CSV</button></div>' +
        '<div class="card filters">' +
        '<div class="search">' + icon('search', 18) + '<input id="hq" type="search" placeholder="Search description, source, category, amount…" value="' + esc(h.q) + '" autocomplete="off"></div>' +
        '<div class="chips">' + chip('all', 'All') + chip('savings', 'Savings only') + chip('expense', 'Expenses only') + '</div>' +
        '<label class="fld inline"><span>Period</span><select id="hperiod">' + opt('all', 'All time') + opt('today', 'Today') + opt('week', 'This week') + opt('month', 'This month') + opt('custom', 'Custom date range') + '</select></label>' +
        (h.period === 'custom' ? '<div class="two"><label class="fld"><span>From</span><input type="date" id="hfrom" value="' + esc(h.from) + '"></label><label class="fld"><span>To</span><input type="date" id="hto" value="' + esc(h.to) + '"></label></div>' : '') +
        '</div><div id="histBody">' + histBody() + '</div>';
    },
    after: function () {
      var q = $('#hq');
      if (q) q.addEventListener('input', function () { A.ui.hist.q = q.value; A.ui.hist.limit = 100; $('#histBody').innerHTML = histBody(); });
      var p = $('#hperiod');
      if (p) p.addEventListener('change', function () { A.ui.hist.period = p.value; A.ui.hist.limit = 100; A.render(true); });
      var f = $('#hfrom'), t = $('#hto');
      if (f) f.addEventListener('change', function () { A.ui.hist.from = f.value; A.ui.hist.limit = 100; $('#histBody').innerHTML = histBody(); });
      if (t) t.addEventListener('change', function () { A.ui.hist.to = t.value; A.ui.hist.limit = 100; $('#histBody').innerHTML = histBody(); });
    },
    act: function (act, el) {
      var h = A.ui.hist;
      if (act === 'hist-type') { h.type = el.getAttribute('data-v'); h.limit = 100; A.render(true); }
      else if (act === 'hist-more') { h.limit = (h.limit || 100) + 100; $('#histBody').innerHTML = histBody(); }
      else if (act === 'hist-reset') { A.ui.hist = { type: 'all', period: 'all', from: '', to: '', q: '' }; A.render(true); }
      else if (act === 'hist-csv') {
        var list = histList();
        if (!list.length) return A.toast('There is nothing to export with these filters', 'err');
        A.exportCSV(list, 'history');
      }
    }
  };

  /* =====================================================================
   * GOALS
   * ===================================================================== */
  function goalCard(g) {
    var st = A.goalStats(g), badge, cls;
    if (g.status === 'completed') { badge = 'Completed'; cls = 'done'; }
    else if (g.status === 'paused') { badge = 'Paused'; cls = 'paused'; }
    else if (st.achieved) { badge = 'Goal reached'; cls = 'done'; }
    else { badge = 'Active'; cls = 'active'; }
    var need = needText(g, st), late = !st.completed && !st.achieved && st.days < 0;
    return '<article class="card goal ' + cls + '">' +
      '<div class="goal-head"><h3>' + esc(g.name) + '</h3><span class="badge ' + cls + '">' + badge + '</span></div>' +
      (g.description ? '<p class="goal-desc">' + esc(g.description) + '</p>' : '') +
      (st.achieved ? '<div class="congrats">🎉 Congratulations! You have reached your goal of ' + fmt(g.targetP) + '.</div>' : '') +
      '<div class="goal-amts"><div><small>Saved so far</small><b>' + fmt(st.allocated) + '</b></div><div><small>Target</small><b>' + fmt(g.targetP) + '</b></div></div>' +
      progressBar(st.pct, st.achieved) +
      '<div class="goal-meta"><b>' + U.fmtPct(st.pct) + ' completed</b><span>' + (st.achieved ? 'Nothing remaining' : fmt(st.remaining) + ' remaining') + '</span></div>' +
      '<div class="goal-dates"><span class="' + (late ? 'late' : '') + '">' + icon('calendar', 15) + ' ' + esc(daysText(st)) + '</span><span>Target date: ' + U.fmtDateShort(g.targetDate) + '</span></div>' +
      (need ? '<p class="need">' + esc(need) + '</p>' : '') +
      '<div class="goal-actions">' +
      (g.status !== 'completed' ? '<button class="btn primary sm" data-act="goal-add" data-id="' + esc(g.id) + '">' + icon('plus', 16) + ' Add savings</button>' : '') +
      '<button class="btn ghost sm" data-act="goal-edit" data-id="' + esc(g.id) + '">' + icon('edit', 16) + ' Edit</button>' +
      (g.status !== 'completed' ? '<button class="btn ghost sm" data-act="goal-pause" data-id="' + esc(g.id) + '">' + icon(g.status === 'paused' ? 'play' : 'pause', 16) + ' ' + (g.status === 'paused' ? 'Resume' : 'Pause') + '</button>' : '') +
      '<button class="btn ghost sm" data-act="goal-complete" data-id="' + esc(g.id) + '">' + icon('check', 16) + ' ' + (g.status === 'completed' ? 'Re-open' : 'Complete') + '</button>' +
      '<button class="btn danger-outline sm" data-act="goal-del" data-id="' + esc(g.id) + '">' + icon('trash', 16) + ' Delete</button></div></article>';
  }

  A.views.goals = {
    html: function () {
      var rank = { active: 0, paused: 1, completed: 2 };
      var list = S.goals.slice().sort(function (a, b) {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0;
      });
      return '<div class="page-head"><h2>Savings Goals</h2><button class="btn primary sm" data-act="goal-new">' + icon('plus', 16) + ' New goal</button></div>' +
        (list.length ? list.map(goalCard).join('') :
          '<div class="card">' + emptyBox('🎯', 'Set your first target', 'Choose something you are saving for — a laptop, a car, emergency savings or business capital — and a date to reach it by.',
            '<button class="btn primary" data-act="goal-new">Create a goal</button>') + '</div>') +
        (list.length ? '<p class="foot-note">Tip: when you record savings, choose a goal to put that money towards. Each saving counts for only one goal.</p>' : '');
    }
  };

  /* =====================================================================
   * REPORTS
   * ===================================================================== */
  function repRange() {
    var r = A.ui.rep, t = U.todayStr(), cur = U.monthKey(t), from, to = U.monthEnd(cur), label;
    switch (r.preset) {
      case 'month': from = U.monthStart(cur); label = 'This month'; break;
      case '3m': from = U.monthStart(U.addMonths(cur, -2)); label = 'Last 3 months'; break;
      case 'year': from = t.slice(0, 4) + '-01-01'; to = t.slice(0, 4) + '-12-31'; label = 'This year'; break;
      case 'all':
        var ds = S.tx.map(function (x) { return x.date; }).sort();
        from = ds.length ? ds[0] : U.monthStart(cur);
        if (ds.length && ds[ds.length - 1] > to) to = ds[ds.length - 1];
        label = 'All time'; break;
      case 'custom':
        from = r.from || U.monthStart(cur); to = r.to || U.monthEnd(cur);
        if (from > to) { var x = from; from = to; to = x; }
        label = 'Custom range'; break;
      default: from = U.monthStart(U.addMonths(cur, -5)); label = 'Last 6 months';
    }
    return { from: from, to: to, label: label };
  }

  function reportData(rg) {
    var list = S.tx.filter(function (t) { return inRange(t, rg.from, rg.to); });
    var m = monthAgg(list), keys = U.monthsBetween(U.monthKey(rg.from), U.monthKey(rg.to));
    var T = A.totals(list);
    var exp = list.filter(function (t) { return t.type === 'expense'; });
    var sav = list.filter(function (t) { return t.type === 'savings'; });
    return {
      list: list, months: keys, agg: m, totals: T,
      cats: groupSum(exp, function (t) { return t.category; }),
      sources: groupSum(sav, function (t) { return t.source; })
    };
  }

  A.views.reports = {
    html: function () {
      var r = A.ui.rep, rg = repRange(), d = reportData(rg);
      function opt(v, l) { return '<option value="' + v + '"' + (r.preset === v ? ' selected' : '') + '>' + l + '</option>'; }
      var h = '<div class="page-head"><h2>Reports</h2><button class="btn ghost sm" data-act="print-report">' + icon('printer', 16) + ' Print</button></div>' +
        '<div class="card filters"><label class="fld inline"><span>Date range</span><select id="rpreset">' +
        opt('month', 'This month') + opt('3m', 'Last 3 months') + opt('6m', 'Last 6 months') + opt('year', 'This year') + opt('all', 'All time') + opt('custom', 'Custom range') + '</select></label>' +
        (r.preset === 'custom' ? '<div class="two"><label class="fld"><span>From</span><input type="date" id="rfrom" value="' + esc(rg.from) + '"></label><label class="fld"><span>To</span><input type="date" id="rto" value="' + esc(rg.to) + '"></label></div>' : '') +
        '<p class="range-note">' + U.fmtDateShort(rg.from) + ' – ' + U.fmtDateShort(rg.to) + '</p></div>';

      if (!d.list.length) return h + '<div class="card">' + emptyBox('📊', 'No records in this period', 'Choose a different date range, or add savings and expenses to see your reports.') + '</div>';

      h += '<div class="stats three"><div class="stat"><small>Saved</small><b class="sv">' + fmt(d.totals.savings) + '</b></div>' +
        '<div class="stat"><small>Spent</small><b class="ex">' + fmt(d.totals.expenses) + '</b></div>' +
        '<div class="stat"><small>Balance</small><b class="' + (d.totals.balance < 0 ? 'ex' : 'sv') + '">' + fmt(d.totals.balance) + '</b></div></div>';

      h += '<section class="card"><div class="card-head"><h3>Savings vs Expenses</h3></div><div class="chart-box"><canvas id="chVs" role="img" aria-label="Savings versus expenses by month"></canvas></div></section>' +
        '<section class="card"><div class="card-head"><h3>Monthly Balance</h3></div><div class="chart-box"><canvas id="chBal" role="img" aria-label="Savings minus expenses for each month"></canvas></div></section>' +
        '<section class="card"><div class="card-head"><h3>Savings Trend</h3></div><div class="chart-box"><canvas id="chTrend" role="img" aria-label="Running total saved and available balance"></canvas></div></section>';

      if (d.cats.length) {
        h += '<section class="card"><div class="card-head"><h3>Expense Categories</h3></div><div class="donut-wrap"><div class="donut-box"><canvas id="chCats" role="img" aria-label="Expenses by category"></canvas><div class="donut-mid"><small>Spent</small><b>' + fmt(d.totals.expenses) + '</b></div></div>' +
          legendList(d.cats, d.totals.expenses, pal().cats) + '</div></section>';
      }
      if (d.sources.length) {
        h += '<section class="card"><div class="card-head"><h3>Where your savings came from</h3></div>' + d.sources.map(function (s) {
          var pc = d.totals.savings ? s.p / d.totals.savings * 100 : 0;
          return '<div class="src-row"><div class="src-top"><b>' + esc(s.name) + '</b><span>' + fmt(s.p) + ' · ' + Math.round(pc) + '%</span></div>' + progressBar(pc, false) + '</div>';
        }).join('') + '</section>';
      }

      h += '<section class="card"><div class="card-head"><h3>Month by month</h3></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Month</th><th>Saved</th><th>Spent</th><th>Balance</th></tr></thead><tbody>' +
        d.months.map(function (k) {
          var o = d.agg[k] || { s: 0, e: 0 }, b = o.s - o.e;
          return '<tr><td>' + U.monthLabel(k) + '</td><td class="sv">' + fmt(o.s) + '</td><td class="ex">' + fmt(o.e) + '</td><td class="' + (b < 0 ? 'ex' : 'sv') + '">' + fmt(b) + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td>Total</td><td class="sv">' + fmt(d.totals.savings) + '</td><td class="ex">' + fmt(d.totals.expenses) + '</td><td class="' + (d.totals.balance < 0 ? 'ex' : 'sv') + '">' + fmt(d.totals.balance) + '</td></tr></tfoot></table></div></section>';
      return h;
    },

    after: function () {
      var p = pal(), rg = repRange(), d = reportData(rg);

      /* date-range controls work even when the chosen period has no data */
      var ps = $('#rpreset');
      ps.addEventListener('change', function () { A.ui.rep.preset = ps.value; if (ps.value === 'custom' && !A.ui.rep.from) { A.ui.rep.from = rg.from; A.ui.rep.to = rg.to; } A.render(true); });
      var rf = $('#rfrom'), rt = $('#rto');
      if (rf) rf.addEventListener('change', function () { A.ui.rep.from = rf.value; A.render(true); });
      if (rt) rt.addEventListener('change', function () { A.ui.rep.to = rt.value; A.render(true); });

      if (!d.list.length) return;
      var labels = d.months.map(U.monthLabelShort);
      var s = d.months.map(function (k) { return (d.agg[k] ? d.agg[k].s : 0) / 100; });
      var e = d.months.map(function (k) { return (d.agg[k] ? d.agg[k].e : 0) / 100; });
      var b = d.months.map(function (k, i) { return Math.round((s[i] - e[i]) * 100) / 100; });
      var bar = { maxBarThickness: 36, borderRadius: 6 };
      mkChart('chVs', {
        type: 'bar',
        data: { labels: labels, datasets: [Object.assign({ label: 'Savings', data: s, backgroundColor: p.sav }, bar), Object.assign({ label: 'Expenses', data: e, backgroundColor: p.exp }, bar)] },
        options: { plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: tipMoney } } }, scales: { y: yMoney(), x: { grid: { display: false } } } }
      });
      mkChart('chBal', {
        type: 'bar',
        data: { labels: labels, datasets: [Object.assign({ label: 'Balance', data: b, backgroundColor: b.map(function (v) { return v < 0 ? p.exp : p.gold; }) }, bar)] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: tipMoney } } }, scales: { y: { ticks: { callback: function (v) { return U.fmtCompact(v); }, maxTicksLimit: 6 } }, x: { grid: { display: false } } } }
      });
      var all = monthAgg(S.tx), first = d.months[0], cs = 0, ce = 0;
      Object.keys(all).forEach(function (k) { if (k < first) { cs += all[k].s; ce += all[k].e; } });
      var trS = [], trB = [];
      d.months.forEach(function (k) { var o = all[k] || { s: 0, e: 0 }; cs += o.s; ce += o.e; trS.push(cs / 100); trB.push((cs - ce) / 100); });
      mkChart('chTrend', {
        type: 'line',
        data: {
          labels: labels, datasets: [
            { label: 'Total saved', data: trS, borderColor: p.sav, backgroundColor: p.savFill, fill: true, tension: .3, pointRadius: d.months.length > 18 ? 0 : 3, borderWidth: 2.5 },
            { label: 'Available balance', data: trB, borderColor: p.gold, borderDash: [6, 4], fill: false, tension: .3, pointRadius: d.months.length > 18 ? 0 : 3, borderWidth: 2.5 }
          ]
        },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: tipMoney } } }, scales: { y: yMoney(), x: { grid: { display: false } } } }
      });
      if (d.cats.length) doughnut('chCats', d.cats, p.cats);
    },

    act: function (act) {
      if (act === 'print-report') A.printReport(repRange());
    }
  };

  /* =====================================================================
   * PRINTABLE REPORT
   * ===================================================================== */
  A.printReport = function (rg) {
    if (!S.tx.length && !S.goals.length) return A.toast('There is nothing to print yet', 'err');
    rg = rg || { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
    var d = reportData(rg), tot = d.totals, T = A.totals(S.tx);
    var from = rg.from < '1900' ? (S.tx.length ? S.tx.map(function (x) { return x.date; }).sort()[0] : U.todayStr()) : rg.from;
    var to = rg.to > '2200' ? U.todayStr() : rg.to;
    var html = '<div class="pr-head"><img src="icons/logo-256.png" alt="" width="70" height="70"><div><h1>OKATAKYIRE WALLET</h1><p>Financial report · ' + esc(rg.label) + ' · ' + U.fmtDateShort(from) + ' to ' + U.fmtDateShort(to) + '</p>' +
      '<p class="small">Generated on ' + U.fmtDateShort(U.todayStr()) + ' · All amounts in Ghana Cedis (GH₵)</p></div></div>' +
      '<h2>Summary</h2><table class="pr-tbl"><tr><th>Total savings in period</th><td>' + fmt(tot.savings) + '</td></tr><tr><th>Total expenses in period</th><td>' + fmt(tot.expenses) + '</td></tr><tr><th>Balance for period</th><td>' + fmt(tot.balance) + '</td></tr>' +
      '<tr><th>Overall available balance (all time)</th><td>' + fmt(T.balance) + '</td></tr></table>';

    html += '<h2>Month by month</h2><table class="pr-tbl"><thead><tr><th>Month</th><th>Saved</th><th>Spent</th><th>Balance</th></tr></thead><tbody>' +
      d.months.map(function (k) { var o = d.agg[k] || { s: 0, e: 0 }; return '<tr><td>' + U.monthLabel(k) + '</td><td>' + fmt(o.s) + '</td><td>' + fmt(o.e) + '</td><td>' + fmt(o.s - o.e) + '</td></tr>'; }).join('') + '</tbody></table>';

    if (d.cats.length) html += '<h2>Expenses by category</h2><table class="pr-tbl"><tbody>' + d.cats.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + fmt(c.p) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (d.sources.length) html += '<h2>Savings by source</h2><table class="pr-tbl"><tbody>' + d.sources.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + fmt(c.p) + '</td></tr>'; }).join('') + '</tbody></table>';

    if (S.goals.length) {
      html += '<h2>Savings goals</h2><table class="pr-tbl"><thead><tr><th>Goal</th><th>Saved</th><th>Target</th><th>Done</th><th>Target date</th><th>Status</th></tr></thead><tbody>' +
        S.goals.map(function (g) { var st = A.goalStats(g); return '<tr><td>' + esc(g.name) + '</td><td>' + fmt(st.allocated) + '</td><td>' + fmt(g.targetP) + '</td><td>' + U.fmtPct(st.pct) + '</td><td>' + U.fmtDateShort(g.targetDate) + '</td><td>' + g.status + '</td></tr>'; }).join('') + '</tbody></table>';
    }

    html += '<h2>Transactions (' + d.list.length + ')</h2><table class="pr-tbl"><thead><tr><th>Date</th><th>Type</th><th>Source / purpose</th><th>Category</th><th>Amount</th></tr></thead><tbody>' +
      A.sortTx(d.list).map(function (t) {
        return '<tr><td>' + U.fmtDateShort(t.date) + '</td><td>' + (t.type === 'savings' ? 'Savings' : 'Expense') + '</td><td>' + esc(A.txTitle(t)) + (t.notes ? '<br><span class="small">' + esc(t.notes) + '</span>' : '') + '</td><td>' + esc(t.category || '') + '</td><td>' + (t.type === 'savings' ? '+' : '−') + fmt(t.amountP) + '</td></tr>';
      }).join('') + '</tbody></table>';

    var pa = $('#printArea');
    pa.innerHTML = html;
    setTimeout(function () { window.print(); }, 200);
  };
  window.addEventListener('afterprint', function () { var pa = $('#printArea'); if (pa) pa.innerHTML = ''; });

  /* =====================================================================
   * CALENDAR
   * ===================================================================== */
  function calInit() {
    var c = A.ui.cal;
    if (!c.month) c.month = U.monthKey(U.todayStr());
    if (!c.sel) c.sel = U.todayStr();
  }

  function calGoMonth(delta) {
    var c = A.ui.cal;
    c.month = delta === 0 ? U.monthKey(U.todayStr()) : U.addMonths(c.month, delta);
    var t = U.todayStr();
    c.sel = delta === 0 ? t : (U.monthKey(t) === c.month ? t : U.monthStart(c.month));
    A.render(true);
  }

  A.views.calendar = {
    html: function () {
      calInit();
      var c = A.ui.cal, t = U.todayStr(), by = {}, mtx = S.tx.filter(function (x) { return U.monthKey(x.date) === c.month; });
      mtx.forEach(function (x) { var o = by[x.date] || (by[x.date] = { s: 0, e: 0 }); if (x.type === 'savings') o.s += x.amountP; else o.e += x.amountP; });
      var MT = A.totals(mtx);
      var y = +c.month.slice(0, 4), mo = +c.month.slice(5, 7), lead = (U.dow(U.monthStart(c.month)) + 6) % 7, dim = U.daysInMonth(y, mo);

      var h = '<div class="page-head"><h2>Calendar</h2><button class="btn ghost sm" data-act="cal-today">Today</button></div><section class="card">' +
        '<div class="cal-nav"><button class="icon-btn" data-act="cal-prev" aria-label="Previous month">' + icon('left') + '</button><h3>' + U.monthLabelLong(c.month) + '</h3>' +
        '<button class="icon-btn" data-act="cal-next" aria-label="Next month">' + icon('right') + '</button></div>' +
        '<p class="cal-sum"><span class="sv">Saved ' + fmt(MT.savings) + '</span><span class="ex">Spent ' + fmt(MT.expenses) + '</span></p>' +
        '<div class="cal-grid cal-dow">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="cal-grid">';
      for (var i = 0; i < lead; i++) h += '<span class="cal-blank"></span>';
      for (var d = 1; d <= dim; d++) {
        var date = c.month + '-' + U.pad(d), o = by[date];
        h += '<button class="cal-day' + (date === t ? ' today' : '') + (date === c.sel ? ' sel' : '') + '" data-act="cal-pick" data-date="' + date + '" aria-label="' + U.fmtDate(date) + '"><b>' + d + '</b>' +
          '<span class="dots">' + (o && o.s ? '<i class="sv"></i>' : '') + (o && o.e ? '<i class="ex"></i>' : '') + '</span></button>';
      }
      h += '</div><p class="legend-line"><i class="sv"></i> Savings <i class="ex"></i> Expenses</p></section>';

      var day = A.sortTx(S.tx.filter(function (x) { return x.date === c.sel; })), DT = A.totals(day);
      h += '<section class="card"><div class="card-head"><h3>' + esc(dayLabel(c.sel)) + (dayLabel(c.sel) === U.fmtDate(c.sel) ? '' : ' <small>' + U.fmtDate(c.sel) + '</small>') + '</h3></div>' +
        '<div class="sum-strip"><div><small>Saved</small><b class="sv">' + fmt(DT.savings) + '</b></div><div><small>Spent</small><b class="ex">' + fmt(DT.expenses) + '</b></div><div><small>Net</small><b class="' + (DT.balance < 0 ? 'ex' : 'sv') + '">' + fmt(DT.balance) + '</b></div></div>' +
        '<div class="quick"><button class="btn primary sm" data-act="add-savings" data-date="' + c.sel + '">' + icon('plus', 16) + ' Add savings</button>' +
        '<button class="btn expense-btn sm" data-act="add-expense" data-date="' + c.sel + '">' + icon('plus', 16) + ' Add expense</button></div>' +
        (day.length ? '<ul class="tx-list">' + day.map(function (x) { return txRow(x, { actions: true }); }).join('') + '</ul>' : '<p class="muted center">Nothing recorded on this date.</p>') + '</section>';
      return h;
    },
    act: function (act, el) {
      if (act === 'cal-prev') calGoMonth(-1);
      else if (act === 'cal-next') calGoMonth(1);
      else if (act === 'cal-today') calGoMonth(0);
      else if (act === 'cal-pick') { A.ui.cal.sel = el.getAttribute('data-date'); A.render(true); }
    }
  };

  /* =====================================================================
   * MORE
   * ===================================================================== */
  A.views.more = {
    html: function () {
      function tile(to, ico, title, sub) { return '<button class="more-tile" data-act="goto" data-to="' + to + '"><span class="more-ico">' + icon(ico, 24) + '</span><span><b>' + title + '</b><small>' + sub + '</small></span>' + icon('right', 18) + '</button>'; }
      return '<div class="page-head"><h2>More</h2></div><div class="more-list">' +
        tile('calendar', 'calendar', 'Calendar', 'See what you saved and spent on any date') +
        tile('reports', 'chart', 'Reports', 'Monthly charts, categories and trends') +
        tile('settings', 'sliders', 'Settings', 'Backup, restore, appearance and app info') + '</div>' +
        '<button class="btn gold block" data-act="export-json">' + icon('download', 18) + ' Back up my records now</button>' +
        (A.deferredPrompt ? '<button class="btn ghost block" data-act="install">' + icon('phone', 18) + ' Install app on this phone</button>' : '');
    }
  };

  /* =====================================================================
   * SETTINGS
   * ===================================================================== */
  A.views.settings = {
    html: function () {
      var th = S.settings.theme || 'light', lb = S.settings.lastBackup;
      var lbTxt = lb ? 'Last backup: ' + new Date(lb).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'You have not made a backup yet.';
      function seg(v, l, ic) { return '<button data-act="theme" data-v="' + v + '" class="' + (th === v ? 'on' : '') + '">' + icon(ic, 16) + ' ' + l + '</button>'; }
      return '<div class="page-head"><h2>Settings</h2></div>' +
        '<section class="card about"><img src="icons/logo-256.png" width="84" height="84" alt="OKATAKYIRE WALLET logo"><div><h3>OKATAKYIRE WALLET</h3><p>Track • Save • Plan • Achieve</p><small>Version ' + A.VERSION + '</small></div></section>' +

        '<section class="card"><h3 class="sec">Backup &amp; Restore</h3>' +
        '<div class="banner warn">' + icon('alert', 24) + '<div><b>Back up regularly</b><p>Your records are stored only on this phone. If the phone is lost, reset, or the browser data is cleared, they cannot be recovered without a backup file. Save backups to Google Drive, WhatsApp or email-to-self.</p></div></div>' +
        '<p class="muted">' + esc(lbTxt) + '</p>' +
        '<div class="btn-stack"><button class="btn primary" data-act="export-json">' + icon('download', 18) + ' Export backup (JSON)</button>' +
        '<button class="btn ghost" data-act="restore">' + icon('upload', 18) + ' Restore backup</button>' +
        '<button class="btn ghost" data-act="export-csv">' + icon('file', 18) + ' Export transactions (CSV)</button>' +
        '<button class="btn ghost" data-act="print-all">' + icon('printer', 18) + ' Print financial report</button></div></section>' +

        '<section class="card"><h3 class="sec">Appearance</h3><div class="seg three">' + seg('light', 'Light', 'sun') + seg('dark', 'Dark', 'moon') + seg('system', 'Auto', 'phone') + '</div></section>' +

        '<section class="card"><h3 class="sec">General</h3><dl class="kv">' +
        '<div><dt>App name</dt><dd>OKATAKYIRE WALLET</dd></div><div><dt>Currency</dt><dd>Ghana Cedis (GH₵)</dd></div>' +
        '<div><dt>Records on this phone</dt><dd>' + S.tx.length + ' transactions, ' + S.goals.length + ' goals</dd></div>' +
        '<div><dt>Storage</dt><dd>' + (A.persisted ? 'Protected from automatic clean-up' : 'Standard browser storage') + '</dd></div>' +
        '<div><dt>Works offline</dt><dd>Yes — no internet needed after installing</dd></div></dl>' +
        (A.deferredPrompt ? '<button class="btn gold block" data-act="install">' + icon('phone', 18) + ' Install app on this phone</button>' :
          '<p class="muted small">To install: open the browser menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>') + '</section>' +

        '<section class="card"><h3 class="sec">App information</h3><dl class="kv"><div><dt>Version</dt><dd>' + A.VERSION + '</dd></div>' +
        '<div><dt>Data storage</dt><dd>IndexedDB on this device</dd></div><div><dt>Privacy</dt><dd>Nothing is ever sent to a server</dd></div></dl></section>' +

        '<section class="card danger-zone"><h3 class="sec">Danger zone</h3><p class="muted">Permanently delete every saving, expense and goal from this phone. Your records are never deleted automatically.</p>' +
        '<button class="btn danger-outline block" data-act="clear">' + icon('trash', 18) + ' Clear all data…</button></section>';
    },
    act: function (act) {
      if (act === 'print-all') A.printReport();
    }
  };

})();
