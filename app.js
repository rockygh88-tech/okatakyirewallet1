/* OKATAKYIRE WALLET - core logic: state, calculations, forms, data actions, backup, router.
 * Screens/charts live in views.js. All data is kept in IndexedDB (db.js) on this device only. */
(function () {
  'use strict';

  var U = window.U, DB = window.WalletDB;

  var A = window.App = {
    VERSION: '1.0.0',
    state: { tx: [], goals: [], settings: {} },
    ui: {
      hist: { type: 'all', period: 'all', from: '', to: '', q: '' },
      rep: { preset: '6m', from: '', to: '' },
      cal: { month: '', sel: '' },
      homeCat: 'month'
    },
    charts: [], views: {}, current: 'home', deferredPrompt: null
  };
  var S = A.state;

  var EXPENSE_PRESETS = ['Food', 'Transportation', 'Airtime/Data', 'Bills', 'Shopping', 'Family', 'Business', 'Education'];
  var ROUTES = { home: 1, history: 1, goals: 1, more: 1, reports: 1, calendar: 1, settings: 1 };
  var NAV_PARENT = { reports: 'more', calendar: 'more', settings: 'more' };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  A.$ = $; A.$$ = $$;

  /* =====================================================================
   * CALCULATIONS (all integer pesewas)
   * ===================================================================== */
  A.totals = function (list) {
    var s = 0, e = 0;
    list.forEach(function (t) {
      if (t.type === 'savings') s += t.amountP;
      else if (t.type === 'expense') e += t.amountP;
    });
    return { savings: s, expenses: e, balance: s - e };
  };

  A.getTx = function (id) { for (var i = 0; i < S.tx.length; i++) if (S.tx[i].id === id) return S.tx[i]; return null; };
  A.getGoal = function (id) { for (var i = 0; i < S.goals.length; i++) if (S.goals[i].id === id) return S.goals[i]; return null; };

  /* Amount allocated to a goal = starting amount + savings entries linked to it.
   * Each savings entry links to at most one goal, so nothing is counted twice,
   * and expenses are never counted as savings. */
  A.goalStats = function (g) {
    var allocated = g.startP || 0, count = 0;
    S.tx.forEach(function (t) {
      if (t.type === 'savings' && t.goalId === g.id) { allocated += t.amountP; count++; }
    });
    var remaining = Math.max(g.targetP - allocated, 0);
    var pct = g.targetP > 0 ? (allocated / g.targetP) * 100 : 0;
    var days = U.daysBetween(U.todayStr(), g.targetDate);
    return { allocated: allocated, remaining: remaining, pct: pct, days: days, count: count,
      achieved: allocated >= g.targetP, completed: g.status === 'completed' };
  };

  A.sortTx = function (list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  };

  A.txTitle = function (t) { return t.type === 'savings' ? t.source : t.title; };

  A.expenseCats = function () {
    var custom = U.uniqueSorted(S.tx.filter(function (t) { return t.type === 'expense' && t.category; })
      .map(function (t) { return t.category; }))
      .filter(function (c) {
        return !EXPENSE_PRESETS.concat(['Other']).some(function (p) { return p.toLowerCase() === c.toLowerCase(); });
      });
    return EXPENSE_PRESETS.concat(custom, ['Other']);
  };

  function savingsSources() {
    return U.uniqueSorted(S.tx.filter(function (t) { return t.type === 'savings'; }).map(function (t) { return t.source; }));
  }
  function savingsCats() {
    return U.uniqueSorted(S.tx.filter(function (t) { return t.type === 'savings' && t.category; }).map(function (t) { return t.category; }));
  }

  /* =====================================================================
   * TOAST + SHEETS (modal stack that cooperates with the Android back button)
   * ===================================================================== */
  A.toast = function (msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(A._tt);
    A._tt = setTimeout(function () { t.className = 'toast'; }, kind === 'err' ? 4200 : 2600);
  };

  var sheets = [], skipPops = 0;

  function openSheet(html, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'sheet-wrap' + (opts.center ? ' center' : '');
    wrap.innerHTML = '<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    $('#overlays').appendChild(wrap);
    document.body.classList.add('noscroll');
    var rec = { el: wrap, onClose: opts.onClose };
    sheets.push(rec);
    history.pushState({ sheet: sheets.length }, '');
    requestAnimationFrame(function () { wrap.classList.add('open'); });
    $('.sheet-backdrop', wrap).addEventListener('click', function () { if (!opts.locked) closeSheets(1); });
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeSheets(1);
    });
    return rec;
  }

  function removeTop() {
    var rec = sheets.pop();
    if (!rec) return;
    rec.el.classList.remove('open');
    setTimeout(function () { rec.el.remove(); }, 220);
    if (!sheets.length) document.body.classList.remove('noscroll');
    if (rec.onClose) rec.onClose();
  }

  function closeSheets(n) {
    n = Math.min(n || 1, sheets.length);
    if (n <= 0) return;
    for (var i = 0; i < n; i++) removeTop();
    skipPops++;
    history.go(-n);
  }
  A.closeSheets = closeSheets;

  window.addEventListener('popstate', function () {
    if (skipPops > 0) { skipPops--; return; }
    if (sheets.length) removeTop();
  });

  /* buttons: [{label, value, cls}] ; resolves with the clicked button's value.
   * opts.keep: when the value === true, leave the dialog open (caller closes it). */
  A.confirm = function (o) {
    return new Promise(function (resolve) {
      var done = false;
      var buttons = o.buttons || [
        { label: o.cancelText || 'Cancel', value: false, cls: 'ghost' },
        { label: o.okText || 'OK', value: true, cls: o.danger ? 'danger' : 'primary' }
      ];
      var html = '<div class="confirm">' +
        (o.emoji ? '<div class="confirm-emoji">' + o.emoji + '</div>' : '') +
        '<h2>' + U.esc(o.title) + '</h2>' +
        (o.message ? '<p>' + U.esc(o.message) + '</p>' : '') +
        (o.html || '') +
        '<div class="confirm-actions">' + buttons.map(function (b, i) {
          return '<button type="button" class="btn ' + b.cls + '" data-bi="' + i + '">' + U.esc(b.label) + '</button>';
        }).join('') + '</div></div>';
      var rec = openSheet(html, { center: true, onClose: function () { if (!done) { done = true; resolve(false); } } });
      rec.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-bi]');
        if (!b || done) return;
        var v = buttons[+b.getAttribute('data-bi')].value;
        done = true;
        if (v === true && o.keep) { resolve(true); return; }
        closeSheets(1);
        resolve(v);
      });
    });
  };

  /* =====================================================================
   * TRANSACTION FORM (savings + expenses)
   * ===================================================================== */
  function optionList(arr) {
    return arr.map(function (s) { return '<option value="' + U.esc(s) + '">'; }).join('');
  }

  A.openTxForm = function (o) {
    o = o || {};
    var t = o.tx || null, isEdit = !!t;
    var type = t ? t.type : (o.type || 'savings');
    var date = t ? t.date : (o.date || U.todayStr());
    var eCats = A.expenseCats();
    var goals = S.goals.filter(function (g) { return g.status === 'active' || (t && t.goalId === g.id) || o.goalId === g.id; });
    var goalSel = t ? (t.goalId || '') : (o.goalId || '');
    var selCat = (t && t.type === 'expense') ? t.category : '';
    var sv = t && t.type === 'savings' ? t : null, ex = t && t.type === 'expense' ? t : null;

    var html =
      '<div class="sheet-head"><h2 id="txTitle"></h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close">' + U.icon('x') + '</button></div>' +
      '<form id="txForm" novalidate autocomplete="off">' +
      (isEdit ? '' :
        '<div class="seg"><button type="button" data-type="savings">' + U.icon('down', 18) + ' Savings</button>' +
        '<button type="button" data-type="expense">' + U.icon('up', 18) + ' Expense</button></div>') +
      '<label class="fld"><span id="amtLabel">Amount (GH₵)</span>' +
      '<input name="amount" type="text" inputmode="decimal" placeholder="0.00" maxlength="16" value="' + (t ? U.esc(U.fmtPlain(t.amountP)) : '') + '"></label>' +
      '<label class="fld"><span id="dateLabel">Date</span><input name="date" type="date" value="' + date + '"></label>' +

      '<div data-group="savings">' +
      '<label class="fld"><span>Source of money</span>' +
      '<input name="source" list="srcList" maxlength="80" placeholder="Type where this money came from" value="' + U.esc(sv ? sv.source : '') + '">' +
      '<datalist id="srcList">' + optionList(savingsSources()) + '</datalist></label>' +
      '<label class="fld"><span>Category <em>(optional)</em></span>' +
      '<input name="scategory" list="scatList" maxlength="40" placeholder="e.g. type your own" value="' + U.esc(sv ? sv.category : '') + '">' +
      '<datalist id="scatList">' + optionList(savingsCats()) + '</datalist></label>' +
      '<label class="fld"><span>Put this towards a goal <em>(optional)</em></span><select name="goal">' +
      '<option value="">Not linked to a goal</option>' +
      goals.map(function (g) {
        return '<option value="' + U.esc(g.id) + '"' + (g.id === goalSel ? ' selected' : '') + '>' + U.esc(g.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="fld"><span>Description / notes</span>' +
      '<textarea name="snotes" rows="3" maxlength="500" placeholder="Anything you want to remember about this saving">' + U.esc(sv ? sv.notes : '') + '</textarea></label>' +
      '</div>' +

      '<div data-group="expense" hidden>' +
      '<label class="fld"><span>What did you use the money for?</span>' +
      '<input name="title" maxlength="100" placeholder="e.g. Lunch, trotro fare, data bundle" value="' + U.esc(ex ? ex.title : '') + '"></label>' +
      '<label class="fld"><span>Expense category</span><select name="ecat">' +
      '<option value="">Choose a category…</option>' +
      eCats.map(function (c) { return '<option value="' + U.esc(c) + '"' + (c === selCat ? ' selected' : '') + '>' + U.esc(c) + '</option>'; }).join('') +
      '<option value="__new__">+ Add my own category…</option></select></label>' +
      '<label class="fld" data-newcat hidden><span>New category name</span>' +
      '<input name="ecustom" maxlength="40" placeholder="Type your category"></label>' +
      '<label class="fld"><span>Additional notes</span>' +
      '<textarea name="enotes" rows="3" maxlength="500" placeholder="Optional">' + U.esc(ex ? ex.notes : '') + '</textarea></label>' +
      '</div>' +

      '<div class="form-err" id="formErr" role="alert" hidden></div>' +
      '<div class="form-actions">' +
      (isEdit ? '<button type="button" class="btn danger-outline" id="txDelete">' + U.icon('trash', 18) + ' Delete</button>' : '') +
      '<button type="button" class="btn ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn primary" id="txSave">Save</button></div>' +
      '</form>';

    var rec = openSheet(html);
    var form = $('#txForm', rec.el);
    var curType = type;

    function applyType(tp) {
      curType = tp;
      $$('[data-group]', form).forEach(function (g) { g.hidden = g.getAttribute('data-group') !== tp; });
      $$('.seg button', form).forEach(function (b) {
        var on = b.getAttribute('data-type') === tp;
        b.className = on ? ('on' + (tp === 'expense' ? ' exp' : '')) : '';
      });
      $('#txTitle', rec.el).textContent = (isEdit ? 'Edit ' : 'Add ') + (tp === 'savings' ? 'savings' : 'expense');
      $('#amtLabel', rec.el).textContent = tp === 'savings' ? 'Amount saved (GH₵)' : 'Amount spent (GH₵)';
      $('#dateLabel', rec.el).textContent = tp === 'savings' ? 'Date saved' : 'Date of expense';
      var save = $('#txSave', rec.el);
      save.textContent = isEdit ? 'Save changes' : (tp === 'savings' ? 'Save savings' : 'Save expense');
      save.className = 'btn ' + (tp === 'savings' ? 'primary' : 'expense-btn');
      showErr('');
    }

    function showErr(msg) {
      var e = $('#formErr', rec.el);
      e.hidden = !msg; e.textContent = msg || '';
    }

    $$('.seg button', form).forEach(function (b) {
      b.addEventListener('click', function () { applyType(b.getAttribute('data-type')); });
    });

    form.elements.ecat.addEventListener('change', function () {
      var isNew = form.elements.ecat.value === '__new__';
      $('[data-newcat]', form).hidden = !isNew;
      if (isNew) form.elements.ecustom.focus();
    });

    applyType(type);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var amountP = U.parseMoney(form.elements.amount.value);
      if (isNaN(amountP) || amountP <= 0) { showErr('Enter an amount greater than zero, using numbers only (for example 250 or 250.50).'); form.elements.amount.focus(); return; }
      var d = form.elements.date.value;
      if (!U.isDateStr(d)) { showErr('Please choose a valid date.'); return; }

      var now = Date.now();
      var obj = {
        id: t ? t.id : U.uid(), type: curType, amountP: amountP, date: d,
        source: '', title: '', category: '', notes: '', goalId: null,
        createdAt: t ? t.createdAt : now, updatedAt: now
      };

      if (curType === 'savings') {
        var src = U.clean(form.elements.source.value, 80);
        if (!src) { showErr('Please type the source of this money (where it came from).'); form.elements.source.focus(); return; }
        obj.source = U.canonical(src, savingsSources());
        var sc = U.clean(form.elements.scategory.value, 40);
        obj.category = sc ? U.canonical(sc, savingsCats()) : '';
        var gid = form.elements.goal.value;
        obj.goalId = gid && A.getGoal(gid) ? gid : null;
        obj.notes = U.cleanMultiline(form.elements.snotes.value, 500);
      } else {
        var ttl = U.clean(form.elements.title.value, 100);
        if (!ttl) { showErr('Please say what you used the money for.'); form.elements.title.focus(); return; }
        obj.title = ttl;
        var cv = form.elements.ecat.value;
        if (cv === '__new__') {
          var cc = U.clean(form.elements.ecustom.value, 40);
          if (!cc) { showErr('Please type the name of your new category.'); form.elements.ecustom.focus(); return; }
          obj.category = U.canonical(cc, eCats);
        } else if (!cv) {
          showErr('Please choose an expense category.'); return;
        } else {
          obj.category = cv;
        }
        obj.notes = U.cleanMultiline(form.elements.enotes.value, 500);
      }

      var before = A.achievedMap();
      var btn = $('#txSave', rec.el); btn.disabled = true;
      DB.saveTransaction(obj).then(function () {
        var i = -1;
        for (var k = 0; k < S.tx.length; k++) if (S.tx[k].id === obj.id) { i = k; break; }
        if (i >= 0) S.tx[i] = obj; else S.tx.push(obj);
        closeSheets(1);
        A.render(true);
        A.toast(isEdit ? 'Changes saved' : (obj.type === 'savings' ? 'Savings recorded' : 'Expense recorded'), 'ok');
        A.celebrate(before);
      }).catch(function () {
        btn.disabled = false;
        showErr('Sorry, this could not be saved on your phone. Please try again.');
      });
    });

    if (isEdit) {
      $('#txDelete', rec.el).addEventListener('click', function () {
        A.confirm({
          title: 'Delete this entry?',
          message: U.fmt(t.amountP) + ' • ' + A.txTitle(t) + ' • ' + U.fmtDateShort(t.date) + '. This cannot be undone.',
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Delete', value: true, cls: 'danger' }],
          keep: true
        }).then(function (ok) {
          if (!ok) return;
          A.removeTx(t.id).then(function () {
            closeSheets(2); A.render(true); A.toast('Entry deleted');
          }).catch(function () {
            closeSheets(1); A.toast('Could not delete this entry', 'err');
          });
        });
      });
    }

    if (!isEdit) setTimeout(function () { try { form.elements.amount.focus(); } catch (e) {} }, 320);
  };

  A.removeTx = function (id) {
    return DB.deleteTransaction(id).then(function () {
      S.tx = S.tx.filter(function (t) { return t.id !== id; });
    });
  };

  A.askDeleteTx = function (id) {
    var t = A.getTx(id); if (!t) return;
    A.confirm({
      title: 'Delete this entry?',
      message: U.fmt(t.amountP) + ' • ' + A.txTitle(t) + ' • ' + U.fmtDateShort(t.date) + '. This cannot be undone.',
      okText: 'Delete', danger: true
    }).then(function (ok) {
      if (!ok) return;
      A.removeTx(id).then(function () { A.render(true); A.toast('Entry deleted'); })
        .catch(function () { A.toast('Could not delete this entry', 'err'); });
    });
  };

  /* =====================================================================
   * GOALS
   * ===================================================================== */
  A.achievedMap = function () {
    var m = {};
    S.goals.forEach(function (g) { m[g.id] = A.goalStats(g).achieved; });
    return m;
  };

  A.celebrate = function (before) {
    for (var i = 0; i < S.goals.length; i++) {
      var g = S.goals[i];
      if ((g.id in before) && !before[g.id] && A.goalStats(g).achieved && g.status !== 'completed') {
        A.confirm({
          emoji: '🎉', title: 'Congratulations!',
          message: 'You have reached your goal "' + g.name + '" (' + U.fmt(g.targetP) + '). Well done — keep it up!',
          buttons: [{ label: 'Wonderful!', value: true, cls: 'primary' }]
        });
        return;
      }
    }
  };

  A.openGoalForm = function (id) {
    var g = id ? A.getGoal(id) : null, isEdit = !!g;
    var html =
      '<div class="sheet-head"><h2>' + (isEdit ? 'Edit goal' : 'New savings goal') + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close">' + U.icon('x') + '</button></div>' +
      '<form id="goalForm" novalidate autocomplete="off">' +
      '<label class="fld"><span>Goal name</span><input name="name" maxlength="60" placeholder="e.g. Buy a laptop" value="' + U.esc(g ? g.name : '') + '"></label>' +
      '<label class="fld"><span>Target amount (GH₵)</span><input name="target" inputmode="decimal" maxlength="16" placeholder="0.00" value="' + (g ? U.esc(U.fmtPlain(g.targetP)) : '') + '"></label>' +
      '<label class="fld"><span>Starting amount <em>(optional)</em></span><input name="start" inputmode="decimal" maxlength="16" placeholder="0.00" value="' + (g && g.startP ? U.esc(U.fmtPlain(g.startP)) : '') + '">' +
      '<small>Money you already set aside for this goal. It counts only towards this goal and is not added to your Total Savings. To count it in your balance, record it as a saving.</small></label>' +
      '<div class="two"><label class="fld"><span>Start date</span><input name="sdate" type="date" value="' + (g ? g.startDate : U.todayStr()) + '"></label>' +
      '<label class="fld"><span>Target date</span><input name="tdate" type="date" value="' + (g ? g.targetDate : '') + '"></label></div>' +
      '<label class="fld"><span>Description <em>(optional)</em></span><textarea name="desc" rows="3" maxlength="300" placeholder="Why this goal matters">' + U.esc(g ? g.description : '') + '</textarea></label>' +
      '<div class="form-err" id="goalErr" role="alert" hidden></div>' +
      '<div class="form-actions"><button type="button" class="btn ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn primary" id="goalSave">' + (isEdit ? 'Save changes' : 'Create goal') + '</button></div></form>';
    var rec = openSheet(html);
    var form = $('#goalForm', rec.el);
    function showErr(m) { var e = $('#goalErr', rec.el); e.hidden = !m; e.textContent = m || ''; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = U.clean(form.elements.name.value, 60);
      if (!name) { showErr('Please give your goal a name.'); form.elements.name.focus(); return; }
      var targetP = U.parseMoney(form.elements.target.value);
      if (isNaN(targetP) || targetP <= 0) { showErr('Enter a target amount greater than zero.'); form.elements.target.focus(); return; }
      var startP = 0, sv = form.elements.start.value.trim();
      if (sv) { startP = U.parseMoney(sv); if (isNaN(startP)) { showErr('The starting amount must be a number (or leave it empty).'); form.elements.start.focus(); return; } }
      var sd = form.elements.sdate.value, td = form.elements.tdate.value;
      if (!U.isDateStr(sd)) { showErr('Please choose a valid start date.'); return; }
      if (!U.isDateStr(td)) { showErr('Please choose the date you want to reach this goal by.'); return; }
      if (td < sd) { showErr('The target date must be on or after the start date.'); return; }
      var now = Date.now();
      var obj = {
        id: g ? g.id : U.uid(), name: name, targetP: targetP, startP: startP, startDate: sd, targetDate: td,
        description: U.cleanMultiline(form.elements.desc.value, 300), status: g ? g.status : 'active',
        createdAt: g ? g.createdAt : now, updatedAt: now
      };
      var before = A.achievedMap();
      $('#goalSave', rec.el).disabled = true;
      DB.saveGoal(obj).then(function () {
        var i = S.goals.indexOf(g);
        if (i >= 0) S.goals[i] = obj; else S.goals.push(obj);
        closeSheets(1); A.render(true);
        A.toast(isEdit ? 'Goal updated' : 'Goal created', 'ok');
        A.celebrate(before);
      }).catch(function () { $('#goalSave', rec.el).disabled = false; showErr('Sorry, this could not be saved. Please try again.'); });
    });
    if (!isEdit) setTimeout(function () { try { form.elements.name.focus(); } catch (e) {} }, 320);
  };

  function setGoalStatus(g, status, msg) {
    var obj = Object.assign({}, g, { status: status, updatedAt: Date.now() });
    DB.saveGoal(obj).then(function () {
      S.goals[S.goals.indexOf(g)] = obj; A.render(true); A.toast(msg, 'ok');
    }).catch(function () { A.toast('Could not update the goal', 'err'); });
  }

  A.goalAction = function (act, id) {
    var g = A.getGoal(id); if (!g) return;
    if (act === 'goal-edit') return A.openGoalForm(id);
    if (act === 'goal-add') return A.openTxForm({ type: 'savings', goalId: id });
    if (act === 'goal-pause') return setGoalStatus(g, g.status === 'paused' ? 'active' : 'paused', g.status === 'paused' ? 'Goal resumed' : 'Goal paused');
    if (act === 'goal-complete') {
      if (g.status === 'completed') return setGoalStatus(g, 'active', 'Goal re-opened');
      var st = A.goalStats(g);
      if (st.achieved) return setGoalStatus(g, 'completed', 'Goal marked as complete');
      return A.confirm({
        title: 'Mark as complete?', okText: 'Mark complete',
        message: 'You have saved ' + U.fmt(st.allocated) + ' of ' + U.fmt(g.targetP) + ' so far. Mark "' + g.name + '" as complete anyway?'
      }).then(function (ok) { if (ok) setGoalStatus(g, 'completed', 'Goal marked as complete'); });
    }
    if (act === 'goal-del') {
      var linked = S.tx.filter(function (t) { return t.goalId === g.id; });
      return A.confirm({
        title: 'Delete this goal?', okText: 'Delete goal', danger: true,
        message: 'Goal "' + g.name + '" will be removed.' + (linked.length ? ' Your ' + linked.length + ' saving record' + (linked.length > 1 ? 's' : '') + ' stay in your history and in your totals; they are just unlinked from this goal.' : '')
      }).then(function (ok) {
        if (!ok) return;
        var chain = Promise.resolve();
        linked.forEach(function (t) {
          var nt = Object.assign({}, t, { goalId: null, updatedAt: Date.now() });
          chain = chain.then(function () { return DB.saveTransaction(nt); }).then(function () { S.tx[S.tx.indexOf(t)] = nt; });
        });
        chain.then(function () { return DB.deleteGoal(g.id); }).then(function () {
          S.goals = S.goals.filter(function (x) { return x.id !== g.id; });
          A.render(true); A.toast('Goal deleted');
        }).catch(function () { A.render(true); A.toast('Could not delete the goal', 'err'); });
      });
    }
  };

  /* =====================================================================
   * ADD CHOOSER
   * ===================================================================== */
  A.openChooser = function (date) {
    var html =
      '<div class="sheet-head"><h2>What would you like to add?</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close">' + U.icon('x') + '</button></div>' +
      '<div class="chooser">' +
      '<button class="choose-card sv" data-ch="savings">' + U.icon('down', 26) + '<b>Add Savings</b><small>Record money you saved</small></button>' +
      '<button class="choose-card ex" data-ch="expense">' + U.icon('up', 26) + '<b>Add Expense</b><small>Record money you spent</small></button>' +
      '<button class="choose-card gl" data-ch="goal">' + U.icon('target', 26) + '<b>New Goal</b><small>Set a savings target</small></button>' +
      '</div>';
    var rec = openSheet(html);
    rec.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ch]'); if (!b) return;
      var ch = b.getAttribute('data-ch');
      closeSheets(1);
      setTimeout(function () {
        if (ch === 'goal') A.openGoalForm(); else A.openTxForm({ type: ch, date: date });
      }, 120);
    });
  };

  /* =====================================================================
   * BACKUP / RESTORE / CSV / CLEAR
   * ===================================================================== */
  A.buildBackup = function () {
    return {
      app: 'OKATAKYIRE WALLET', format: 1, appVersion: A.VERSION,
      exportedAt: new Date().toISOString(), amountUnit: 'pesewas',
      transactions: S.tx, goals: S.goals, settings: { theme: S.settings.theme || 'light' }
    };
  };

  A.exportBackup = function (opts) {
    opts = opts || {};
    var name = (opts.prefix || 'okatakyire-wallet-backup') + '-' + U.todayStr() + '.json';
    U.download(name, JSON.stringify(A.buildBackup(), null, 2), 'application/json');
    var ts = Date.now();
    S.settings.lastBackup = ts;
    DB.setSetting('lastBackup', ts);
    if (!opts.silent) { A.toast('Backup file saved to your Downloads', 'ok'); A.render(true); }
  };

  A.exportCSV = function (list, label) {
    list = (list || S.tx).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0); });
    var rows = [['Date', 'Type', 'Amount (GHS)', 'Source / Purpose', 'Category', 'Goal', 'Notes']];
    list.forEach(function (t) {
      var g = t.goalId ? A.getGoal(t.goalId) : null;
      rows.push([t.date, t.type === 'savings' ? 'Savings' : 'Expense', U.fmtPlain(t.amountP), A.txTitle(t), t.category || '', g ? g.name : '', t.notes || '']);
    });
    var csv = '﻿' + rows.map(function (r, i) {
      return r.map(function (c, j) { return U.csvCell(c, i > 0 && (j === 3 || j === 4 || j === 5 || j === 6)); }).join(',');
    }).join('\r\n');
    U.download('okatakyire-wallet-' + (label || 'transactions') + '-' + U.todayStr() + '.csv', csv, 'text/csv');
    A.toast('CSV file saved (' + list.length + ' rows)', 'ok');
  };

  function sanitizeImport(data) {
    var skipped = 0, goalIds = {};
    var goals = [];
    (Array.isArray(data.goals) ? data.goals : []).forEach(function (g) {
      if (!g || typeof g !== 'object') { skipped++; return; }
      var targetP = Math.round(Number(g.targetP)), startP = Math.round(Number(g.startP) || 0);
      var name = U.clean(g.name, 60);
      if (!name || !(targetP > 0) || !(startP >= 0) || !U.isDateStr(g.startDate) || !U.isDateStr(g.targetDate)) { skipped++; return; }
      var id = typeof g.id === 'string' && g.id ? g.id : U.uid();
      if (goalIds[id]) { skipped++; return; }
      goalIds[id] = 1;
      goals.push({
        id: id, name: name, targetP: targetP, startP: startP, startDate: g.startDate, targetDate: g.targetDate,
        description: U.cleanMultiline(g.description, 300),
        status: ['active', 'paused', 'completed'].indexOf(g.status) >= 0 ? g.status : 'active',
        createdAt: Number(g.createdAt) || Date.now(), updatedAt: Number(g.updatedAt) || Date.now()
      });
    });
    var txIds = {}, tx = [];
    (Array.isArray(data.transactions) ? data.transactions : []).forEach(function (t) {
      if (!t || typeof t !== 'object') { skipped++; return; }
      var amountP = Math.round(Number(t.amountP));
      if ((t.type !== 'savings' && t.type !== 'expense') || !(amountP > 0) || !U.isDateStr(t.date)) { skipped++; return; }
      var id = typeof t.id === 'string' && t.id ? t.id : U.uid();
      if (txIds[id]) { skipped++; return; }
      var o = {
        id: id, type: t.type, amountP: amountP, date: t.date,
        source: '', title: '', category: U.clean(t.category, 40), notes: U.cleanMultiline(t.notes, 500), goalId: null,
        createdAt: Number(t.createdAt) || Date.now(), updatedAt: Number(t.updatedAt) || Date.now()
      };
      if (t.type === 'savings') {
        o.source = U.clean(t.source, 80) || 'Savings';
        o.goalId = (typeof t.goalId === 'string' && goalIds[t.goalId]) ? t.goalId : null;
      } else {
        o.title = U.clean(t.title, 100) || 'Expense';
        if (!o.category) o.category = 'Other';
      }
      txIds[id] = 1; tx.push(o);
    });
    return { transactions: tx, goals: goals, skipped: skipped };
  }

  A.restoreFromText = function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return A.toast('That file could not be read. Please choose an OKATAKYIRE WALLET backup (.json) file.', 'err'); }
    if (!data || typeof data !== 'object' || data.app !== 'OKATAKYIRE WALLET' || data.amountUnit !== 'pesewas' || !Array.isArray(data.transactions)) {
      return A.toast('This is not an OKATAKYIRE WALLET backup file.', 'err');
    }
    var inc = sanitizeImport(data);
    var when = data.exportedAt ? new Date(data.exportedAt) : null;
    var whenTxt = when && !isNaN(when) ? U.fmtDateShort(when.getFullYear() + '-' + U.pad(when.getMonth() + 1) + '-' + U.pad(when.getDate())) : 'unknown date';
    var haveAny = S.tx.length || S.goals.length;
    A.confirm({
      title: 'Restore this backup?',
      message: 'Backup from ' + whenTxt + ': ' + inc.transactions.length + ' transactions and ' + inc.goals.length + ' goals' +
        (inc.skipped ? ' (' + inc.skipped + ' invalid rows will be skipped)' : '') + '. ' +
        (haveAny ? 'On this phone now: ' + S.tx.length + ' transactions and ' + S.goals.length + ' goals. ' : '') +
        (haveAny ? 'Merge keeps everything you have and adds what is missing. Replace swaps your current records for the backup (a safety copy of your current data is downloaded first).' : ''),
      buttons: haveAny ? [
        { label: 'Merge (recommended)', value: 'merge', cls: 'primary' },
        { label: 'Replace everything', value: 'replace', cls: 'danger-outline' },
        { label: 'Cancel', value: false, cls: 'ghost' }
      ] : [
        { label: 'Restore', value: 'replace', cls: 'primary' },
        { label: 'Cancel', value: false, cls: 'ghost' }
      ]
    }).then(function (mode) {
      if (!mode) return;
      var next;
      if (mode === 'merge') {
        var have = {}, haveG = {};
        S.tx.forEach(function (t) { have[t.id] = 1; });
        S.goals.forEach(function (g) { haveG[g.id] = 1; });
        var goals = S.goals.concat(inc.goals.filter(function (g) { return !haveG[g.id]; }));
        var gids = {}; goals.forEach(function (g) { gids[g.id] = 1; });
        var tx = S.tx.concat(inc.transactions.filter(function (t) { return !have[t.id]; }).map(function (t) {
          if (t.goalId && !gids[t.goalId]) t.goalId = null; return t;
        }));
        next = { transactions: tx, goals: goals };
      } else {
        if (haveAny) A.exportBackup({ prefix: 'okatakyire-wallet-before-restore', silent: true });
        next = { transactions: inc.transactions, goals: inc.goals };
      }
      var theme = data.settings && ['light', 'dark', 'system'].indexOf(data.settings.theme) >= 0 ? data.settings.theme : null;
      DB.replaceAll(next).then(function () {
        S.tx = next.transactions; S.goals = next.goals;
        if (theme && mode === 'replace') { S.settings.theme = theme; DB.setSetting('theme', theme); A.applyTheme(); }
        A.render(true);
        A.toast('Backup restored: ' + S.tx.length + ' transactions, ' + S.goals.length + ' goals', 'ok');
      }).catch(function () { A.toast('Restore failed. Your existing records were not changed.', 'err'); });
    });
  };

  A.openClearData = function () {
    var html =
      '<div class="confirm"><div class="confirm-emoji">⚠️</div><h2>Delete ALL data?</h2>' +
      '<p>This permanently removes every saving, expense and goal from this phone. It cannot be undone.</p>' +
      '<button type="button" class="btn primary block" id="clrBackup">' + U.icon('download', 18) + ' Download a backup first</button>' +
      '<label class="fld"><span>Type <b>DELETE</b> to confirm</span><input id="clrInput" autocomplete="off" autocapitalize="characters" placeholder="DELETE"></label>' +
      '<div class="confirm-actions"><button type="button" class="btn ghost" data-close>Cancel</button>' +
      '<button type="button" class="btn danger" id="clrGo" disabled>Delete everything</button></div></div>';
    var rec = openSheet(html, { center: true });
    var inp = $('#clrInput', rec.el), go = $('#clrGo', rec.el);
    inp.addEventListener('input', function () { go.disabled = inp.value.trim() !== 'DELETE'; });
    $('#clrBackup', rec.el).addEventListener('click', function () { A.exportBackup(); });
    go.addEventListener('click', function () {
      if (inp.value.trim() !== 'DELETE') return;
      var theme = S.settings.theme || 'light';
      DB.clearAll().then(function () {
        S.tx = []; S.goals = []; S.settings = { theme: theme, welcomed: true };
        return Promise.all([DB.setSetting('theme', theme), DB.setSetting('welcomed', true)]);
      }).then(function () {
        closeSheets(1); A.render(true); A.toast('All data deleted');
      }).catch(function () { A.toast('Could not delete the data', 'err'); });
    });
  };

  /* =====================================================================
   * THEME
   * ===================================================================== */
  A.isDark = function () {
    var th = S.settings.theme || 'light';
    return th === 'dark' || (th === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  };

  A.applyTheme = function () {
    var dark = A.isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#06150d' : '#0a3d1f');
    try { localStorage.setItem('okw-theme', S.settings.theme || 'light'); } catch (e) {}
  };

  A.setTheme = function (th) {
    S.settings.theme = th;
    DB.setSetting('theme', th);
    A.applyTheme();
    A.render(true);
  };

  /* =====================================================================
   * ROUTER + RENDER
   * ===================================================================== */
  A.killCharts = function () {
    A.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
    A.charts = [];
  };

  A.go = function (name) {
    if (location.hash === '#/' + name) { window.scrollTo(0, 0); return; }
    location.hash = '#/' + name;
  };

  A.route = function () {
    var h = (location.hash || '').replace(/^#\/?/, '');
    A.current = ROUTES[h] ? h : 'home';
    A.render(false);
  };

  A.render = function (keepScroll) {
    var v = A.views[A.current];
    if (!v) return;
    var sy = window.scrollY;
    A.killCharts();
    var active = document.activeElement;
    var keepFocusId = active && active.id && active.tagName === 'INPUT' ? active.id : null;
    $('#main').innerHTML = v.html();
    var navActive = NAV_PARENT[A.current] || A.current;
    $$('.nav-item').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-go') === navActive); });
    if (v.after) v.after();
    if (keepScroll && A._lastView === A.current) window.scrollTo(0, sy); else window.scrollTo(0, 0);
    A._lastView = A.current;
    if (keepFocusId) { var f = document.getElementById(keepFocusId); if (f) f.focus(); }
  };

  /* =====================================================================
   * EVENTS
   * ===================================================================== */
  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) {
      var nav = e.target.closest('[data-go]');
      if (nav) A.go(nav.getAttribute('data-go'));
      return;
    }
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    switch (act) {
      case 'add': A.openChooser(); break;
      case 'add-savings': A.openTxForm({ type: 'savings', date: el.getAttribute('data-date') || undefined }); break;
      case 'add-expense': A.openTxForm({ type: 'expense', date: el.getAttribute('data-date') || undefined }); break;
      case 'goal-new': A.openGoalForm(); break;
      case 'edit-tx': A.openTxForm({ tx: A.getTx(id) }); break;
      case 'del-tx': A.askDeleteTx(id); break;
      case 'goal-edit': case 'goal-add': case 'goal-pause': case 'goal-complete': case 'goal-del': A.goalAction(act, id); break;
      case 'goto': A.go(el.getAttribute('data-to')); break;
      case 'theme': A.setTheme(el.getAttribute('data-v')); break;
      case 'export-json': A.exportBackup(); break;
      case 'export-csv': A.exportCSV(); break;
      case 'restore': var ri = $('#restoreInput'); ri.value = ''; ri.click(); break;
      case 'clear': A.openClearData(); break;
      case 'install':
        if (A.deferredPrompt) { A.deferredPrompt.prompt(); A.deferredPrompt = null; A.render(true); }
        break;
      default:
        if (A.views[A.current] && A.views[A.current].act) A.views[A.current].act(act, el, id);
    }
  }

  function finishWelcome() {
    var w = $('#welcome');
    S.settings.welcomed = true; DB.setSetting('welcomed', true);
    if (w) { w.classList.add('out'); setTimeout(function () { w.remove(); }, 400); }
  }

  function showWelcome() {
    var w = document.createElement('div');
    w.id = 'welcome';
    w.innerHTML =
      '<div class="welcome-inner"><img src="icons/logo-256.png" alt="OKATAKYIRE WALLET logo" width="168" height="168">' +
      '<h1>Welcome to<br>OKATAKYIRE WALLET</h1>' +
      '<p class="tag">Track • Save • Plan • Achieve</p>' +
      '<ul><li>' + U.icon('shield', 18) + ' Your records stay on this phone only.</li>' +
      '<li>' + U.icon('wallet', 18) + ' Works fully offline, no account needed.</li>' +
      '<li>' + U.icon('download', 18) + ' Back up regularly from Settings so you never lose your records.</li></ul>' +
      '<button class="btn gold block" id="welcomeGo">Get Started</button></div>';
    $('#overlays').appendChild(w);
    $('#welcomeGo', w).addEventListener('click', finishWelcome);
  }

  function hideSplash() {
    var s = $('#splash');
    if (!s) return;
    s.classList.add('out');
    setTimeout(function () { s.remove(); }, 500);
  }

  function fatal(err) {
    hideSplash();
    $('#main').innerHTML = '<div class="card empty"><h2>Storage unavailable</h2><p>OKATAKYIRE WALLET could not open its database on this device' +
      (err && err.message ? ' (' + U.esc(err.message) + ')' : '') +
      '. Please make sure you are not in a private/incognito window, that storage is allowed for this site, and then reload.</p></div>';
  }

  function init() {
    var t0 = Date.now();
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', A.route);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var cb = function () { if ((S.settings.theme || 'light') === 'system') { A.applyTheme(); A.render(true); } };
      if (mq.addEventListener) mq.addEventListener('change', cb); else if (mq.addListener) mq.addListener(cb);
    }
    $('#restoreInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { A.restoreFromText(String(r.result)); };
      r.onerror = function () { A.toast('Could not read that file.', 'err'); };
      r.readAsText(f);
    });
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); A.deferredPrompt = e; if (A.current === 'settings') A.render(true); });
    window.addEventListener('appinstalled', function () { A.deferredPrompt = null; A.toast('App installed', 'ok'); });

    DB.open().then(function () {
      return Promise.all([DB.getTransactions(), DB.getGoals(), DB.getAllSettings()]);
    }).then(function (r) {
      S.tx = r[0]; S.goals = r[1]; S.settings = r[2] || {};
      A.applyTheme();
      DB.persist().then(function (ok) { A.persisted = !!ok; });
      if (!location.hash) history.replaceState(null, '', '#/home');
      A.route();
      var wait = Math.max(0, 700 - (Date.now() - t0));
      setTimeout(function () {
        hideSplash();
        if (!S.settings.welcomed) showWelcome();
        var q = /[?&]add=(savings|expense)/.exec(location.search);
        if (q) { history.replaceState(null, '', location.pathname + location.hash); A.openTxForm({ type: q[1] }); }
      }, wait);
    }).catch(fatal);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('service-worker.js').catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
