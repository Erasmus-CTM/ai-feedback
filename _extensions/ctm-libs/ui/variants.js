/* Shared student variant selection. Components own rendering, answers and P17. */
(function (root) {
  'use strict';
  if (root.CTMVariants) return;
  function identity(variant) { return {n: variant.n, id: variant.id, hash: variant.hash}; }
  function choiceKey(variant) { return variant.proposal === true ? 'proposal:' + variant.id : variant.n; }
  function score(text) {
    // FNV-1a over UTF-8, then SplitMix64's final avalanche. Raw FNV scores
    // correlate for short numbered suffixes and bias rendezvous selection.
    // Selection is deterministic, not a security boundary.
    var value = 14695981039346656037n;
    for (var byte of new TextEncoder().encode(text)) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 1099511628211n);
    value = BigInt.asUintN(64, (value ^ (value >> 30n)) * 13787848793156543929n);
    value = BigInt.asUintN(64, (value ^ (value >> 27n)) * 10723151780598845931n);
    return value ^ (value >> 31n);
  }
  function create(options) {
    options = options || {};
    var variants = (options.variants || []).slice(), numbers = new Set();
    if (!options.label || !variants.length) throw new TypeError('Variant selection needs a label and deployed variants.');
    variants.forEach(function (variant) {
      var proposal = options.allowProposals === true && variant.proposal === true && variant.n == null;
      var key = choiceKey(variant);
      if ((!proposal && (!Number.isSafeInteger(variant.n) || variant.n < 1 || variant.proposal === true)) || numbers.has(key) ||
          typeof variant.id !== 'string' || !variant.id || typeof variant.hash !== 'string' || !variant.hash) {
        throw new TypeError('Deployed variants need unique positive numbers and nonempty ids and hashes.');
      }
      numbers.add(key);
    });
    var store = root.CTMStore;
    var seed = options.seed !== undefined ? String(options.seed) : store && store.seed();
    if (!seed) throw new Error('Variant selection needs the shared learner seed.');
    var page = options.page !== undefined ? String(options.page) : store && store.page;
    if (page === undefined) throw new Error('Variant selection needs the shared page identity.');
    var ranked = variants.map(function (variant) {
      // B2: a variable rename can change id, but never the student's ranking.
      return {variant: variant, score: score(JSON.stringify([seed, page, options.label, choiceKey(variant)]))};
    }).sort(function (a, b) { return a.score === b.score ? String(choiceKey(a.variant)).localeCompare(String(choiceKey(b.variant))) : a.score > b.score ? -1 : 1; })
      .map(function (item) { return item.variant; });
    var selected, seen = [], outcome;
    function mergeSeen(values) {
      [].concat(values || []).forEach(function (n) { if (numbers.has(n) && !seen.includes(n)) seen.push(n); });
    }
    function remember(variant) { selected = variant; mergeSeen([choiceKey(variant)]); return variant; }
    function restore(record) {
      if (!record || !(record.variant || record.proposal)) return {state: 'empty', record: record || null, variant: null};
      var old = record.variant || record.proposal;
      var sameHash = variants.filter(function (variant) { return old.hash && variant.hash === old.hash; });
      var match = sameHash.find(function (variant) { return Number.isSafeInteger(old.n) && variant.n === old.n; }) ||
        sameHash.find(function (variant) { return variant.id === old.id; }) ||
        (sameHash.length === 1 ? sameHash[0] : null);
      var state = match ? 'restored' : 'withdrawn';
      if (!match) {
        match = variants.find(function (variant) { return Number.isSafeInteger(old.n) && variant.n === old.n; }) ||
          variants.find(function (variant) { return variant.id === old.id; });
        if (match) state = 'changed';
      }
      mergeSeen(record.seen);
      if (match) remember(match);
      return {state: state, record: record, variant: match || null};
    }
    mergeSeen(options.seen);
    outcome = restore(options.saved);
    if (!selected) {
      var query = options.query !== undefined ? options.query : root.location && root.location.search;
      var links = new URLSearchParams(query || '').getAll('variant');
      var linked;
      links.some(function (value) {
        var split = value.lastIndexOf(':');
        if (split < 0 || value.slice(0, split) !== options.label || !/^[1-9]\d*$/.test(value.slice(split + 1))) return false;
        var n = Number(value.slice(split + 1));
        linked = variants.find(function (variant) { return variant.n === n; });
        return !!linked;
      });
      remember(linked || ranked[0]);
    }
    return {
      current: function () { return selected; },
      seen: function () { return seen.slice(); },
      state: function () {
        return selected.proposal === true ? {variant: null, proposal: {id: selected.id, hash: selected.hash}, seen: seen.slice()}
          : {variant: identity(selected), seen: seen.slice()};
      },
      restored: function () { return outcome; },
      restore: function (record) { outcome = restore(record); return outcome; },
      next: function () {
        var next = ranked.find(function (variant) { return !seen.includes(choiceKey(variant)); });
        if (!next) {
          seen = [];
          next = ranked.find(function (variant) { return choiceKey(variant) !== choiceKey(selected); }) || selected;
        }
        return remember(next);
      }
    };
  }
  root.CTMVariants = {version: 1, rankingVersion: 2, create: create};
})(globalThis);
