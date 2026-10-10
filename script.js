(() => {
  const GAME_TIME = 45;       // 制限時間（秒）
  const POINT = 10;           // 普通のもぐらの得点
  const BAD_POINT = 20;       // 悪モグラ（大当たり）の得点
  const BAD_RATE = 0.30;      // 悪モグラの出現確率
  const ANGEL_POINT = 20;     // 天使モグラをたたいた時の減点
  const ANGEL_RATE = 0.30;    // 天使モグラの出現確率（残り40％は普通のもぐら）
  const BEST_KEY = 'moguraBestScore';
  const HIDE_MS = 160;        // 引っ込むアニメーション（.14s）が終わるまでの時間
  const HIT_HOLD_MS = 220;    // たたかれた顔を見せておく時間

  const game = document.querySelector('.game');
  const board = document.getElementById('board');
  const timeEl = document.getElementById('time');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const startBtn = document.getElementById('startBtn');
  const retryBtn = document.getElementById('retryBtn');
  const result = document.getElementById('result');
  const finalScoreEl = document.getElementById('finalScore');
  const finalBestEl = document.getElementById('finalBest');
  const newRecordEl = document.getElementById('newRecord');
  const template = document.getElementById('holeTemplate');

  let score = 0;
  let best = loadBest();
  let playing = false;
  let startTime = 0;
  let spawnTimer = null;
  let clockTimer = null;
  let resultTimer = null;
  let currentMole = null;     // いま出ているもぐら（常に1匹まで）
  const holes = [];

  bestEl.textContent = best;

  // ---------- 穴を9個つくる ----------
  for (let i = 0; i < 9; i++) {
    const hole = template.content.firstElementChild.cloneNode(true);
    const state = { el: hole, index: i, up: false, type: 'normal', hideTimer: null, boomTimer: null };
    hole.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      whack(state);
    });
    board.appendChild(hole);
    holes.push(state);
  }

  // ---------- 最高得点の保存 ----------
  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(value) {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch (e) { /* 保存できない環境では何もしない */ }
  }

  // ---------- 効果音（Web Audio API） ----------
  let audioCtx = null;
  let master = null;          // 全体の音量（大きくなりすぎないよう、コンプレッサーを通す）
  let noiseBuf = null;        // 爆発音・「しゅ〜」用のノイズ
  let unlocked = false;
  let out = null;             // いま作っている効果音の出力先（voice() の中だけ使う）
  let hitVoice = null;        // 最後にたたいた時の効果音

  function getAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      master = audioCtx.createGain();
      master.gain.value = 0.75;
      master.connect(comp).connect(audioCtx.destination);
    }
    if (audioCtx.state !== 'running') {
      try { audioCtx.resume(); } catch (e) { /* 何もしない */ }
    }
    return audioCtx;
  }

  // スマホ（特にiPhone）は、タッチの中で一度音を鳴らすと以後も音が出るようになる
  function unlockAudio() {
    const ctx = getAudio();
    if (!ctx || (unlocked && ctx.state === 'running')) return;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    unlocked = true;
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, unlockAudio, { passive: true }));
  // iPhoneで、ピンチやダブルタップで画面が拡大されないようにする
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // アプリを切り替えて戻ってきた時に音が止まったままにならないように
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx) getAudio();
  });

  // 効果音ひとつ分をまとめて鳴らす。
  // たたいた時の音（exclusive）は、前の音が残っていたらすぐ小さくして消し、音が重なって大きくなりすぎないようにする
  function voice(fn, exclusive = false, lengthSec = 2) {
    const ctx = getAudio();
    if (!ctx) return;
    const v = ctx.createGain();
    v.connect(master);
    if (exclusive) {
      if (hitVoice) {
        const old = hitVoice;
        old.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => old.disconnect(), 200);
      }
      hitVoice = v;
    }
    out = v;
    try { fn(); } finally { out = null; }
    setTimeout(() => {
      v.disconnect();
      if (hitVoice === v) hitVoice = null;
    }, lengthSec * 1000 + 300);
  }

  // ふつうの音（いきなり鳴らす）
  function tone(freq, start, duration, type = 'sine', volume = 0.25, slideTo = null) {
    const ctx = getAudio();
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(out || master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // やわらかい音（ふわっと立ち上がり、ゆらぎを付けられる）
  function softTone(freq, start, duration, volume, slideTo = null, vibrato = 0) {
    const ctx = getAudio();
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.02);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(out || master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // ノイズ（フィルターの周波数を動かして「ドカーン」「しゅ〜」を作る）
  function noise(start, duration, volume, filterType, freqFrom, freqTo, attack = 0.005) {
    const ctx = getAudio();
    if (!ctx) return;
    if (!noiseBuf) {
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freqFrom, t);
    filter.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(out || master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  const sfx = {
    hit() {
      // 普通のもぐら：軽快な「ポン！」＋「きらりん」
      tone(320, 0, 0.12, 'square', 0.18, 140);
      tone(880, 0.05, 0.12, 'triangle', 0.2, 1320);
      tone(1320, 0.12, 0.18, 'sine', 0.15);
    },
    jackpot() {
      // 悪モグラ：「ドカーン！」
      noise(0, 0.7, 0.55, 'lowpass', 4000, 150);
      tone(150, 0, 0.55, 'sine', 0.45, 38);
      tone(95, 0, 0.25, 'square', 0.1, 45);
      // 「ギュイーン」と上がってから「キラキラキラーン！」
      tone(500, 0.2, 0.25, 'sawtooth', 0.05, 2000);
      [1319, 1568, 1976, 2349, 2637, 3136, 3951].forEach((f, i) =>
        tone(f, 0.32 + i * 0.055, 0.22, 'triangle', 0.1));
      [2093, 2637, 3136].forEach((f) => {
        softTone(f, 0.72, 0.8, 0.06);
        softTone(f * 1.004, 0.72, 0.8, 0.04); // 少しずらして重ね、きらめかせる
      });
      noise(0.7, 0.6, 0.05, 'highpass', 7000, 9000, 0.02);
    },
    angelAppear() {
      // 天使モグラが出た時：小さく「ふわ〜ん」
      softTone(1568, 0, 0.45, 0.04);
      softTone(2093, 0.08, 0.5, 0.03);
    },
    angelHit() {
      // 天使モグラ：かわいくて少し悲しい「しゅ〜ん……」
      noise(0, 0.5, 0.08, 'bandpass', 3000, 600, 0.06);
      softTone(880, 0.04, 0.75, 0.12, 330, 8);
      softTone(659, 0.85, 0.3, 0.06);
      softTone(523, 1.05, 0.45, 0.05, 494);
    },
    start() {
      // 明るいスタート音
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.15, 'triangle', 0.2));
      tone(1568, 0.4, 0.25, 'sine', 0.12);
    },
    end() {
      // 短い終了音
      [784, 659, 523].forEach((f, i) => tone(f, i * 0.1, 0.14, 'triangle', 0.18));
      tone(1047, 0.32, 0.3, 'triangle', 0.18);
    },
    record() {
      [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.65 + i * 0.08, 0.2, 'sine', 0.15));
    },
  };

  // 実際に鳴らす時はこちらを使う（数字は音の長さの目安・秒）
  // 長い大当たり音と悲しい音は、次の長い音が鳴ったら前の音を止めて、重なりすぎないようにする
  const sound = {
    hit:         () => voice(sfx.hit, false, 0.4),
    jackpot:     () => voice(sfx.jackpot, true, 1.6),
    angelAppear: () => voice(sfx.angelAppear, false, 0.6),
    angelHit:    () => voice(sfx.angelHit, true, 1.6),
    start:       () => voice(sfx.start, false, 0.7),
    end:         () => voice(sfx.end, false, 0.7),
    record:      () => voice(sfx.record, false, 1.0),
  };

  // ---------- ゲームの進行 ----------
  function elapsed() {
    return (performance.now() - startTime) / 1000;
  }

  // 経過時間ごとのスピードの目安（ms）。間の時間は直線的に変化させる
  //   stay: 顔を出している時間 / gap: 引っ込みきってから次が出るまでの間隔
  const SPEED_TABLE = [
    { t: 0,  stay: 1000, gap: 250 },
    { t: 15, stay: 850,  gap: 200 },
    { t: 30, stay: 700,  gap: 150 },
    { t: 45, stay: 550,  gap: 100 },
  ];

  function currentSpeed() {
    const t = Math.min(Math.max(elapsed(), 0), GAME_TIME);
    for (let i = 1; i < SPEED_TABLE.length; i++) {
      const a = SPEED_TABLE[i - 1];
      const b = SPEED_TABLE[i];
      if (t <= b.t) {
        const r = (t - a.t) / (b.t - a.t);
        return {
          stay: a.stay + (b.stay - a.stay) * r,
          gap: a.gap + (b.gap - a.gap) * r,
        };
      }
    }
    const last = SPEED_TABLE[SPEED_TABLE.length - 1];
    return { stay: last.stay, gap: last.gap };
  }

  // すべてのタイマーを止めて、もぐらを全部引っ込める（タイマーの重複防止）
  function resetTimers() {
    clearTimeout(spawnTimer);
    clearInterval(clockTimer);
    clearTimeout(resultTimer);
    spawnTimer = null;
    clockTimer = null;
    resultTimer = null;
    currentMole = null;       // 先に外しておき、hideMole から次の出現が予約されないようにする
    holes.forEach(hideMole);
  }

  function startGame() {
    unlockAudio(); // スマホではタップ時に音を有効化する必要がある
    playing = false;
    resetTimers();
    score = 0;
    scoreEl.textContent = score;
    timeEl.textContent = GAME_TIME;
    timeEl.parentElement.classList.remove('hurry');
    result.classList.add('hidden');
    startBtn.disabled = true;

    playing = true;
    startTime = performance.now();
    sound.start();

    clockTimer = setInterval(updateClock, 100);
    spawnTimer = setTimeout(spawnMole, 600);
  }

  function updateClock() {
    const left = Math.max(0, GAME_TIME - elapsed());
    timeEl.textContent = Math.ceil(left);
    if (left <= 5) timeEl.parentElement.classList.add('hurry');
    if (left <= 0) endGame();
  }

  // もぐらは必ず1匹ずつ。前のもぐらが引っ込みきってから次を出す
  function spawnMole() {
    spawnTimer = null;
    if (!playing || currentMole) return;
    showMole();
  }

  function scheduleNext() {
    if (!playing) return;
    clearTimeout(spawnTimer); // 予約は常に1つだけ
    // 引っ込むアニメーションが終わってから、間隔をあけて次を出す
    spawnTimer = setTimeout(spawnMole, HIDE_MS + currentSpeed().gap);
  }

  function showMole() {
    const h = holes[Math.floor(Math.random() * holes.length)];
    currentMole = h;
    h.up = true;
    const r = Math.random();
    h.type = r < ANGEL_RATE ? 'angel'
           : r < ANGEL_RATE + BAD_RATE ? 'bad'
           : 'normal';
    h.el.classList.remove('hit');
    h.el.classList.toggle('angel', h.type === 'angel');
    h.el.classList.toggle('bad', h.type === 'bad');
    h.el.classList.add('up');
    if (h.type === 'angel') sound.angelAppear();

    // 顔を出している時間：1.0秒 → 0.55秒（見逃しても減点なし）
    clearTimeout(h.hideTimer);
    h.hideTimer = setTimeout(() => hideMole(h), currentSpeed().stay);
  }

  function hideMole(h) {
    clearTimeout(h.hideTimer);
    h.up = false;
    h.el.classList.remove('up', 'hit');
    if (h === currentMole) {
      currentMole = null;
      scheduleNext();
    }
  }

  function whack(h) {
    if (!playing || !h.up || h.el.classList.contains('hit')) return;
    clearTimeout(h.hideTimer);
    h.el.classList.add('hit');
    if (h.type === 'bad') {
      score += BAD_POINT;
      sound.jackpot();
      showJackpotEffects(h);
      if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    } else if (h.type === 'angel') {
      score = Math.max(0, score - ANGEL_POINT); // 0点より下にはならない
      sound.angelHit();
      showAngelEffects(h.el);
      if (navigator.vibrate) navigator.vibrate(60);
    } else {
      score += POINT;
      sound.hit();
      showEffects(h.el);
      if (navigator.vibrate) navigator.vibrate(20);
    }
    scoreEl.textContent = score;
    // 「> <」の顔を少しだけ見せて、すぐ引っ込めて次へ（演出の文字や星は穴に残って続く）
    h.hideTimer = setTimeout(() => hideMole(h), HIT_HOLD_MS);
  }

  // 要素を穴に追加し、ms 後に消す
  function addTemp(holeEl, el, ms) {
    holeEl.appendChild(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }

  // 悪モグラ：ゲームで一番派手な「大当たり！」
  function showJackpotEffects(h) {
    const holeEl = h.el;
    holeEl.classList.add('boom');
    clearTimeout(h.boomTimer);
    h.boomTimer = setTimeout(() => holeEl.classList.remove('boom'), 1300);

    // 「＋20点！ 大当たり！」（左右の端の穴では画面からはみ出さないよう内側へ寄せる）
    const pop = document.createElement('div');
    pop.className = 'pop jackpot';
    const col = h.index % 3;
    pop.style.setProperty('--px', col === 0 ? '-30%' : col === 2 ? '-70%' : '-50%');
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = '＋' + BAD_POINT + '点！';
    const big = document.createElement('span');
    big.className = 'big';
    big.textContent = '大当たり！';
    pop.append(pts, big);
    addTemp(holeEl, pop, 1300);

    // 爆発の光と衝撃波
    const core = document.createElement('div');
    core.className = 'boom-core';
    addTemp(holeEl, core, 600);
    const ring = document.createElement('div');
    ring.className = 'boom-ring';
    addTemp(holeEl, ring, 650);

    // 赤と紫の稲妻
    const boltCount = 6;
    for (let i = 0; i < boltCount; i++) {
      const b = document.createElement('div');
      b.className = 'bolt';
      b.style.setProperty('--rot', (360 / boltCount) * i + Math.random() * 20 - 10 + 'deg');
      b.style.setProperty('--c', i % 2 ? '#b026ff' : '#ff2a3d');
      b.style.animationDelay = Math.random() * 0.08 + 's';
      addTemp(holeEl, b, 750);
    }

    // 飛び散る火花
    const colors = ['#ff2a3d', '#b026ff', '#ffe14d', '#ffffff', '#ff6ad5'];
    const sparkCount = 16;
    for (let i = 0; i < sparkCount; i++) {
      const s = document.createElement('div');
      s.className = 'star spark';
      const angle = (Math.PI * 2 * i) / sparkCount + Math.random() * 0.3;
      const dist = 60 + Math.random() * 50;
      s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      s.style.setProperty('--size', 5 + Math.random() * 6 + 'px');
      s.style.setProperty('--c', colors[i % colors.length]);
      addTemp(holeEl, s, 750);
    }

    // 画面を一瞬赤紫に光らせて、軽く揺らす
    const flash = document.createElement('div');
    flash.className = 'flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 400);

    game.classList.remove('shake');
    void game.offsetWidth; // アニメーションを最初からやり直す
    game.classList.add('shake');
    setTimeout(() => game.classList.remove('shake'), 400);
  }

  // 天使モグラ：「−20点！」と、ひらひら落ちる羽
  function showAngelEffects(holeEl) {
    const pop = document.createElement('div');
    pop.className = 'pop angel';
    pop.textContent = '−' + ANGEL_POINT + '点！';
    addTemp(holeEl, pop, 1000);

    const count = 5;
    for (let i = 0; i < count; i++) {
      const f = document.createElement('div');
      f.className = 'feather';
      f.style.setProperty('--dx', (i - (count - 1) / 2) * 18 + Math.random() * 8 + 'px');
      f.style.setProperty('--dy', 40 + Math.random() * 25 + 'px');
      f.style.setProperty('--r', 30 + Math.random() * 40 + 'deg');
      f.style.setProperty('--size', 14 + Math.random() * 8 + 'px');
      f.style.animationDelay = i * 0.05 + 's';
      addTemp(holeEl, f, 1300);
    }
  }

  function showEffects(holeEl) {
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.textContent = '+' + POINT;
    addTemp(holeEl, pop, 700);

    const marks = ['⭐', '✨', '💫', '⭐', '✨'];
    marks.forEach((m, i) => {
      const s = document.createElement('div');
      s.className = 'star';
      s.textContent = m;
      const angle = (Math.PI * 2 * i) / marks.length;
      s.style.setProperty('--dx', Math.cos(angle) * 45 + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * 45 + 'px');
      addTemp(holeEl, s, 500);
    });
  }

  function endGame() {
    if (!playing) return;
    playing = false;
    resetTimers();
    timeEl.textContent = 0;
    timeEl.parentElement.classList.remove('hurry');

    const isRecord = score > best;
    if (isRecord) {
      best = score;
      saveBest(best);
      bestEl.textContent = best;
    }

    finalScoreEl.textContent = score;
    finalBestEl.textContent = best;
    newRecordEl.classList.toggle('hidden', !isRecord);
    sound.end();
    if (isRecord) sound.record();

    resultTimer = setTimeout(() => {
      resultTimer = null;
      result.classList.remove('hidden');
      startBtn.disabled = false;
    }, 500);
  }

  startBtn.addEventListener('click', startGame);
  retryBtn.addEventListener('click', startGame);
})();
