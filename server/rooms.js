import { randomBytes, randomInt } from 'node:crypto';
import * as G from './game.js';
import { wordPool, parseCustomWords } from './words.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون O/0/I/1
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PLAYERS = 30;

export const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoom() {
  const code = makeCode();
  const room = {
    code,
    players: new Map(), // token -> player
    hostToken: null,
    settings: { wordMode: 'default', customWords: [], timer: 0 },
    game: null,
    lastActive: Date.now(),
    timerHandle: null,
  };
  rooms.set(code, room);
  return room;
}

export const getRoom = (code) => rooms.get(String(code || '').toUpperCase());

export function cleanName(name) {
  return String(name ?? '').replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

export function joinRoom(room, token, name) {
  name = cleanName(name);
  if (!name) return { error: 'اكتب اسمك' };
  let p = token && room.players.get(token);
  if (p) {
    if (name !== p.name && [...room.players.values()].some((q) => q !== p && q.name === name)) return { error: 'الاسم مستخدم' };
    p.name = name;
  } else {
    if (room.players.size >= MAX_PLAYERS) return { error: 'الغرفة ممتلئة' };
    if ([...room.players.values()].some((q) => q.name === name)) return { error: 'الاسم مستخدم في الغرفة، اختر اسم ثاني' };
    token = randomBytes(16).toString('hex');
    // اختيار الفريق الأقل عدداً تلقائياً
    const count = (t) => [...room.players.values()].filter((q) => q.team === t).length;
    const team = count('red') <= count('blue') ? 'red' : 'blue';
    p = { token, id: randomBytes(6).toString('hex'), name, team, role: 'operative', connected: 0 };
    room.players.set(token, p);
  }
  if (!room.hostToken || !room.players.has(room.hostToken)) room.hostToken = token;
  room.lastActive = Date.now();
  return { ok: true, player: p };
}

export function setTeamRole(room, player, team, role) {
  if (!G.TEAMS.includes(team) && team !== 'spectator') return { error: 'فريق غير صالح' };
  if (!['operative', 'spymaster'].includes(role)) role = 'operative';
  if (team === 'spectator') role = 'operative';
  if (role === 'spymaster') {
    const taken = [...room.players.values()].find((q) => q !== player && q.team === team && q.role === 'spymaster');
    if (taken) return { error: `${taken.name} هو رئيس جواسيس هذا الفريق` };
  }
  // ما يقدر رئيس الجواسيس يرجع عميل أثناء اللعب (شاف المفتاح)
  if (room.game && room.game.phase !== 'over' && player.role === 'spymaster' && (role !== 'spymaster' || team !== player.team)) {
    return { error: 'شفت المفتاح، ما تقدر تغيّر دورك قبل نهاية اللعبة' };
  }
  player.team = team;
  player.role = role;
  return { ok: true };
}

export function updateSettings(room, s = {}) {
  if (['default', 'custom', 'mixed'].includes(s.wordMode)) room.settings.wordMode = s.wordMode;
  if (typeof s.customWordsText === 'string') room.settings.customWords = parseCustomWords(s.customWordsText);
  if ([0, 60, 90, 120, 180].includes(Number(s.timer))) room.settings.timer = Number(s.timer);
  if (room.settings.wordMode !== 'default' && room.settings.customWords.length === 0 && room.settings.wordMode === 'custom') {
    return { error: 'أضف 25 كلمة على الأقل' };
  }
  return { ok: true };
}

export function startGame(room) {
  const pool = wordPool(room.settings);
  try {
    room.game = G.newGame(pool);
  } catch {
    return { error: 'لازم يكون فيه 25 كلمة مختلفة على الأقل' };
  }
  return { ok: true };
}

export function shuffleTeams(room) {
  const ps = [...room.players.values()].filter((p) => p.team !== 'spectator');
  for (let i = ps.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [ps[i], ps[j]] = [ps[j], ps[i]];
  }
  ps.forEach((p, i) => { p.team = i % 2 === 0 ? 'red' : 'blue'; p.role = 'operative'; });
  for (const t of G.TEAMS) {
    const first = ps.find((p) => p.team === t);
    if (first) first.role = 'spymaster';
  }
}

export function publicState(room, viewer) {
  const isSpymaster = viewer.role === 'spymaster' && viewer.team !== 'spectator';
  return {
    code: room.code,
    me: { id: viewer.id, name: viewer.name, team: viewer.team, role: viewer.role, isHost: room.hostToken === viewer.token },
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, role: p.role, online: p.connected > 0, isHost: room.hostToken === p.token,
    })),
    settings: { wordMode: room.settings.wordMode, timer: room.settings.timer, customCount: room.settings.customWords.length },
    game: G.viewFor(room.game, { isSpymaster }),
    serverNow: Date.now(),
  };
}

export function cleanupRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    const anyOnline = [...room.players.values()].some((p) => p.connected > 0);
    if (!anyOnline && now - room.lastActive > ROOM_TTL_MS) {
      clearTimeout(room.timerHandle);
      rooms.delete(code);
    }
  }
}
