(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const CODE = (location.pathname.split('/')[2] || '').toUpperCase();
  const TOKEN_KEY = 'shifra:token:' + CODE;
  const NAME_KEY = 'shifra:name';
  const TEAM_NAME = { red: 'الفريق الأحمر', blue: 'الفريق الأزرق' };
  const COLOR_NAME = { red: 'أحمر', blue: 'أزرق', neutral: 'محايدة', assassin: 'القاتل' };
  const EMBLEM = { red: '◆', blue: '●', neutral: '—', assassin: '☠' };
  const ROOM_URL = location.origin + '/r/' + CODE;

  let state = null;
  let joined = false;
  let prevRevealed = new Set();
  let boardSeen = false;
  let clockOffset = 0;
  let timerTick = null;

  $('codeChip').textContent = CODE;
  $('roomLink').textContent = ROOM_URL;
  $('qrImg').src = '/qr/' + CODE + '.svg';
  const shareText = 'تعال العب معنا الشفرة 🕵️ ' + ROOM_URL;
  $('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(shareText);

  function toast(msg, ms = 2600) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(ROOM_URL); toast('تم نسخ الرابط ✅'); }
    catch { prompt('انسخ الرابط:', ROOM_URL); }
  }
  async function nativeShare() {
    if (navigator.share) { try { await navigator.share({ title: 'الشفرة', text: 'تعال العب معنا الشفرة 🕵️', url: ROOM_URL }); } catch {} }
    else copyLink();
  }
  $('copyBtn').onclick = copyLink;
  $('nativeShare').onclick = nativeShare;
  $('shareBtn').onclick = () => {
    if (state && state.game) nativeShare();
    else $('lobby').scrollIntoView({ behavior: 'smooth' });
  };

  // ===== النوافذ =====
  const open = (id) => $(id).classList.remove('hidden');
  const close = (id) => $(id).classList.add('hidden');
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden'); });
  });
  $('rulesBtn').onclick = () => open('rulesModal');
  $('resetBtn').onclick = () => open('hostModal');
  $('newGameBtn').onclick = () => { emit('game:start'); close('hostModal'); };
  $('toLobbyBtn').onclick = () => { emit('game:reset'); close('hostModal'); };

  // ===== الاتصال =====
  const socket = io({ transports: ['websocket', 'polling'] });

  function emit(ev, payload = {}) {
    socket.emit(ev, payload, (r) => { if (r && r.error) {/* error:msg يعرضه */} });
  }

  function join(name) {
    socket.emit('room:join', { code: CODE, token: store.get(TOKEN_KEY), name }, (r) => {
      if (!r || r.error) {
        if (r && r.error && r.error.includes('غير موجودة')) {
          document.body.innerHTML = '<main class="center" style="padding:60px 16px"><h2>الغرفة غير موجودة أو انتهت ⌛</h2><p><a class="btn" href="/">إنشاء غرفة جديدة</a></p></main>';
          return;
        }
        $('nameErr').textContent = (r && r.error) || 'تعذّر الدخول';
        open('nameModal');
        return;
      }
      joined = true;
      store.set(TOKEN_KEY, r.token);
      store.set(NAME_KEY, name);
      close('nameModal');
    });
  }

  $('nameForm').onsubmit = (e) => {
    e.preventDefault();
    const n = $('nameInput').value.trim();
    if (n) join(n);
  };

  socket.on('connect', () => {
    const name = store.get(NAME_KEY);
    if (name) join(name);
    else { $('nameInput').value = ''; open('nameModal'); setTimeout(() => $('nameInput').focus(), 50); }
  });
  socket.on('disconnect', () => toast('انقطع الاتصال… نحاول نرجع'));
  socket.on('error:msg', (m) => toast('⚠️ ' + m));
  socket.on('kicked', () => {
    store.del(TOKEN_KEY);
    document.body.innerHTML = '<main class="center" style="padding:60px 16px"><h2>تم إخراجك من الغرفة</h2><p><a class="btn" href="/">الصفحة الرئيسية</a></p></main>';
  });
  socket.on('room:state', (s) => {
    clockOffset = s.serverNow - Date.now();
    state = s;
    render();
  });

  // ===== العرض =====
  function render() {
    const s = state;
    const me = s.me;
    $('countChip').textContent = '👤 ' + s.players.filter((p) => p.online).length;
    $('resetBtn').classList.toggle('hidden', !(me.isHost && s.game));
    const inGame = !!s.game;
    $('lobby').classList.toggle('hidden', inGame);
    $('game').classList.toggle('hidden', !inGame);
    if (inGame) renderGame(); else { renderLobby(); boardSeen = false; prevRevealed = new Set(); }
    setupTimer();
  }

  function playersOf(team, role) {
    return state.players.filter((p) => p.team === team && (!role || p.role === role));
  }

  function pill(p) {
    const me = state.me;
    const cls = ['pill', p.id === me.id ? 'me' : '', p.online ? '' : 'off'].join(' ');
    const host = p.isHost ? ' 👑' : '';
    const kick = me.isHost && p.id !== me.id ? `<button class="x" data-kick="${esc(p.id)}" title="خيارات">⋯</button>` : '';
    return `<span class="${cls}">${esc(p.name)}${host}${kick}</span>`;
  }

  function teamPanel(team) {
    const s = state, me = s.me, g = s.game;
    const spy = playersOf(team, 'spymaster');
    const ops = playersOf(team, 'operative');
    const score = g ? g.remaining[team] : '';
    const spyLocked = g && g.phase !== 'over' && me.role === 'spymaster';
    let join = '';
    if (!spyLocked) {
      const btns = [];
      if (!(me.team === team && me.role === 'operative')) btns.push(`<button class="btn" data-join="${team}" data-role="operative">انضم كعميل</button>`);
      if (spy.length === 0) btns.push(`<button class="btn" data-join="${team}" data-role="spymaster">انضم كرئيس جواسيس</button>`);
      if (btns.length) join = `<div class="join">${btns.join('')}</div>`;
    }
    const active = g && g.phase !== 'over' && g.turn === team ? ' active' : '';
    return `<div class="team ${team}${active}">
      ${g ? `<div class="score">${score}</div>` : ''}
      <div class="tname">${TEAM_NAME[team]}</div>
      <h4>رئيس الجواسيس</h4><div class="members">${spy.map(pill).join('') || '<span class="pill off">—</span>'}</div>
      <h4>العملاء</h4><div class="members">${ops.map(pill).join('') || '<span class="pill off">—</span>'}</div>
      ${join}
    </div>`;
  }

  function logPanel() {
    const g = state.game;
    const items = (g ? g.log : []).slice().reverse().map((e) => {
      if (e.type === 'clue') return `<li class="${e.team}"><b>${esc(e.player)}</b> أعطى تلميح: <b>${esc(e.word)} ${e.number === 'inf' ? '∞' : e.number}</b></li>`;
      if (e.type === 'guess') return `<li class="${e.team}"><b>${esc(e.player)}</b> كشف <b>${esc(e.word)}</b> <span class="dot ${e.color}"></span> ${COLOR_NAME[e.color]}</li>`;
      if (e.type === 'pass') return `<li class="${e.team}"><b>${esc(e.player)}</b> أنهى التخمين</li>`;
      if (e.type === 'timeout') return `<li class="${e.team}">⏱️ انتهى وقت ${TEAM_NAME[e.team]}</li>`;
      return '';
    }).join('');
    return `<div class="log"><h3>سجل اللعب</h3><ol>${items || '<li class="muted center">ما صار شي للحين</li>'}</ol></div>`;
  }

  function bindTeamButtons(root) {
    root.querySelectorAll('[data-join]').forEach((b) => {
      b.onclick = () => emit('player:setTeamRole', { team: b.dataset.join, role: b.dataset.role });
    });
    root.querySelectorAll('[data-kick]').forEach((b) => {
      b.onclick = () => {
        const p = state.players.find((x) => x.id === b.dataset.kick);
        if (!p) return;
        const choice = prompt(`${p.name}\nاكتب 1 لإخراجه من الغرفة، أو 2 لجعله المضيف`);
        if (choice === '1') emit('host:kick', { id: p.id });
        else if (choice === '2') emit('host:transfer', { id: p.id });
      };
    });
  }

  function renderLobby() {
    const s = state, me = s.me;
    $('lobbyTeams').innerHTML = teamPanel('red') + `<div class="log"><h3>الحالة</h3><ol>
      <li>المتصلين: ${s.players.filter((p) => p.online).length}</li>
      <li>أنت في: <b>${me.team === 'spectator' ? 'المتفرجين' : TEAM_NAME[me.team]}</b> — ${me.role === 'spymaster' ? 'رئيس جواسيس' : 'عميل'}</li>
      <li><button class="btn small ghost" data-join="spectator" data-role="operative" style="width:100%;color:var(--card-text)">👀 تفرّج فقط</button></li>
    </ol></div>` + teamPanel('blue');
    bindTeamButtons($('lobbyTeams'));

    $('settingsPanel').classList.toggle('hidden', !me.isHost);
    if (me.isHost) {
      if (document.activeElement !== $('wordMode')) $('wordMode').value = s.settings.wordMode;
      if (document.activeElement !== $('timer')) $('timer').value = String(s.settings.timer);
      $('customWrap').classList.toggle('hidden', $('wordMode').value === 'default');
      $('customCount').textContent = s.settings.customCount ? `محفوظ: ${s.settings.customCount} كلمة` : '';
    }
    $('shuffleBtn').classList.toggle('hidden', !me.isHost);
    $('startBtn').classList.toggle('hidden', !me.isHost);
    const missing = ['red', 'blue'].filter((t) => playersOf(t, 'spymaster').length === 0);
    $('lobbyHint').textContent = missing.length
      ? 'كل فريق يحتاج رئيس جواسيس قبل البداية' + (me.isHost ? ' (أو اضغط خلط الفرق)' : '')
      : (me.isHost ? 'كل شي جاهز، ابدأ اللعبة!' : 'بانتظار المضيف يبدأ اللعبة…');
    $('startBtn').disabled = missing.length > 0;
  }

  $('wordMode').onchange = () => $('customWrap').classList.toggle('hidden', $('wordMode').value === 'default');
  $('saveSettings').onclick = () => {
    const payload = { wordMode: $('wordMode').value, timer: Number($('timer').value) };
    if ($('wordMode').value !== 'default' && $('customWords').value.trim()) payload.customWordsText = $('customWords').value;
    socket.emit('room:settings', payload, (r) => { if (r && r.ok) toast('تم حفظ الإعدادات ✅'); });
  };
  $('shuffleBtn').onclick = () => emit('teams:shuffle');
  $('startBtn').onclick = () => emit('game:start');

  function myTurnAs(role) {
    const g = state.game, me = state.me;
    return g && g.phase !== 'over' && me.team === g.turn && me.role === role;
  }

  function renderGame() {
    const s = state, g = s.game, me = s.me;
    const isSpy = me.role === 'spymaster' && me.team !== 'spectator';
    const canGuess = myTurnAs('operative') && g.phase === 'guess';

    // الفائز
    const w = $('winner');
    if (g.phase === 'over') {
      w.className = 'winner-banner ' + g.winner;
      w.textContent = `🏆 فاز ${TEAM_NAME[g.winner]}!` + (g.winReason === 'assassin' ? ' (الخصم كشف القاتل ☠)' : '');
    } else w.className = 'winner-banner hidden';

    // الحالة
    const st = $('status');
    st.className = 'status ' + (g.phase === 'over' ? '' : g.turn);
    let html = '';
    if (g.phase === 'clue') {
      html = myTurnAs('spymaster') ? 'دورك! اكتب تلميح لفريقك 👇' : `${TEAM_NAME[g.turn]} — رئيس الجواسيس يفكّر بتلميح…`;
    } else if (g.phase === 'guess') {
      const left = g.guessesLeft === 'inf' ? '∞' : g.guessesLeft;
      html = `التلميح: <span class="clue-word">${esc(g.clue.word)}</span><span class="clue-num">${g.clue.number === 'inf' ? '∞' : g.clue.number}</span>
        <div class="muted">${canGuess ? 'خمّنوا! اضغط البطاقة للاقتراح ثم ✓ للكشف' : TEAM_NAME[g.turn] + ' يخمّن…'} — التخمينات المتبقية: ${left}</div>`;
    } else {
      html = 'انتهت اللعبة — اللوحة كاملة مكشوفة';
    }
    st.innerHTML = html;
    if (s.settings.timer && g.phase !== 'over') st.insertAdjacentHTML('afterbegin', '<span class="timer" id="timerTxt"></span> ');

    // اللوحة
    const board = $('board');
    board.className = 'board' + (isSpy && g.phase !== 'over' ? ' spy' : '') + (g.phase === 'over' ? ' over' : '');
    const nowRevealed = new Set();
    board.innerHTML = g.cards.map((c, i) => {
      const cls = ['card'];
      if (c.revealed) { cls.push('revealed', 'c-' + c.color); nowRevealed.add(i); if (boardSeen && !prevRevealed.has(i)) cls.push('flip'); }
      else if (c.color) cls.push('key-' + c.color);
      if (canGuess && !c.revealed) cls.push('clickable');
      const sugg = !c.revealed && c.suggestedBy.length ? `<div class="sugg">${c.suggestedBy.map((n) => `<span>${esc(n)}</span>`).join('')}</div>` : '';
      const confirm = canGuess && !c.revealed && c.suggestedBy.length ? `<button class="confirm" data-reveal="${i}" aria-label="كشف ${esc(c.word)}">✓ كشف</button>` : '';
      const emblem = c.revealed ? `<span class="emblem">${EMBLEM[c.color]}</span>` : '';
      const interactive = canGuess && !c.revealed ? 'role="button" tabindex="0"' : '';
      return `<div class="${cls.join(' ')}" data-i="${i}" ${interactive}>${sugg}<span class="word">${esc(c.word)}</span>${emblem}${confirm}</div>`;
    }).join('');
    prevRevealed = nowRevealed;
    boardSeen = true;
    board.querySelectorAll('.card.clickable').forEach((el) => {
      el.onclick = (e) => {
        const rv = e.target.closest('[data-reveal]');
        if (rv) { e.stopPropagation(); emit('card:reveal', { index: Number(rv.dataset.reveal) }); return; }
        emit('card:suggest', { index: Number(el.dataset.i) });
      };
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } };
    });

    // منطقة الإجراء
    const bar = $('actionbar');
    if (myTurnAs('spymaster') && g.phase === 'clue') {
      if (!bar.querySelector('.clue-form')) {
        bar.innerHTML = `<form class="clue-form" id="clueForm">
          <input id="clueWord" maxlength="30" placeholder="اكتب التلميح هنا" autocomplete="off" required>
          <select id="clueNum">${['1','2','3','4','5','6','7','8','9','0','inf'].map((n) => `<option value="${n}">${n === 'inf' ? '∞' : n}</option>`).join('')}</select>
          <button class="btn" type="submit">أرسل</button></form>`;
        $('clueForm').onsubmit = (e) => {
          e.preventDefault();
          const word = $('clueWord').value.trim();
          if (!word) return;
          socket.emit('clue:give', { word, number: $('clueNum').value }, (r) => { if (r && r.ok && $('clueWord')) $('clueWord').value = ''; });
        };
      }
    } else if (canGuess) {
      bar.innerHTML = `<button class="btn ghost" id="passBtn" ${g.guessesMade < 1 ? 'disabled' : ''}>✋ إنهاء التخمين</button>`;
      $('passBtn').onclick = () => emit('turn:end');
    } else if (g.phase === 'over' && me.isHost) {
      bar.innerHTML = `<button class="btn" id="againBtn">🔄 لعبة جديدة</button><button class="btn ghost" id="lobbyBtn">↩️ تغيير الفرق</button>`;
      $('againBtn').onclick = () => emit('game:start');
      $('lobbyBtn').onclick = () => emit('game:reset');
    } else if (g.phase === 'over') {
      bar.innerHTML = '<span class="muted">بانتظار المضيف يبدأ لعبة جديدة…</span>';
    } else {
      bar.innerHTML = '';
    }

    $('gameTeams').innerHTML = teamPanel('red') + logPanel() + teamPanel('blue');
    bindTeamButtons($('gameTeams'));
  }

  // ===== المؤقت =====
  function setupTimer() {
    clearInterval(timerTick);
    const g = state.game;
    const limit = state.settings.timer;
    const el = () => $('timerTxt');
    if (!g || g.phase === 'over' || !limit) { if (el()) el().textContent = ''; return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((g.turnStartedAt + limit * 1000 - (Date.now() + clockOffset)) / 1000));
      const m = Math.floor(left / 60), sec = String(left % 60).padStart(2, '0');
      if (el()) el().textContent = ` ⏱️ ${m}:${sec}`;
    };
    tick();
    timerTick = setInterval(tick, 500);
  }
})();
