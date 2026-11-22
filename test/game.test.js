import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/game.js';
import { clueConflicts, normalizeArabic } from '../server/arabic.js';
import { DEFAULT_WORDS } from '../server/words.js';

const fresh = (start = 'red') => G.newGame(DEFAULT_WORDS, { startingTeam: start });
const idx = (g, color) => g.cards.findIndex((c) => c.color === color && !c.revealed);
const count = (g, color) => g.cards.filter((c) => c.color === color).length;

test('قائمة الكلمات كافية وبدون تكرار بعد التوحيد', () => {
  assert.ok(DEFAULT_WORDS.length >= 400);
  const norm = new Set(DEFAULT_WORDS.map(normalizeArabic));
  assert.ok(norm.size >= 400);
});

test('توزيع اللوحة 9/8/7/1 و25 كلمة مختلفة', () => {
  for (let i = 0; i < 50; i++) {
    const g = G.newGame(DEFAULT_WORDS);
    assert.equal(g.cards.length, 25);
    assert.equal(new Set(g.cards.map((c) => c.word)).size, 25);
    for (const a of g.cards) for (const b of g.cards) if (a !== b) assert.ok(!clueConflicts(a.word, b.word), `${a.word} / ${b.word}`);
    const s = g.startingTeam;
    assert.equal(count(g, s), 9);
    assert.equal(count(g, G.other(s)), 8);
    assert.equal(count(g, 'neutral'), 7);
    assert.equal(count(g, 'assassin'), 1);
    assert.equal(g.turn, s);
  }
});

test('ما يقدر يخمّن قبل التلميح، ولا الفريق الثاني يعطي تلميح', () => {
  const g = fresh();
  assert.ok(G.reveal(g, 'red', 0).error);
  assert.ok(G.giveClue(g, 'blue', 'كلمة', 1).error);
});

test('رفض التلميح المطابق لكلمة في اللوحة أو المتعدد الكلمات', () => {
  const g = fresh();
  const w = g.cards[3].word;
  assert.ok(G.giveClue(g, 'red', w, 1).error);
  assert.ok(G.giveClue(g, 'red', 'ال' + w.replace(/^ال/, ''), 1).error);
  assert.ok(G.giveClue(g, 'red', 'كلمتين هنا', 1).error);
  assert.ok(G.giveClue(g, 'red', 'زززز', 12).error);
});

test('توحيد عربي', () => {
  assert.ok(clueConflicts('البَحْر', 'بحر'));
  assert.ok(clueConflicts('أسد', 'اسد'));
  assert.ok(clueConflicts('مدرسه', 'مدرسة'));
  assert.ok(!clueConflicts('سمك', 'بحر'));
});

test('حد التخمين = الرقم + 1 ثم ينتقل الدور', () => {
  const g = fresh('red');
  assert.ok(G.giveClue(g, 'red', 'زززز', 1).ok);
  assert.equal(g.guessesLeft, 2);
  G.reveal(g, 'red', idx(g, 'red'));
  assert.equal(g.turn, 'red');
  G.reveal(g, 'red', idx(g, 'red'));
  assert.equal(g.turn, 'blue');
  assert.equal(g.phase, 'clue');
});

test('المحايدة تنهي الدور، وبطاقة الخصم تنحسب له', () => {
  const g = fresh('red');
  G.giveClue(g, 'red', 'زززز', 3);
  G.reveal(g, 'red', idx(g, 'neutral'));
  assert.equal(g.turn, 'blue');
  G.giveClue(g, 'blue', 'زززز', 3);
  const before = G.remaining(g, 'red');
  G.reveal(g, 'blue', idx(g, 'red'));
  assert.equal(G.remaining(g, 'red'), before - 1);
  assert.equal(g.turn, 'red');
});

test('القاتل = خسارة فورية', () => {
  const g = fresh('red');
  G.giveClue(g, 'red', 'زززز', 2);
  G.reveal(g, 'red', idx(g, 'assassin'));
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'blue');
  assert.equal(g.winReason, 'assassin');
});

test('الفوز لما تنكشف كل بطاقات الفريق حتى لو كشفها الخصم', () => {
  const g = fresh('red');
  // نكشف 7 بطاقات زرقاء من 8 بدور الأزرق
  G.giveClue(g, 'red', 'زززز', 1);
  G.reveal(g, 'red', idx(g, 'neutral'));
  G.giveClue(g, 'blue', 'زززز', 0); // بدون حد
  for (let i = 0; i < 7; i++) G.reveal(g, 'blue', idx(g, 'blue'));
  G.passTurn(g, 'blue');
  assert.equal(g.turn, 'red');
  G.giveClue(g, 'red', 'زززز', 2);
  G.reveal(g, 'red', idx(g, 'blue')); // الأحمر كشف آخر بطاقة زرقاء بالغلط
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'blue');
});

test('إنهاء التخمين يحتاج تخمين واحد على الأقل', () => {
  const g = fresh('red');
  G.giveClue(g, 'red', 'زززز', 2);
  assert.ok(G.passTurn(g, 'red').error);
  G.reveal(g, 'red', idx(g, 'red'));
  assert.ok(G.passTurn(g, 'red').ok);
  assert.equal(g.turn, 'blue');
});

test('العميل ما يستلم ألوان البطاقات غير المكشوفة', () => {
  const g = fresh('red');
  const op = G.viewFor(g, { isSpymaster: false });
  assert.ok(op.cards.every((c) => c.color === null));
  const spy = G.viewFor(g, { isSpymaster: true });
  assert.ok(spy.cards.every((c) => c.color));
  G.giveClue(g, 'red', 'زززز', 1);
  const i = idx(g, 'red');
  G.reveal(g, 'red', i);
  const op2 = G.viewFor(g, { isSpymaster: false });
  assert.equal(op2.cards[i].color, 'red');
  assert.equal(op2.cards.filter((c) => c.color).length, 1);
  assert.ok(!JSON.stringify(op2).includes('assassin') || g.log.some((l) => l.color === 'assassin'));
});
