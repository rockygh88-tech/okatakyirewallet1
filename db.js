/* OKATAKYIRE WALLET - IndexedDB storage layer
 * Stores: transactions (savings + expenses), goals, settings.
 * Amounts are stored as integer pesewas (1 GH₵ = 100 pesewas) so sums never drift.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'okatakyire-wallet';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB is not supported on this device.')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('transactions')) {
          var t = db.createObjectStore('transactions', { keyPath: 'id' });
          t.createIndex('date', 'date', { unique: false });
          t.createIndex('type', 'type', { unique: false });
        }
        if (!db.objectStoreNames.contains('goals')) {
          db.createObjectStore('goals', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('Could not open database')); };
      req.onblocked = function () { reject(new Error('Database is blocked by another tab. Close other tabs and reload.')); };
    });
    return dbPromise;
  }

  function wrap(storeNames, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeNames, mode);
        var result;
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('Transaction aborted')); };
        try { result = fn(tx); } catch (err) { try { tx.abort(); } catch (e) {} reject(err); }
      });
    });
  }

  function reqP(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getAll(store) {
    return open().then(function (db) {
      return reqP(db.transaction(store, 'readonly').objectStore(store).getAll());
    });
  }

  function put(store, obj) {
    return wrap(store, 'readwrite', function (tx) { tx.objectStore(store).put(obj); return obj; });
  }

  function del(store, id) {
    return wrap(store, 'readwrite', function (tx) { tx.objectStore(store).delete(id); });
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getSetting(key, fallback) {
    return open().then(function (db) {
      return reqP(db.transaction('settings', 'readonly').objectStore('settings').get(key));
    }).then(function (row) { return row ? row.value : fallback; });
  }

  function setSetting(key, value) {
    return put('settings', { key: key, value: value });
  }

  /* Replace everything (used by restore). Done in one transaction so a failed
   * restore leaves the existing data untouched. */
  function replaceAll(data) {
    return wrap(['transactions', 'goals', 'settings'], 'readwrite', function (tx) {
      var tS = tx.objectStore('transactions'), gS = tx.objectStore('goals'), sS = tx.objectStore('settings');
      tS.clear(); gS.clear();
      (data.transactions || []).forEach(function (t) { tS.put(t); });
      (data.goals || []).forEach(function (g) { gS.put(g); });
      var s = data.settings || {};
      Object.keys(s).forEach(function (k) { sS.put({ key: k, value: s[k] }); });
    });
  }

  function clearAll() {
    return wrap(['transactions', 'goals', 'settings'], 'readwrite', function (tx) {
      tx.objectStore('transactions').clear();
      tx.objectStore('goals').clear();
      tx.objectStore('settings').clear();
    });
  }

  function getAllSettings() {
    return getAll('settings').then(function (rows) {
      var o = {}; rows.forEach(function (r) { o[r.key] = r.value; }); return o;
    });
  }

  function persist() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  global.WalletDB = {
    open: open, uid: uid,
    getTransactions: function () { return getAll('transactions'); },
    saveTransaction: function (t) { return put('transactions', t); },
    deleteTransaction: function (id) { return del('transactions', id); },
    getGoals: function () { return getAll('goals'); },
    saveGoal: function (g) { return put('goals', g); },
    deleteGoal: function (id) { return del('goals', id); },
    getSetting: getSetting, setSetting: setSetting, getAllSettings: getAllSettings,
    replaceAll: replaceAll, clearAll: clearAll, persist: persist
  };
})(window);
