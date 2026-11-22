// محرك قواعد اللعبة — دوال نقية بدون أي اتصال أو تخزين
import { clueConflicts, normalizeArabic } from './arabic.js';

export const TEAMS = ['red', 'blue'];
export const BOARD_SIZE = 25;
export const other = (t) => (t === 'red' ? 'blue' : 'red');

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(wordPool, { rng = Math.random, startingTeam } = {}) {
  const unique = [...new Map(wordPool.map((w) => [normalizeArabic(w), w.trim()])).values()].filter(Boolean);
  if (unique.length < BOARD_SIZE) throw new Error('عدد الكلمات أقل من 25');
  // اختيار 25 كلمة ما تتشابه مع بعض (مثل: فأر/فأرة) عشان ما تتعارض مع التلميحات
  const words = [];
  for (const w of shuffle(unique, rng)) {
    if (!words.some((x) => clueConflicts(w, x))) words.push(w);
    if (words.length === BOARD_SIZE) break;
  }
  if (words.length < BOARD_SIZE) throw new Error('عدد الكلمات المختلفة أقل من 25');
  const start = startingTeam || (rng() < 0.5 ? 'red' : 'blue');
  const colors = shuffle([
    ...Array(9).fill(start),
    ...Array(8).fill(other(start)),
    ...Array(7).fill('neutral'),
    'assassin',
  ], rng);
  return {
    cards: words.map((word, i) => ({ word, color: colors[i], revealed: false, suggestedBy: [] })),
    startingTeam: start,
    turn: start,
    phase: 'clue',          // clue | guess | over
    clue: null,             // { word, number, team }
    guessesLeft: 0,
    guessesMade: 0,
    winner: null,
    winReason: null,
    log: [],
    turnStartedAt: Date.now(),
  };
}

export function remaining(game, team) {
  return game.cards.filter((c) => c.color === team && !c.revealed).length;
}

function endTurn(game) {
  game.turn = other(game.turn);
  game.phase = 'clue';
  game.clue = null;
  game.guessesLeft = 0;
  game.guessesMade = 0;
  game.cards.forEach((c) => (c.suggestedBy = []));
  game.turnStartedAt = Date.now();
}

function finish(game, winner, reason) {
  game.phase = 'over';
  game.winner = winner;
  game.winReason = reason;
  game.cards.forEach((c) => (c.suggestedBy = []));
}

// number: 0..9 أو 'inf'
export function giveClue(game, team, word, number) {
  if (game.phase !== 'clue') return { error: 'مو وقت التلميح الحين' };
  if (team !== game.turn) return { error: 'مو دور فريقك' };
  const clue = String(word ?? '').trim().replace(/\s+/g, ' ');
  if (!clue) return { error: 'اكتب التلميح' };
  if (clue.includes(' ')) return { error: 'التلميح لازم يكون كلمة وحدة' };
  if (clue.length > 30) return { error: 'التلميح طويل' };
  const n = number === 'inf' ? 'inf' : Number(number);
  if (n !== 'inf' && !(Number.isInteger(n) && n >= 0 && n <= 9)) return { error: 'الرقم لازم يكون من 0 إلى 9 أو ∞' };
  const hit = game.cards.find((c) => !c.revealed && clueConflicts(clue, c.word));
  if (hit) return { error: `التلميح قريب جداً من كلمة في اللوحة (${hit.word})` };
  game.clue = { word: clue, number: n, team };
  game.phase = 'guess';
  // الرقم + 1، والصفر أو ∞ = بدون حد
  game.guessesLeft = n === 'inf' || n === 0 ? Infinity : n + 1;
  game.guessesMade = 0;
  return { ok: true };
}

export function suggest(game, team, index, playerName) {
  if (game.phase !== 'guess' || team !== game.turn) return { error: 'مو دور فريقك' };
  const card = game.cards[index];
  if (!card || card.revealed) return { error: 'بطاقة غير صالحة' };
  const i = card.suggestedBy.indexOf(playerName);
  if (i >= 0) card.suggestedBy.splice(i, 1);
  else card.suggestedBy.push(playerName);
  return { ok: true };
}

export function reveal(game, team, index, playerName = '') {
  if (game.phase !== 'guess') return { error: 'لازم ينتظر التلميح أول' };
  if (team !== game.turn) return { error: 'مو دور فريقك' };
  const card = game.cards[index];
  if (!card || card.revealed) return { error: 'بطاقة غير صالحة' };
  card.revealed = true;
  card.suggestedBy = [];
  card.revealedBy = team;
  game.guessesMade++;
  game.log.push({ type: 'guess', team, player: playerName, word: card.word, color: card.color });

  if (card.color === 'assassin') {
    finish(game, other(team), 'assassin');
    return { ok: true, result: 'assassin' };
  }
  // الفوز بانكشاف كل بطاقات فريق (حتى لو كشفها الخصم)
  for (const t of TEAMS) {
    if (remaining(game, t) === 0) {
      finish(game, t, 'allFound');
      return { ok: true, result: card.color };
    }
  }
  if (card.color !== team) {
    endTurn(game);
    return { ok: true, result: card.color };
  }
  game.guessesLeft--;
  if (game.guessesLeft <= 0) endTurn(game);
  return { ok: true, result: card.color };
}

export function passTurn(game, team, playerName = '') {
  if (game.phase !== 'guess' || team !== game.turn) return { error: 'مو دور فريقك' };
  if (game.guessesMade < 1) return { error: 'لازم تخمّنون بطاقة وحدة على الأقل' };
  game.log.push({ type: 'pass', team, player: playerName });
  endTurn(game);
  return { ok: true };
}

export function logClue(game, team, playerName) {
  game.log.push({ type: 'clue', team, player: playerName, word: game.clue.word, number: game.clue.number });
}

// انتهاء الوقت (لو المؤقت مفعّل)
export function timeout(game) {
  if (game.phase === 'over') return;
  game.log.push({ type: 'timeout', team: game.turn });
  endTurn(game);
}

// النسخة اللي يشوفها لاعب معيّن — المفتاح فقط لرؤساء الجواسيس أو بعد نهاية اللعبة
export function viewFor(game, { isSpymaster }) {
  if (!game) return null;
  const showKey = isSpymaster || game.phase === 'over';
  return {
    cards: game.cards.map((c) => ({
      word: c.word,
      revealed: c.revealed,
      color: c.revealed || showKey ? c.color : null,
      suggestedBy: c.suggestedBy,
    })),
    startingTeam: game.startingTeam,
    turn: game.turn,
    phase: game.phase,
    clue: game.clue,
    guessesLeft: Number.isFinite(game.guessesLeft) ? game.guessesLeft : 'inf',
    guessesMade: game.guessesMade,
    winner: game.winner,
    winReason: game.winReason,
    remaining: { red: remaining(game, 'red'), blue: remaining(game, 'blue') },
    log: game.log,
    turnStartedAt: game.turnStartedAt,
  };
}
