/* Gota — núcleo de lógica (sem DOM, sem armazenamento).
 * Datas e horários são "relógio de parede" local, guardados como texto
 * ("YYYY-MM-DD" e "HH:MM"). Para cálculos usamos "minutos absolutos":
 * diaNumérico * 1440 + minutoDoDia. Não há fuso/UTC envolvido, então
 * intervalos que atravessam a meia-noite são aritmética simples.
 * Funciona no navegador (window.GotaCore) e no Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GotaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA = 2;
  var MIN_GROUP = 3;      // mínimo de noites por grupo para gerar observação
  var MIN_TOTAL = 8;      // mínimo de noites comparáveis no total
  var MAX_DRINK_ML = 10000;
  var BATH_TOLERANCE = 10; // minutos de tolerância para sugerir despertar ↔ banheiro

  var TYPES = {
    water:     { label: 'Água',         emoji: '💧', group: 'water' },
    coffee:    { label: 'Café',         emoji: '☕', group: 'coffee' },
    chimarrao: { label: 'Chimarrão',    emoji: '🧉', group: 'chimarrao' },
    tea:       { label: 'Chá',          emoji: '🍵', group: 'other' },
    juice:     { label: 'Suco',         emoji: '🧃', group: 'other' },
    soda:      { label: 'Refrigerante', emoji: '🥤', group: 'other' },
    other:     { label: 'Outros',       emoji: '🥛', group: 'other' }
  };
  var TYPE_ORDER = ['water', 'coffee', 'chimarrao', 'tea', 'juice', 'soda', 'other'];
  var GROUPS = ['water', 'coffee', 'chimarrao', 'other'];
  var RATINGS = {
    1: 'Dormi muito mal', 2: 'Dormi mal', 3: 'Dormi razoavelmente', 4: 'Dormi bem', 5: 'Dormi muito bem'
  };

  /* ------------------------------------------------------------------ */
  /* Datas e horários                                                    */
  /* ------------------------------------------------------------------ */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dayNum(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }
  function numToDate(n) {
    var dt = new Date(n * 86400000);
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }
  function isDate(s) { return typeof s === 'string' && dayNum(s) !== null; }
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function addDays(s, n) { return numToDate(dayNum(s) + n); }
  function hm2min(s) { return +s.slice(0, 2) * 60 + +s.slice(3, 5); }
  function min2hm(m) { m = ((m % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  function toAbs(date, time) { return dayNum(date) * 1440 + hm2min(time); }
  function fromAbs(a) { return { date: numToDate(Math.floor(a / 1440)), time: min2hm(a) }; }
  function localDateKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function localTime(d) { d = d || new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function nowAbs(d) { d = d || new Date(); return toAbs(localDateKey(d), localTime(d)); }

  /** A qual "noite" pertence um horário? Antes do meio-dia conta como madrugada da noite anterior. */
  function nightKeyOf(date, time) {
    return (isTime(time) && time < '12:00') ? addDays(date, -1) : date;
  }

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */
  var seq = 0;
  function uid(prefix) {
    seq = (seq + 1) % 1679616;
    return (prefix || 'x') + Date.now().toString(36) + seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function defaultSettings() {
    return { goalMl: 2000, recordStreak: 0, quickCoffee: [50, 100, 200], quickChima: [250, 500, 1000] };
  }

  function createEmptyState(nowIso) {
    return {
      app: 'gota', schema: SCHEMA,
      settings: defaultSettings(),
      drinks: [], vitamins: {}, bathroom: [], nights: [],
      legacy: null,
      meta: { createdAt: nowIso || new Date().toISOString(), updatedAt: null, rev: 0 }
    };
  }

  function ensureShape(s) {
    s.app = 'gota'; s.schema = SCHEMA;
    s.settings = Object.assign(defaultSettings(), s.settings || {});
    ['drinks', 'bathroom', 'nights'].forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
    if (!s.vitamins || typeof s.vitamins !== 'object') s.vitamins = {};
    if (!s.meta || typeof s.meta !== 'object') s.meta = { createdAt: new Date().toISOString(), updatedAt: null, rev: 0 };
    if (s.legacy === undefined) s.legacy = null;
    return s;
  }

  function cleanQuick(arr, fallback) {
    if (!Array.isArray(arr)) return fallback.slice();
    var out = arr.map(function (v) { return Math.round(+v); })
      .filter(function (v) { return v > 0 && v <= MAX_DRINK_ML; });
    return out.length ? out.slice(0, 4) : fallback.slice();
  }

  /* ------------------------------------------------------------------ */
  /* Migração do Gota v1 ("gota_agua_state_v1")                          */
  /* ------------------------------------------------------------------ */
  function isV1(raw) {
    return !!raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object' && !Array.isArray(raw.drinks);
  }

  function parseV1Time(t) {
    if (typeof t !== 'string') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return null;                       // "--:--" e qualquer outra coisa => horário desconhecido
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return pad2(h) + ':' + pad2(mi);
  }

  /** Converte o estado v1 em v2 SEM alterar o objeto de entrada. */
  function migrateV1(v1, nowIso) {
    var st = createEmptyState(nowIso);
    var report = { entries: 0, dropped: 0, days: 0, unknownTime: 0 };
    var goal = Math.round(+v1.goalMl);
    if (goal > 0) st.settings.goalMl = goal;
    var rec = Math.round(+v1.record);
    if (rec > 0) st.settings.recordStreak = rec;

    Object.keys(v1.days).sort().forEach(function (date) {
      if (!isDate(date)) { report.dropped++; return; }
      var day = v1.days[date] || {};
      report.days++;
      if (day.vitamins === true) st.vitamins[date] = true;
      var seen = {};
      (Array.isArray(day.entries) ? day.entries : []).forEach(function (e) {
        var ml = Math.round(+(e && e.amt));
        if (!(ml > 0) || ml > MAX_DRINK_ML * 10) { report.dropped++; return; }
        var time = parseV1Time(e.time);
        if (time === null) report.unknownTime++;
        var key = date + '|' + (time || '--:--') + '|' + ml;
        seen[key] = (seen[key] || 0) + 1;
        st.drinks.push({
          id: 'v1:' + key + '|' + seen[key],   // determinístico: reimportar o backup antigo não duplica
          type: 'water', ml: ml, date: date, time: time,
          wake: !!e.wake, source: 'v1', createdAt: null, updatedAt: null
        });
        report.entries++;
      });
    });
    st.legacy = { v1: JSON.parse(JSON.stringify(v1)), migratedAt: nowIso || new Date().toISOString() };
    st.meta.migratedFromV1 = { at: nowIso || new Date().toISOString(), entries: report.entries, days: report.days };
    return { state: st, report: report };
  }

  /* ------------------------------------------------------------------ */
  /* Validação / normalização (importação)                               */
  /* ------------------------------------------------------------------ */
  function sanitizeDrink(d) {
    if (!d || typeof d !== 'object') return null;
    var type = TYPES[d.type] ? d.type : null;
    var ml = Math.round(+d.ml);
    if (!type || !(ml > 0) || ml > MAX_DRINK_ML * 10 || !isDate(d.date)) return null;
    var out = {
      id: typeof d.id === 'string' && d.id ? d.id : uid('d'),
      type: type, ml: ml, date: d.date,
      time: isTime(d.time) ? d.time : null,
      createdAt: d.createdAt || null, updatedAt: d.updatedAt || null
    };
    if (d.wake) out.wake = true;
    if (d.source) out.source = String(d.source).slice(0, 20);
    if (isTime(d.start) && isTime(d.end) && out.time) { out.start = d.start; out.end = d.end; out.time = d.end; }
    return out;
  }

  function sanitizeAwakening(a) {
    if (!a || !isTime(a.start) || !isTime(a.end)) return null;
    return { id: typeof a.id === 'string' && a.id ? a.id : uid('a'), start: a.start, end: a.end, bathroom: !!a.bathroom };
  }

  function sanitizeNight(n) {
    if (!n || typeof n !== 'object' || !isDate(n.date) || !isTime(n.sleep) || !isTime(n.wake)) return null;
    var out = {
      id: typeof n.id === 'string' && n.id ? n.id : uid('n'),
      date: n.date, sleep: n.sleep, wake: n.wake,
      awakenings: (Array.isArray(n.awakenings) ? n.awakenings : []).map(sanitizeAwakening).filter(Boolean),
      aggregate: null,
      score: null, rating: null, notes: typeof n.notes === 'string' ? n.notes.slice(0, 2000) : '',
      createdAt: n.createdAt || null, updatedAt: n.updatedAt || null
    };
    if (n.aggregate && typeof n.aggregate === 'object') {
      var c = n.aggregate.count, m = n.aggregate.minutes;
      out.aggregate = {
        count: (c === null || c === undefined || c === '') ? null : Math.max(0, Math.round(+c)),
        minutes: (m === null || m === undefined || m === '') ? null : Math.max(0, Math.round(+m))
      };
      if (out.aggregate.count !== null && isNaN(out.aggregate.count)) out.aggregate.count = null;
      if (out.aggregate.minutes !== null && isNaN(out.aggregate.minutes)) out.aggregate.minutes = null;
    }
    if (n.score !== null && n.score !== undefined && n.score !== '' && +n.score >= 0 && +n.score <= 10) out.score = Math.round(+n.score * 2) / 2;
    if (n.rating !== null && n.rating !== undefined && +n.rating >= 1 && +n.rating <= 5) out.rating = Math.round(+n.rating);
    return validateNight(out).errors.length ? null : out;
  }

  function sanitizeBathroom(b) {
    if (!b || !isDate(b.date) || !isTime(b.time)) return null;
    var out = {
      id: typeof b.id === 'string' && b.id ? b.id : uid('b'),
      date: b.date, time: b.time,
      awakeningId: typeof b.awakeningId === 'string' ? b.awakeningId : null,
      createdAt: b.createdAt || null, updatedAt: b.updatedAt || null
    };
    if (b.noLink) out.noLink = true;
    return out;
  }

  function dedupeIds(list, prefix) {
    var seenIds = {};
    list.forEach(function (x) { if (seenIds[x.id]) x.id = uid(prefix); seenIds[x.id] = true; });
  }

  /** Aceita backup v1 ou v2. Lança Error com mensagem em português se for inválido. */
  function normalizeState(raw, nowIso) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Arquivo não contém um backup do Gota.');
    var st, report = { dropped: 0, format: null, entries: 0 };
    if (isV1(raw)) {
      var mig = migrateV1(raw, nowIso);
      st = mig.state; report.format = 'v1'; report.dropped = mig.report.dropped;
    } else if (raw.schema === SCHEMA || Array.isArray(raw.drinks) || Array.isArray(raw.nights)) {
      if (raw.schema && raw.schema > SCHEMA) throw new Error('Backup de uma versão mais nova do Gota. Atualize o aplicativo antes de importar.');
      report.format = 'v2';
      st = createEmptyState(nowIso);
      var rs = raw.settings || {};
      var goal = Math.round(+rs.goalMl);
      if (goal > 0) st.settings.goalMl = goal;
      var rec = Math.round(+rs.recordStreak);
      if (rec > 0) st.settings.recordStreak = rec;
      st.settings.quickCoffee = cleanQuick(rs.quickCoffee, st.settings.quickCoffee);
      st.settings.quickChima = cleanQuick(rs.quickChima, st.settings.quickChima);
      var count = function (arr, fn) {
        var ok = [];
        (Array.isArray(arr) ? arr : []).forEach(function (x) { var y = fn(x); if (y) ok.push(y); else report.dropped++; });
        return ok;
      };
      st.drinks = count(raw.drinks, sanitizeDrink);
      st.bathroom = count(raw.bathroom, sanitizeBathroom);
      var nights = count(raw.nights, sanitizeNight);
      var byDate = {};
      nights.forEach(function (n) { if (!byDate[n.date]) byDate[n.date] = n; else report.dropped++; });
      st.nights = Object.keys(byDate).map(function (k) { return byDate[k]; });
      if (raw.vitamins && typeof raw.vitamins === 'object') {
        Object.keys(raw.vitamins).forEach(function (k) { if (isDate(k) && raw.vitamins[k] === true) st.vitamins[k] = true; });
      }
      if (raw.legacy && typeof raw.legacy === 'object') st.legacy = raw.legacy;
      if (raw.meta && typeof raw.meta === 'object') {
        if (raw.meta.createdAt) st.meta.createdAt = raw.meta.createdAt;
        if (raw.meta.migratedFromV1) st.meta.migratedFromV1 = raw.meta.migratedFromV1;
      }
    } else {
      throw new Error('Formato de backup não reconhecido.');
    }
    dedupeIds(st.drinks, 'd'); dedupeIds(st.bathroom, 'b'); dedupeIds(st.nights, 'n');
    report.entries = st.drinks.length;
    return { state: ensureShape(st), report: report };
  }

  /** Mescla `inc` em `cur` (mutando cur) sem apagar nada e sem duplicar por id. */
  function mergeStates(cur, inc) {
    var added = { drinks: 0, bathroom: 0, nights: 0, vitamins: 0, skipped: 0 };
    var ids = {};
    cur.drinks.forEach(function (d) { ids[d.id] = true; });
    inc.drinks.forEach(function (d) { if (ids[d.id]) added.skipped++; else { cur.drinks.push(d); ids[d.id] = true; added.drinks++; } });
    ids = {};
    cur.bathroom.forEach(function (b) { ids[b.id] = true; });
    inc.bathroom.forEach(function (b) { if (ids[b.id]) added.skipped++; else { cur.bathroom.push(b); ids[b.id] = true; added.bathroom++; } });
    var nid = {}, ndate = {};
    cur.nights.forEach(function (n) { nid[n.id] = true; ndate[n.date] = true; });
    inc.nights.forEach(function (n) {
      if (nid[n.id] || ndate[n.date]) added.skipped++;     // a noite que já existe prevalece
      else { cur.nights.push(n); nid[n.id] = true; ndate[n.date] = true; added.nights++; }
    });
    Object.keys(inc.vitamins).forEach(function (k) { if (!cur.vitamins[k]) { cur.vitamins[k] = true; added.vitamins++; } });
    cur.settings.recordStreak = Math.max(cur.settings.recordStreak || 0, inc.settings.recordStreak || 0);
    if (!cur.legacy && inc.legacy) cur.legacy = inc.legacy;
    return added;
  }

  /* ------------------------------------------------------------------ */
  /* Bebidas                                                             */
  /* ------------------------------------------------------------------ */
  function groupOf(type) { return TYPES[type] ? TYPES[type].group : 'other'; }

  /** Intervalo [s,e] em minutos absolutos, ou null se o horário é desconhecido. Sessão: start..end. */
  function drinkInterval(d) {
    if (!d || !isTime(d.time) || !isDate(d.date)) return null;
    if (isTime(d.start) && isTime(d.end)) {
      var s = toAbs(d.date, d.start), e = toAbs(d.date, d.end);
      if (e < s) e += 1440;
      return { s: s, e: e };
    }
    var t = toAbs(d.date, d.time);
    return { s: t, e: t };
  }

  function validateDrinkInput(p, opts) {
    opts = opts || {};
    if (!TYPES[p.type]) return 'Tipo de bebida inválido.';
    var ml = Math.round(+p.ml);
    if (!(ml > 0)) return 'Informe a quantidade em ml.';
    if (ml > MAX_DRINK_ML) return 'Quantidade acima de ' + MAX_DRINK_ML + ' ml.';
    if (!isDate(p.date)) return 'Data inválida.';
    if (opts.today && p.date > opts.today) return 'Não é possível lançar em data futura.';
    if (p.time !== null && p.time !== undefined && p.time !== '' && !isTime(p.time)) return 'Horário inválido.';
    var hasS = !!p.start, hasE = !!p.end;
    if (hasS || hasE) {
      if (p.type !== 'chimarrao') return 'Sessão (início/fim) só existe para chimarrão.';
      if (!(isTime(p.start) && isTime(p.end))) return 'Informe início e fim da sessão.';
      if (p.start === p.end) return 'Início e fim da sessão são iguais.';
      var dur = (hm2min(p.end) - hm2min(p.start) + 1440) % 1440;
      if (dur > 16 * 60) return 'Sessão com mais de 16 horas — confira início e fim.';
    }
    return null;
  }

  function addDrink(state, p, opts) {
    var err = validateDrinkInput(p, opts);
    if (err) return { ok: false, error: err };
    var nowIso = (opts && opts.nowIso) || new Date().toISOString();
    var d = {
      id: uid('d'), type: p.type, ml: Math.round(+p.ml), date: p.date,
      time: (p.time === '' || p.time === undefined) ? null : p.time,
      createdAt: nowIso, updatedAt: nowIso
    };
    if (p.wake && p.type === 'water') d.wake = true;
    if (p.start && p.end) { d.start = p.start; d.end = p.end; d.time = p.end; }
    state.drinks.push(d);
    return { ok: true, item: d };
  }

  function updateDrink(state, id, p, opts) {
    var d = state.drinks.filter(function (x) { return x.id === id; })[0];
    if (!d) return { ok: false, error: 'Registro não encontrado.' };
    var merged = {
      type: p.type !== undefined ? p.type : d.type,
      ml: p.ml !== undefined ? p.ml : d.ml,
      date: p.date !== undefined ? p.date : d.date,
      time: p.time !== undefined ? p.time : d.time,
      start: p.start !== undefined ? p.start : d.start,
      end: p.end !== undefined ? p.end : d.end
    };
    if (merged.type !== 'chimarrao') { merged.start = ''; merged.end = ''; }
    var err = validateDrinkInput(merged, opts);
    if (err) return { ok: false, error: err };
    d.type = merged.type; d.ml = Math.round(+merged.ml); d.date = merged.date;
    d.time = (merged.time === '' || merged.time === undefined) ? null : merged.time;
    if (merged.start && merged.end) { d.start = merged.start; d.end = merged.end; d.time = merged.end; }
    else { delete d.start; delete d.end; }
    if (d.type !== 'water') delete d.wake;
    d.updatedAt = (opts && opts.nowIso) || new Date().toISOString();
    return { ok: true, item: d };
  }

  function deleteById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list.splice(i, 1)[0];
    return null;
  }

  function indexDrinks(state) {
    var by = {};
    state.drinks.forEach(function (d) { (by[d.date] = by[d.date] || []).push(d); });
    return { byDate: by };
  }
  function drinksAround(idx, date, before, after) {
    var out = [], n = dayNum(date);
    for (var i = -before; i <= after; i++) {
      var l = idx.byDate[numToDate(n + i)];
      if (l) out = out.concat(l);
    }
    return out;
  }

  /** Volume dentro de [ws, we] (minutos absolutos). min = certo; max = inclui sessões só parcialmente dentro. */
  function windowVolume(list, ws, we, group) {
    var min = 0, max = 0;
    list.forEach(function (d) {
      if (group && groupOf(d.type) !== group) return;
      var iv = drinkInterval(d);
      if (!iv || iv.e < ws || iv.s > we) return;
      if (iv.s >= ws && iv.e <= we) { min += d.ml; max += d.ml; } else { max += d.ml; }
    });
    return { min: min, max: max };
  }
  function windowByGroup(list, ws, we) {
    var out = { total: { min: 0, max: 0 } };
    GROUPS.forEach(function (g) {
      out[g] = windowVolume(list, ws, we, g);
      out.total.min += out[g].min; out.total.max += out[g].max;
    });
    return out;
  }

  /** Totais de um dia civil. Registros sem horário entram nos totais, mas não nas janelas. */
  function dayStats(idx, date) {
    var list = idx.byDate[date] || [];
    var s = { date: date, count: list.length, water: 0, coffee: 0, chimarrao: 0, other: 0, total: 0,
      unknownTime: 0, lastAbs: null, lastTime: null, lastChimaTime: null, lastCoffeeTime: null,
      hasData: list.length > 0 };
    var lastChima = null, lastCoffee = null;
    list.forEach(function (d) {
      s[groupOf(d.type)] += d.ml; s.total += d.ml;
      var iv = drinkInterval(d);
      if (!iv) { s.unknownTime++; return; }
      if (s.lastAbs === null || iv.e > s.lastAbs) s.lastAbs = iv.e;
      if (d.type === 'chimarrao' && (lastChima === null || iv.e > lastChima)) lastChima = iv.e;
      if (d.type === 'coffee' && (lastCoffee === null || iv.e > lastCoffee)) lastCoffee = iv.e;
    });
    if (s.lastAbs !== null) s.lastTime = min2hm(s.lastAbs);
    if (lastChima !== null) s.lastChimaTime = min2hm(lastChima);
    if (lastCoffee !== null) s.lastCoffeeTime = min2hm(lastCoffee);
    var base = dayNum(date) * 1440;
    s.evening = windowByGroup(list, base + 18 * 60, base + 1439);      // 18:00–23:59
    s.afternoon = windowByGroup(list, base + 12 * 60, base + 18 * 60 - 1); // 12:00–17:59
    return s;
  }

  /** Sequência de dias batendo a meta de ÁGUA (mesma regra do Gota v1). */
  function computeStreak(state, todayStr) {
    var goal = state.settings.goalMl;
    var tot = {};
    state.drinks.forEach(function (d) { if (d.type === 'water') tot[d.date] = (tot[d.date] || 0) + d.ml; });
    var met = {};
    Object.keys(tot).forEach(function (k) { met[k] = goal > 0 && tot[k] >= goal; });
    var cur = 0, n = dayNum(todayStr);
    while (met[numToDate(n)]) { cur++; n--; }
    var record = state.settings.recordStreak || 0;
    var prev = null, run = 0;
    Object.keys(met).filter(function (k) { return met[k]; }).sort().forEach(function (k) {
      var dn = dayNum(k);
      run = (prev !== null && dn - prev === 1) ? run + 1 : 1;
      prev = dn;
      if (run > record) record = run;
    });
    return { current: cur, record: record };
  }

  /* ------------------------------------------------------------------ */
  /* Sono                                                                */
  /* ------------------------------------------------------------------ */
  function nightGeometry(n) {
    if (!n || !isDate(n.date) || !isTime(n.sleep) || !isTime(n.wake)) return null;
    var sm = hm2min(n.sleep), wm = hm2min(n.wake);
    var dur = (wm - sm + 1440) % 1440;
    if (dur === 0) return null;
    // Dormir antes do meio-dia é tratado como "depois da meia-noite" da noite que começou em n.date.
    var startAbs = dayNum(n.date) * 1440 + sm + (sm < 720 ? 1440 : 0);
    return { startAbs: startAbs, wakeAbs: startAbs + dur, durMin: dur };
  }

  function awakeningGeometry(n, g, a) {
    if (!g || !a || !isTime(a.start) || !isTime(a.end)) return null;
    var sm = hm2min(a.start), em = hm2min(a.end);
    var dur = (em - sm + 1440) % 1440;
    if (dur === 0) return null;
    var s = dayNum(n.date) * 1440 + sm;
    while (s < g.startAbs) s += 1440;
    return { s: s, e: s + dur, dur: dur };
  }

  function validateNight(n) {
    var errors = [], warnings = [];
    if (!isDate(n.date)) { errors.push('Data da noite inválida.'); return { errors: errors, warnings: warnings }; }
    if (!isTime(n.sleep) || !isTime(n.wake)) { errors.push('Informe o horário em que dormiu e em que acordou.'); return { errors: errors, warnings: warnings }; }
    var g = nightGeometry(n);
    if (!g) { errors.push('Horário de dormir e de acordar são iguais.'); return { errors: errors, warnings: warnings }; }
    if (g.durMin > 16 * 60) warnings.push('Intervalo de sono com mais de 16 horas — confira os horários.');
    var geoms = [];
    (n.awakenings || []).forEach(function (a, i) {
      var label = 'Despertar ' + (i + 1);
      if (!isTime(a.start) || !isTime(a.end)) { errors.push(label + ': informe início e fim.'); return; }
      var ag = awakeningGeometry(n, g, a);
      if (!ag) { errors.push(label + ': início e fim são iguais.'); return; }
      if (ag.s < g.startAbs || ag.e > g.wakeAbs) { errors.push(label + ' (' + a.start + '–' + a.end + ') está fora do período de sono (' + n.sleep + '–' + n.wake + ').'); return; }
      geoms.push({ i: i, ag: ag, a: a });
    });
    geoms.sort(function (x, y) { return x.ag.s - y.ag.s; });
    for (var k = 1; k < geoms.length; k++) {
      if (geoms[k].ag.s < geoms[k - 1].ag.e) {
        errors.push('Despertares ' + (geoms[k - 1].i + 1) + ' e ' + (geoms[k].i + 1) + ' se sobrepõem.');
      }
    }
    var total = geoms.reduce(function (s, x) { return s + x.ag.dur; }, 0);
    if (total > g.durMin && !errors.length) errors.push('O tempo acordado é maior que o intervalo de sono.');
    if (n.aggregate && !(n.awakenings && n.awakenings.length)) {
      var c = n.aggregate.count, m = n.aggregate.minutes;
      if (c !== null && (!(c >= 0) || c !== Math.floor(c))) errors.push('Número de despertares inválido.');
      if (m !== null && !(m >= 0)) errors.push('Tempo acordado inválido.');
      if (m !== null && m > g.durMin) errors.push('O tempo acordado é maior que o intervalo de sono.');
      if (c === 0 && m !== null && m > 0) errors.push('Zero despertares com tempo acordado maior que zero.');
    }
    if (n.score !== null && n.score !== undefined && !(n.score >= 0 && n.score <= 10)) errors.push('Nota deve estar entre 0 e 10.');
    return { errors: errors, warnings: warnings };
  }

  /** Cria ou atualiza a noite (uma por data). Edição mantém o id => sem duplicar. */
  function upsertNight(state, p, opts) {
    var n = {
      date: p.date, sleep: p.sleep, wake: p.wake,
      awakenings: (p.awakenings || []).map(function (a) {
        return { id: a.id || uid('a'), start: a.start, end: a.end, bathroom: !!a.bathroom };
      }),
      aggregate: null, score: null, rating: null, notes: (p.notes || '').slice(0, 2000)
    };
    if (!n.awakenings.length && p.aggregate) {
      var c = (p.aggregate.count === '' || p.aggregate.count === null || p.aggregate.count === undefined) ? null : Math.round(+p.aggregate.count);
      var m = (p.aggregate.minutes === '' || p.aggregate.minutes === null || p.aggregate.minutes === undefined) ? null : Math.round(+p.aggregate.minutes);
      if (c !== null || m !== null) n.aggregate = { count: c, minutes: c === 0 ? 0 : m };
    }
    if (p.score !== null && p.score !== undefined && p.score !== '') n.score = +p.score;
    if (p.rating !== null && p.rating !== undefined && p.rating !== '') n.rating = Math.round(+p.rating);
    var v = validateNight(n);
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: v.warnings };
    var nowIso = (opts && opts.nowIso) || new Date().toISOString();
    var existing = state.nights.filter(function (x) { return x.date === n.date; })[0];
    var oldAw = existing ? existing.awakenings.map(function (a) { return a.id; }) : [];
    if (existing) { n.id = existing.id; n.createdAt = existing.createdAt; n.updatedAt = nowIso; Object.assign(existing, n); n = existing; }
    else { n.id = uid('n'); n.createdAt = nowIso; n.updatedAt = nowIso; state.nights.push(n); }
    // vínculos de banheiro que apontavam para despertares removidos são desfeitos
    var alive = {};
    n.awakenings.forEach(function (a) { alive[a.id] = true; });
    state.bathroom.forEach(function (b) { if (b.awakeningId && oldAw.indexOf(b.awakeningId) >= 0 && !alive[b.awakeningId]) b.awakeningId = null; });
    return { ok: true, item: n, warnings: v.warnings, created: !existing };
  }

  function deleteNight(state, id) {
    var n = deleteById(state.nights, id);
    if (!n) return null;
    var ids = n.awakenings.map(function (a) { return a.id; });
    state.bathroom.forEach(function (b) { if (b.awakeningId && ids.indexOf(b.awakeningId) >= 0) b.awakeningId = null; });
    return n;
  }

  function addBathroom(state, p, opts) {
    if (!isDate(p.date)) return { ok: false, error: 'Data inválida.' };
    if (!isTime(p.time)) return { ok: false, error: 'Horário inválido.' };
    if (opts && opts.today && p.date > opts.today) return { ok: false, error: 'Não é possível lançar em data futura.' };
    var nowIso = (opts && opts.nowIso) || new Date().toISOString();
    var b = { id: uid('b'), date: p.date, time: p.time, awakeningId: p.awakeningId || null, createdAt: nowIso, updatedAt: nowIso };
    state.bathroom.push(b);
    return { ok: true, item: b };
  }

  function updateBathroom(state, id, p, opts) {
    var b = state.bathroom.filter(function (x) { return x.id === id; })[0];
    if (!b) return { ok: false, error: 'Registro não encontrado.' };
    var date = p.date !== undefined ? p.date : b.date, time = p.time !== undefined ? p.time : b.time;
    if (!isDate(date)) return { ok: false, error: 'Data inválida.' };
    if (!isTime(time)) return { ok: false, error: 'Horário inválido.' };
    if (opts && opts.today && date > opts.today) return { ok: false, error: 'Não é possível lançar em data futura.' };
    b.date = date; b.time = time;
    if (p.awakeningId !== undefined) { b.awakeningId = p.awakeningId || null; if (b.awakeningId) delete b.noLink; }
    if (p.noLink !== undefined) { if (p.noLink) b.noLink = true; else delete b.noLink; }
    b.updatedAt = (opts && opts.nowIso) || new Date().toISOString();
    return { ok: true, item: b };
  }

  function bathAbs(b) { return toAbs(b.date, b.time); }

  /** Idas ao banheiro dentro do intervalo de sono da noite (ordenadas). */
  function bathroomInNight(state, n) {
    var g = nightGeometry(n);
    if (!g) return [];
    return state.bathroom.filter(function (b) { var a = bathAbs(b); return a >= g.startAbs && a <= g.wakeAbs; })
      .sort(function (x, y) { return bathAbs(x) - bathAbs(y); });
  }
  /** Idas do banheiro de uma "noite" sem registro de sono (agrupadas pela regra do meio-dia). */
  function bathroomByKey(state, key) {
    return state.bathroom.filter(function (b) { return nightKeyOf(b.date, b.time) === key; })
      .sort(function (x, y) { return bathAbs(x) - bathAbs(y); });
  }

  /** Para cada ida sem vínculo, sugere o despertar mais próximo (mapa idDaIda -> idDoDespertar). */
  function suggestLinks(n, recs) {
    var g = nightGeometry(n), out = {};
    if (!g) return out;
    var geoms = (n.awakenings || []).map(function (a) { return { a: a, ag: awakeningGeometry(n, g, a) }; }).filter(function (x) { return x.ag; });
    recs.forEach(function (b) {
      if (b.awakeningId || b.noLink) return;
      var t = bathAbs(b), best = null, bestD = Infinity;
      geoms.forEach(function (x) {
        var d = t < x.ag.s ? x.ag.s - t : (t > x.ag.e ? t - x.ag.e : 0);
        if (d <= BATH_TOLERANCE && d < bestD) { best = x.a.id; bestD = d; }
      });
      if (best) out[b.id] = best;
    });
    return out;
  }

  function awakeningStats(n) {
    var g = nightGeometry(n);
    if (n.awakenings && n.awakenings.length) {
      var minutes = 0;
      n.awakenings.forEach(function (a) { var ag = awakeningGeometry(n, g, a); if (ag) minutes += ag.dur; });
      return { mode: 'detail', count: n.awakenings.length, minutes: minutes };
    }
    if (n.aggregate && (n.aggregate.count !== null || n.aggregate.minutes !== null)) {
      return { mode: n.aggregate.count === 0 ? 'none' : 'total', count: n.aggregate.count, minutes: n.aggregate.minutes };
    }
    return { mode: 'unknown', count: null, minutes: null };
  }

  function lastBefore(list, limitAbs, group) {
    var best = null;
    list.forEach(function (d) {
      if (group && groupOf(d.type) !== group) return;
      var iv = drinkInterval(d);
      if (!iv || iv.s > limitAbs || iv.s < limitAbs - 1440) return;
      var a = Math.min(iv.e, limitAbs);
      if (best === null || a > best.abs) best = { abs: a, time: min2hm(a), gapMin: limitAbs - a, type: d.type };
    });
    return best;
  }

  /** Todos os indicadores de uma noite. null em um campo = "Sem dados". */
  function computeNight(state, idx, n) {
    var g = nightGeometry(n);
    if (!g) return null;
    var D = n.date, dn = dayNum(D) * 1440;
    var around = drinksAround(idx, D, 1, 1);
    var hasDrinks = around.some(function (d) { var iv = drinkInterval(d); return iv && iv.s >= dn && iv.s <= g.startAbs; });
    var aw = awakeningStats(n);
    var recs = bathroomInNight(state, n);
    // Vínculo efetivo = confirmado pelo usuário, ou sugerido (provisório) enquanto não for recusado.
    // Assim a ida registrada pelo botão e o despertar marcado como "banheiro" não contam duas vezes.
    var linked = {}, sug = suggestLinks(n, recs);
    recs.forEach(function (b) { var l = b.awakeningId || sug[b.id]; if (l) linked[l] = true; });
    var unlinkedFlagged = n.awakenings.filter(function (a) { return a.bathroom && !linked[a.id]; }).length;
    var awWithBath = n.awakenings.filter(function (a) { return a.bathroom || linked[a.id]; }).length;
    var m = {
      night: n, id: n.id, date: D, sleepAbs: g.startAbs, wakeAbs: g.wakeAbs, inBedMin: g.durMin,
      awakeningMode: aw.mode, awakeningCount: aw.count, awakeMin: aw.minutes,
      asleepMin: aw.minutes !== null ? Math.max(0, g.durMin - aw.minutes) : null,
      trips: recs.length + unlinkedFlagged,
      tripTimes: recs.map(function (b) { return b.time; }),
      tripsRecorded: recs.length,
      awakeningsWithBathroom: awWithBath,
      score: n.score, rating: n.rating,
      hasDrinks: hasDrinks, pre: null, evening: null, after16: null, tarde: null,
      lastIntake: null, lastCoffee: null, lastChima: null, lastCaff: null,
      day: dayStats(idx, D)
    };
    if (hasDrinks) {
      m.pre = {};
      [2, 3, 4].forEach(function (h) { m.pre[h] = windowByGroup(around, g.startAbs - h * 60, g.startAbs); });
      m.evening = windowByGroup(around, dn + 18 * 60, g.startAbs);
      m.after16 = windowByGroup(around, dn + 16 * 60, g.startAbs);
      m.tarde = windowByGroup(around, dn + 12 * 60, Math.min(dn + 18 * 60 - 1, g.startAbs));
      m.lastIntake = lastBefore(around, g.startAbs, null);
      m.lastCoffee = lastBefore(around, g.startAbs, 'coffee');
      m.lastChima = lastBefore(around, g.startAbs, 'chimarrao');
      if (m.lastCoffee && m.lastChima) m.lastCaff = m.lastCoffee.abs >= m.lastChima.abs ? m.lastCoffee : m.lastChima;
      else m.lastCaff = m.lastCoffee || m.lastChima;
    }
    return m;
  }

  function computeAllNights(state) {
    var idx = indexDrinks(state);
    return state.nights.map(function (n) { return computeNight(state, idx, n); })
      .filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  /* ------------------------------------------------------------------ */
  /* Análises                                                            */
  /* ------------------------------------------------------------------ */
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  function clockHours(m, abs) { return abs === null || abs === undefined ? null : (abs - dayNum(m.date) * 1440) / 60; }
  function volMin(w) { return w ? w.min : null; }
  function unc(w) { return !!w && w.max > w.min; }

  var CHARTS = [
    { id: 'liq3-bath', short: 'Líquidos 3h antes × banheiro', title: 'Líquidos antes de dormir × idas ao banheiro',
      xl: 'ml nas 3 h antes de dormir', yl: 'idas ao banheiro', xk: 'ml', yk: 'int',
      x: function (m) { return m.pre ? m.pre[3].total.min : null; },
      y: function (m) { return m.trips; }, u: function (m) { return m.pre && unc(m.pre[3].total); } },
    { id: 'liq3-wake', short: 'Líquidos 3h antes × despertares', title: 'Líquidos antes de dormir × despertares',
      xl: 'ml nas 3 h antes de dormir', yl: 'despertares', xk: 'ml', yk: 'int',
      x: function (m) { return m.pre ? m.pre[3].total.min : null; },
      y: function (m) { return m.awakeningCount; }, u: function (m) { return m.pre && unc(m.pre[3].total); } },
    { id: 'last-score', short: 'Última ingestão × nota', title: 'Horário da última ingestão × qualidade do sono',
      xl: 'hora da última ingestão', yl: 'nota (0–10)', xk: 'clock', yk: 'num',
      x: function (m) { return m.lastIntake ? clockHours(m, m.lastIntake.abs) : null; },
      y: function (m) { return m.score; } },
    { id: 'coffee-score', short: 'Café no dia × nota', title: 'Café no dia × qualidade do sono',
      xl: 'ml de café no dia', yl: 'nota (0–10)', xk: 'ml', yk: 'num',
      x: function (m) { return m.day.hasData ? m.day.coffee : null; },
      y: function (m) { return m.score; } },
    { id: 'chima-score', short: 'Chimarrão no dia × nota', title: 'Chimarrão no dia × qualidade do sono',
      xl: 'ml de chimarrão no dia', yl: 'nota (0–10)', xk: 'ml', yk: 'num',
      x: function (m) { return m.day.hasData ? m.day.chimarrao : null; },
      y: function (m) { return m.score; } },
    { id: 'caff-score', short: 'Último café/chimarrão × nota', title: 'Último café/chimarrão × qualidade do sono',
      xl: 'hora do último café ou chimarrão', yl: 'nota (0–10)', xk: 'clock', yk: 'num',
      x: function (m) { return m.lastCaff ? clockHours(m, m.lastCaff.abs) : null; },
      y: function (m) { return m.score; } },
    { id: 'awake-bath', short: 'Tempo acordado × banheiro', title: 'Tempo acordado × idas ao banheiro',
      xl: 'minutos acordado', yl: 'idas ao banheiro', xk: 'min', yk: 'int',
      x: function (m) { return m.awakeMin; }, y: function (m) { return m.trips; } },
    { id: 'evening-bath', short: 'Líquidos da noite × banheiro', title: 'Líquidos no período noturno × idas ao banheiro',
      xl: 'ml entre 18h e a hora de dormir', yl: 'idas ao banheiro', xk: 'ml', yk: 'int',
      x: function (m) { return m.evening ? m.evening.total.min : null; },
      y: function (m) { return m.trips; }, u: function (m) { return m.evening && unc(m.evening.total); } }
  ];

  /** Pontos de um gráfico: só noites com x e y preenchidos (ausência ≠ zero). */
  function chartPoints(ms, id) {
    var def = CHARTS.filter(function (c) { return c.id === id; })[0];
    if (!def) return null;
    var pts = [];
    ms.forEach(function (m) {
      var x = def.x(m), y = def.y(m);
      if (x === null || x === undefined || y === null || y === undefined) return;
      pts.push({ x: x, y: y, date: m.date, id: m.id, uncertain: !!(def.u && def.u(m)) });
    });
    return { def: def, points: pts, n: pts.length, total: ms.length };
  }

  var OUTCOMES = [
    { id: 'trips', label: 'idas ao banheiro', unit: '', dec: 1, get: function (m) { return m.trips; } },
    { id: 'awk', label: 'despertares', unit: '', dec: 1, get: function (m) { return m.awakeningCount; } },
    { id: 'awake', label: 'tempo acordado', unit: ' min', dec: 0, get: function (m) { return m.awakeMin; } },
    { id: 'score', label: 'nota do sono', unit: '', dec: 1, get: function (m) { return m.score; } }
  ];

  function sideByThreshold(w, thr) {
    if (!w) return null;
    if (w.max < thr) return 'A';
    if (w.min >= thr) return 'B';
    return null; // sessão de chimarrão parcialmente na janela: não dá para classificar com segurança
  }
  function sideByFlag(w) {
    if (!w) return null;
    if (w.min > 0) return 'A';
    if (w.max === 0) return 'B';
    return null;
  }

  function buildExposures(ms) {
    var list = [];
    var l3 = ms.filter(function (m) { return m.pre; }).map(function (m) { return m.pre[3].total.min; });
    if (l3.length) {
      var thr = median(l3);
      list.push({ id: 'liq3', thr: thr,
        labelA: 'com menos de ' + Math.round(thr) + ' ml nas 3 h antes de dormir',
        labelB: 'com ' + Math.round(thr) + ' ml ou mais nas 3 h antes de dormir',
        side: function (m) { return m.pre ? sideByThreshold(m.pre[3].total, thr) : null; } });
    }
    var gaps = ms.filter(function (m) { return m.lastIntake; }).map(function (m) { return m.lastIntake.gapMin; });
    if (gaps.length) {
      var gthr = median(gaps);
      list.push({ id: 'gap', thr: gthr,
        labelA: 'em que a última ingestão foi há menos de ' + fmtHM(gthr) + ' de dormir',
        labelB: 'em que a última ingestão foi há ' + fmtHM(gthr) + ' ou mais de dormir',
        side: function (m) { return m.lastIntake ? (m.lastIntake.gapMin < gthr ? 'A' : 'B') : null; } });
    }
    list.push({ id: 'coffee16', labelA: 'com café registrado após as 16h', labelB: 'sem café registrado após as 16h',
      side: function (m) { return m.after16 && m.day.hasData ? sideByFlag(m.after16.coffee) : null; } });
    list.push({ id: 'chima16', labelA: 'com chimarrão registrado após as 16h', labelB: 'sem chimarrão registrado após as 16h',
      side: function (m) { return m.after16 && m.day.hasData ? sideByFlag(m.after16.chimarrao) : null; } });
    return list;
  }

  function fmtHM(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), mi = min % 60;
    return h ? h + 'h' + (mi ? pad2(mi) : '') : mi + ' min';
  }
  function fmtNum(v, dec) { return v.toFixed(dec).replace('.', ','); }

  /** Observações do tipo "nas noites com X, a média de Y foi ...". Só quando há dados suficientes. */
  function buildInsights(ms) {
    var out = [];
    buildExposures(ms).forEach(function (ex) {
      OUTCOMES.forEach(function (oc) {
        var A = [], B = [];
        ms.forEach(function (m) {
          var s = ex.side(m), v = oc.get(m);
          if (!s || v === null || v === undefined) return;
          (s === 'A' ? A : B).push(v);
        });
        if (A.length < MIN_GROUP || B.length < MIN_GROUP || A.length + B.length < MIN_TOTAL) return;
        var mA = mean(A), mB = mean(B), diff = mA - mB;
        var scale = Math.max(Math.abs(mA), Math.abs(mB), oc.id === 'score' ? 1 : 0.5);
        var rel = Math.abs(diff) / scale;
        var same = rel < 0.1;
        var d = oc.dec;
        var text = 'Nas noites ' + ex.labelA + ' (n=' + A.length + '), a média de ' + oc.label + ' foi ' + fmtNum(mA, d) + oc.unit +
          ', contra ' + fmtNum(mB, d) + oc.unit + ' nas noites ' + ex.labelB + ' (n=' + B.length + ')' +
          (same ? ' — médias parecidas.' : ' — diferença de ' + fmtNum(Math.abs(diff), d) + oc.unit + (diff > 0 ? ' a mais' : ' a menos') + ' no primeiro grupo.');
        out.push({ exposure: ex.id, outcome: oc.id, nA: A.length, nB: B.length, meanA: mA, meanB: mB, diff: diff, rel: rel, same: same, text: text });
      });
    });
    out.sort(function (a, b) { return b.rel - a.rel; });
    return out;
  }

  /** Média diária de café/chimarrão nos dias com algum registro de bebida. */
  function dailyCaffeineSummary(state, fromDate, toDate) {
    var idx = indexDrinks(state), days = [];
    Object.keys(idx.byDate).sort().forEach(function (k) {
      if (fromDate && k < fromDate) return;
      if (toDate && k > toDate) return;
      days.push(dayStats(idx, k));
    });
    return {
      days: days,
      avgCoffee: days.length ? mean(days.map(function (d) { return d.coffee; })) : null,
      avgChima: days.length ? mean(days.map(function (d) { return d.chimarrao; })) : null,
      n: days.length
    };
  }

  return {
    SCHEMA: SCHEMA, TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, GROUPS: GROUPS, RATINGS: RATINGS, CHARTS: CHARTS, OUTCOMES: OUTCOMES,
    MIN_GROUP: MIN_GROUP, MIN_TOTAL: MIN_TOTAL, MAX_DRINK_ML: MAX_DRINK_ML,
    pad2: pad2, dayNum: dayNum, numToDate: numToDate, isDate: isDate, isTime: isTime, addDays: addDays,
    hm2min: hm2min, min2hm: min2hm, toAbs: toAbs, fromAbs: fromAbs, localDateKey: localDateKey, localTime: localTime,
    nowAbs: nowAbs, nightKeyOf: nightKeyOf, uid: uid, fmtHM: fmtHM, cleanQuick: cleanQuick,
    createEmptyState: createEmptyState, ensureShape: ensureShape, defaultSettings: defaultSettings,
    isV1: isV1, migrateV1: migrateV1, normalizeState: normalizeState, mergeStates: mergeStates,
    groupOf: groupOf, drinkInterval: drinkInterval, validateDrinkInput: validateDrinkInput,
    addDrink: addDrink, updateDrink: updateDrink, deleteById: deleteById,
    indexDrinks: indexDrinks, drinksAround: drinksAround, windowVolume: windowVolume, windowByGroup: windowByGroup,
    dayStats: dayStats, computeStreak: computeStreak,
    nightGeometry: nightGeometry, awakeningGeometry: awakeningGeometry, validateNight: validateNight,
    upsertNight: upsertNight, deleteNight: deleteNight, addBathroom: addBathroom, updateBathroom: updateBathroom,
    bathroomInNight: bathroomInNight, bathroomByKey: bathroomByKey, suggestLinks: suggestLinks,
    awakeningStats: awakeningStats, computeNight: computeNight, computeAllNights: computeAllNights,
    chartPoints: chartPoints, buildInsights: buildInsights, dailyCaffeineSummary: dailyCaffeineSummary,
    mean: mean, median: median
  };
});
