import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as G from './game.js';
import * as R from './rooms.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const server = createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 25000 });

// حد بسيط لإنشاء الغرف لكل IP
const createHits = new Map();
function allowCreate(ip) {
  const now = Date.now();
  const hits = (createHits.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  createHits.set(ip, hits);
  return hits.length <= 10;
}

app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '1h' }));

app.post('/api/rooms', (req, res) => {
  if (!allowCreate(req.ip)) return res.status(429).json({ error: 'محاولات كثيرة، انتظر دقيقة' });
  const room = R.createRoom();
  res.json({ code: room.code });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = R.getRoom(req.params.code);
  res.status(room ? 200 : 404).json({ exists: !!room });
});

app.get('/r/:code', (req, res) => res.sendFile(join(PUBLIC, 'room.html')));

app.get('/qr/:code.svg', async (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const url = `${req.protocol}://${req.get('host')}/r/${code}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14213d', light: '#ffffff' } });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
});

app.get('/health', (_req, res) => res.json({ ok: true, rooms: R.rooms.size }));

// ===== السوكت =====
function broadcast(room) {
  room.lastActive = Date.now();
  for (const s of io.sockets.adapter.rooms.get(room.code) || []) {
    const sock = io.sockets.sockets.get(s);
    const p = sock && room.players.get(sock.data.token);
    if (p) sock.emit('room:state', R.publicState(room, p));
  }
}

function scheduleTimer(room) {
  clearTimeout(room.timerHandle);
  room.timerHandle = null;
  const g = room.game;
  if (!g || g.phase === 'over' || !room.settings.timer) return;
  const ms = g.turnStartedAt + room.settings.timer * 1000 - Date.now();
  room.timerHandle = setTimeout(() => {
    if (room.game !== g || g.phase === 'over') return;
    G.timeout(g);
    scheduleTimer(room);
    broadcast(room);
  }, Math.max(0, ms));
}

io.on('connection', (socket) => {
  const ctx = () => {
    const room = R.getRoom(socket.data.code);
    const player = room && room.players.get(socket.data.token);
    return { room, player };
  };
  const fail = (msg) => socket.emit('error:msg', msg);
  const handle = (event, fn) =>
    socket.on(event, (payload = {}, ack) => {
      try {
        const { room, player } = ctx();
        if (!room || !player) return fail('انضم للغرفة أول');
        const r = fn(room, player, payload || {});
        if (r && r.error) {
          fail(r.error);
          if (typeof ack === 'function') ack(r);
          return;
        }
        scheduleTimer(room);
        broadcast(room);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (e) {
        console.error(e);
        fail('صار خطأ، حاول مرة ثانية');
      }
    });

  socket.on('room:join', ({ code, token, name } = {}, ack) => {
    const room = R.getRoom(code);
    if (!room) return typeof ack === 'function' && ack({ error: 'الغرفة غير موجودة أو انتهت' });
    const r = R.joinRoom(room, token, name);
    if (r.error) return typeof ack === 'function' && ack(r);
    if (socket.data.code && socket.data.code !== room.code) socket.leave(socket.data.code);
    if (socket.data.token !== r.player.token) r.player.connected++;
    socket.data = { code: room.code, token: r.player.token };
    socket.join(room.code);
    if (typeof ack === 'function') ack({ ok: true, token: r.player.token });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const { room, player } = ctx();
    if (!room || !player) return;
    player.connected = Math.max(0, player.connected - 1);
    // نقل المضيف لو طلع
    if (room.hostToken === player.token && player.connected === 0) {
      const next = [...room.players.values()].find((p) => p.connected > 0);
      if (next) room.hostToken = next.token;
    }
    broadcast(room);
  });

  const hostOnly = (fn) => (room, player, p) => (room.hostToken === player.token ? fn(room, player, p) : { error: 'هذا للمضيف فقط' });

  handle('player:setTeamRole', (room, player, { team, role }) => R.setTeamRole(room, player, team, role));
  handle('room:settings', hostOnly((room, _p, s) => R.updateSettings(room, s)));
  handle('teams:shuffle', hostOnly((room) => {
    if (room.game && room.game.phase !== 'over') return { error: 'ما تقدر تخلط الفرق أثناء اللعب' };
    R.shuffleTeams(room);
  }));
  handle('game:start', hostOnly((room) => R.startGame(room)));
  handle('game:reset', hostOnly((room) => { room.game = null; }));
  handle('host:kick', hostOnly((room, player, { id }) => {
    const target = [...room.players.values()].find((p) => p.id === id);
    if (!target || target === player) return { error: 'ما تقدر' };
    room.players.delete(target.token);
    for (const sid of io.sockets.adapter.rooms.get(room.code) || []) {
      const s = io.sockets.sockets.get(sid);
      if (s && s.data.token === target.token) { s.emit('kicked'); s.leave(room.code); s.data = {}; }
    }
  }));
  handle('host:transfer', hostOnly((room, _p, { id }) => {
    const target = [...room.players.values()].find((p) => p.id === id);
    if (!target) return { error: 'اللاعب غير موجود' };
    room.hostToken = target.token;
  }));

  const needGame = (fn) => (room, player, p) => (room.game ? fn(room.game, room, player, p) : { error: 'اللعبة ما بدأت' });

  handle('clue:give', needGame((game, _room, player, { word, number }) => {
    if (player.role !== 'spymaster') return { error: 'التلميح لرئيس الجواسيس فقط' };
    const r = G.giveClue(game, player.team, word, number);
    if (r.ok) G.logClue(game, player.team, player.name);
    return r;
  }));
  handle('card:suggest', needGame((game, _room, player, { index }) => {
    if (player.role !== 'operative') return { error: 'رئيس الجواسيس ما يخمّن' };
    return G.suggest(game, player.team, Number(index), player.name);
  }));
  handle('card:reveal', needGame((game, _room, player, { index }) => {
    if (player.role !== 'operative') return { error: 'رئيس الجواسيس ما يخمّن' };
    return G.reveal(game, player.team, Number(index), player.name);
  }));
  handle('turn:end', needGame((game, _room, player) => {
    if (player.role !== 'operative') return { error: 'العملاء ينهون التخمين' };
    return G.passTurn(game, player.team, player.name);
  }));
});

setInterval(() => R.cleanupRooms(), 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => console.log(`الشفرة تعمل على http://${HOST}:${PORT}`));

export { server };
