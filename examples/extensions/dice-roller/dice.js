// Dice notation for the example extension. Terms joined by + or -:
//   NdS        N dice of S sides (N defaults to 1; S can be % for 100)
//   NdSkhK     keep the highest K      NdSklK  keep the lowest K
//   NdS!       exploding: a maximum roll adds another die (at most 20 extra)
//   C          a constant
window.rollDice = function rollDice(notation, random) {
  random = random || Math.random;
  var text = String(notation || '').replace(/\s+/g, '').toLowerCase();
  if (!text || text.length > 100) throw new Error('Write dice like 2d6+1');
  var terms = text.match(/[+-]?[^+-]+/g) || [];
  var total = 0;
  var parts = [];
  terms.forEach(function (raw) {
    var sign = raw[0] === '-' ? -1 : 1;
    var t = raw.replace(/^[+-]/, '');
    var m = /^(\d*)d(\d+|%)(?:(kh|kl)(\d+))?(!)?$/.exec(t);
    if (!m) {
      if (!/^\d+$/.test(t)) throw new Error('Can\'t read "' + t + '"');
      total += sign * Number(t);
      parts.push((sign < 0 ? '-' : '') + t);
      return;
    }
    var n = Math.min(100, Number(m[1] || 1));
    var sides = m[2] === '%' ? 100 : Number(m[2]);
    if (sides < 2 || sides > 1000) throw new Error('Dice need 2 to 1000 sides');
    var rolls = [];
    var extra = 0;
    for (var i = 0; i < n; i++) {
      var r = 1 + Math.floor(random() * sides);
      rolls.push(r);
      while (m[5] && r === sides && extra < 20) {
        r = 1 + Math.floor(random() * sides);
        rolls.push(r);
        extra++;
      }
    }
    var kept = rolls.slice();
    if (m[3]) {
      var k = Math.max(0, Math.min(rolls.length, Number(m[4])));
      kept = rolls.slice().sort(function (a, b) { return m[3] === 'kh' ? b - a : a - b; }).slice(0, k);
    }
    var sum = kept.reduce(function (a, b) { return a + b; }, 0);
    total += sign * sum;
    parts.push((sign < 0 ? '-' : '') + '[' + rolls.join(', ') + (m[3] ? ' → ' + kept.join(', ') : '') + ']');
  });
  return { total: total, detail: parts.join(' + ').replace(/\+ -/g, '- ') };
};
