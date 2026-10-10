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
  // 大当たり演出の長さ（CSS の popJackpot と同じ長さ）。
  // たたいてから次のもぐらが出るまで最短でも HIT_HOLD_MS + HIDE_MS + 間隔（約0.43秒）あるので、それより前に消えきる長さにする
  const JACKPOT_MS = 400;

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
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const confirmEl = document.getElementById('confirm');
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');

  let score = 0;
  let best = loadBest();
  let playing = false;
  let startTime = 0;
  let spawnTimer = null;
  let clockTimer = null;
  let resultTimer = null;
  let spawnDue = 0;           // 次のもぐらを出す予定の時刻
  let paused = false;         // 一時停止中か
  let pausedAt = 0;           // 一時停止した時刻
  let spawnLeft = null;       // 一時停止した時の、次のもぐらまでの残り時間
  const activeMoles = new Set(); // いま出ているもぐら（1匹か2匹）
  const holes = [];

  bestEl.textContent = best;

  // ---------- iPhone のホーム画面のアプリで、背景を画面の一番下まで描く ----------
  // ホーム画面のアプリは画面全体を使うのに、iPhone によっては 100% の高さが下まで届かず、すき間ができる。
  // そこで、実際の画面の高さを --scene-h に入れて、背景（style.css）をそこまで広げる。
  // 盤面やボタンの位置は変えない。ブラウザで開いた時やパソコンでは何もしない
  function fitScene() {
    if (navigator.standalone !== true) return; // iPhone・iPad のホーム画面のアプリだけ
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const portrait = window.innerHeight >= window.innerWidth;
    const screenW = portrait ? short : long;
    const screenH = portrait ? long : short;
    // iPad の画面分割などで、アプリが画面全体を使っていない時は広げない
    if (Math.abs(window.innerWidth - screenW) > 2) {
      document.documentElement.style.removeProperty('--scene-h');
      return;
    }
    document.documentElement.style.setProperty('--scene-h', Math.max(window.innerHeight, screenH) + 'px');
  }
  fitScene();
  window.addEventListener('resize', fitScene);
  window.addEventListener('orientationchange', () => setTimeout(fitScene, 300));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fitScene(); });

  // ---------- 穴を9個つくる ----------
  for (let i = 0; i < 9; i++) {
    const hole = template.content.firstElementChild.cloneNode(true);
    const state = { el: hole, index: i, up: false, type: 'normal', hideTimer: null, hideDue: 0, hideLeft: null, boomTimer: null };
    hole.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      whack(state);
    });
    board.appendChild(hole);
    holes.push(state);
  }

  // ---------- 得点で変わる天気の背景 ----------
  // 0〜99点：雨 / 100〜199点：くもり / 200〜299点：晴れ間 / 300〜399点：晴れ / 400〜499点：快晴（虹と花）
  // 500点以上：ごほうびの晴れ（大きな虹2本・花畑・キラキラの太陽）
  // 見た目の切り替えは CSS（body の data-weather）がふわっと行う
  const SPECIAL_WEATHER = 5;
  const sunburstEl = document.querySelector('.sunburst');
  let weather = 0;
  function updateWeather() {
    const next = Math.min(SPECIAL_WEATHER, Math.floor(score / 100));
    if (next === weather) return;
    const prev = weather;
    weather = next;
    document.body.dataset.weather = String(weather);
    // 500点に届いた瞬間だけ、背景をふわっと明るく光らせる
    sunburstEl.classList.remove('on');
    if (weather === SPECIAL_WEATHER && prev < SPECIAL_WEATHER) {
      void sunburstEl.offsetWidth; // アニメーションを最初からやり直す
      sunburstEl.classList.add('on');
    }
  }

  // 雨粒（盤面の後ろを降る）
  const rainEl = document.getElementById('rain');
  for (let i = 0; i < 40; i++) {
    const d = document.createElement('i');
    d.className = 'drop';
    d.style.left = (Math.random() * 110).toFixed(1) + '%';
    const dur = 0.7 + Math.random() * 0.5;
    d.style.animationDuration = dur.toFixed(2) + 's';
    d.style.animationDelay = (-Math.random() * dur).toFixed(2) + 's';
    d.style.opacity = (0.4 + Math.random() * 0.5).toFixed(2);
    rainEl.appendChild(d);
  }

  // 快晴で咲く花（画面の下のほう。盤面にはかからない）
  const flowersEl = document.getElementById('flowers');
  const FLOWERS = [
    [5, 3], [15, 9], [26, 2], [37, 7], [49, 3], [61, 8], [72, 2], [83, 7], [94, 3],
    [4, 15], [96, 14],
  ];
  const PETALS = ['#ff8fb1', '#ffffff', '#ffb3d1', '#c9a7ff', '#ff9e7a'];
  FLOWERS.forEach(([x, y], i) => {
    const f = document.createElement('i');
    f.className = 'flower';
    f.style.left = `calc(${x}% - 12px)`;
    f.style.bottom = `calc(${y}% + 6px + env(safe-area-inset-bottom))`;
    f.style.setProperty('--petal', PETALS[i % PETALS.length]);
    f.style.setProperty('--d', (i * 0.06).toFixed(2) + 's');
    flowersEl.appendChild(f);
  });

  // 500点からは花がたくさん増えて、色とりどりの花畑になる（盤面の後ろなので、穴にはかからない）
  //   [左からの位置%, 下からの位置%, 大きさpx]
  const MORE_FLOWERS = [];
  [[1, 0], [4, 3.5], [7, 0], [10, 3.5], [13, 7]].forEach(([y, shift]) => {
    for (let x = 1 + shift; x < 100; x += 7) MORE_FLOWERS.push([x, y, 20 + ((x * 7 + y * 3) % 4) * 3]);
  });
  [20, 26, 32, 38, 44, 50, 56, 62, 68].forEach((y, i) => {   // 画面の左右のはし（パソコンや横長の画面で見える）
    MORE_FLOWERS.push([1.5 + (i % 2) * 3, y, 22], [96.5 - (i % 2) * 3, y, 22]);
  });
  const MORE_PETALS = [
    ['#ff5c7a', '#ffd84a'], ['#ffa94d', '#fff3b0'], ['#ffe14a', '#ff8c42'], ['#ff8fd1', '#ffd84a'],
    ['#b48cff', '#fff3b0'], ['#6fb6ff', '#ffe14a'], ['#ffffff', '#ffc93a'], ['#ff6bd6', '#fff3b0'],
  ];
  MORE_FLOWERS.forEach(([x, y, size], i) => {
    const f = document.createElement('i');
    f.className = 'flower extra';
    f.style.left = `calc(${x}% - ${size / 2}px)`;
    f.style.bottom = `calc(${y}% + 4px)`; // 花畑は飾りなので、iPhone の画面の一番下（ホームバーの後ろ）まで咲かせる
    f.style.width = f.style.height = size + 'px';
    const [petal, center] = MORE_PETALS[(i * 3) % MORE_PETALS.length];
    f.style.setProperty('--petal', petal);
    f.style.setProperty('--center', center);
    f.style.setProperty('--d', (0.3 + (i % 12) * 0.05).toFixed(2) + 's');
    flowersEl.appendChild(f);
  });

  // 500点からの、空と地面のキラキラ
  const glitterEl = document.getElementById('glitter');
  const GLINTS = [
    [8, 6], [22, 14], [36, 4], [48, 18], [60, 8], [70, 20], [80, 26], [94, 30],
    [14, 22], [42, 10], [55, 24], [30, 26], [4, 40], [95, 50], [3, 70], [97, 82], [50, 95], [20, 92], [78, 93],
  ];
  GLINTS.forEach(([x, y], i) => {
    const g = document.createElement('i');
    g.className = 'glint';
    g.style.left = x + '%';
    g.style.top = y + '%';
    g.style.setProperty('--s', 16 + (i % 4) * 5 + 'px');
    g.style.animationDelay = (-(i * 0.37) % 2.4).toFixed(2) + 's';
    g.style.animationDuration = (2 + (i % 3) * 0.5) + 's';
    glitterEl.appendChild(g);
  });

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
  const hitVoices = {};       // 種類ごとの、最後に鳴らした長い効果音

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
  // 長い音（exclusive に名前を付けたもの）は、同じ音がまだ鳴っていたらすぐ小さくして消し、
  // 音が重なって大きくなりすぎないようにする。違う種類の音どうし（2匹を続けてたたいた時など）は止めない
  function voice(fn, exclusive = null, lengthSec = 2) {
    const ctx = getAudio();
    if (!ctx) return;
    const v = ctx.createGain();
    v.connect(master);
    if (exclusive) {
      const old = hitVoices[exclusive];
      if (old) {
        old.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => old.disconnect(), 200);
      }
      hitVoices[exclusive] = v;
    }
    out = v;
    try { fn(); } finally { out = null; }
    setTimeout(() => {
      v.disconnect();
      if (exclusive && hitVoices[exclusive] === v) hitVoices[exclusive] = null;
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
  // 長い大当たり音と悲しい音は、同じ音が続けて鳴ったら前の音を止めて、重なりすぎないようにする
  const sound = {
    hit:         () => voice(sfx.hit, null, 0.4),
    jackpot:     () => voice(sfx.jackpot, 'jackpot', 1.6),
    angelHit:    () => voice(sfx.angelHit, 'angelHit', 1.6),
    start:       () => voice(sfx.start, null, 0.7),
    end:         () => voice(sfx.end, null, 0.7),
    record:      () => voice(sfx.record, null, 1.0),
  };

  // ---------- ゲームの進行 ----------
  function elapsed() {
    return (performance.now() - startTime) / 1000;
  }

  // 経過時間ごとのスピードの目安（ms）。間の時間は直線的に変化させ、だんだん速くする
  //   stay: 顔を出している時間 / gap: 引っ込みきってから次が出るまでの間隔
  //   0秒：遊びやすい速さ → 25秒（残り20秒）からテンポアップ → 35秒（残り10秒）からかなり速く
  const SPEED_TABLE = [
    { t: 0,  stay: 800, gap: 140 },
    { t: 15, stay: 680, gap: 110 },
    { t: 25, stay: 590, gap: 90 },
    { t: 35, stay: 510, gap: 65 },
    { t: 45, stay: 450, gap: 50 },
  ];
  const DOUBLE_EXTRA_STAY = 150; // 2匹同時の時は、2回たたけるよう少し長めに顔を出す

  // 2匹同時に出る確率（経過秒数ごと）。それ以外は1匹だけ
  function doubleChance(t) {
    if (t < 25) return 0;
    if (t < 35) return 0.3;  // 25〜35秒：ときどき
    return 0.6;              // 35〜45秒：多め
  }

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

  // 次のもぐらを出す予約と、もぐらを引っ込める予約。
  // 一時停止できるよう、いつ動く予定かを覚えておく（再開した時に、残りの時間から続ける）
  function setSpawn(ms) {
    clearTimeout(spawnTimer); // 予約は常に1つだけ
    spawnDue = performance.now() + ms;
    spawnTimer = setTimeout(spawnMole, ms);
  }
  function setHide(h, ms) {
    clearTimeout(h.hideTimer);
    h.hideDue = performance.now() + ms;
    h.hideTimer = setTimeout(() => { h.hideTimer = null; hideMole(h); }, ms);
  }

  // すべてのタイマーを止めて、もぐらを全部引っ込める（タイマーの重複防止）
  function resetTimers() {
    clearTimeout(spawnTimer);
    clearInterval(clockTimer);
    clearTimeout(resultTimer);
    spawnTimer = null;
    clockTimer = null;
    resultTimer = null;
    paused = false;
    spawnLeft = null;
    holes.forEach((h) => { h.hideLeft = null; });
    showPaused(false);
    activeMoles.clear();      // 先に空にしておき、hideMole から次の出現が予約されないようにする
    holes.forEach(hideMole);
  }

  // ---------- 一時停止と再開 ----------
  // 止めている間は、残り時間・もぐら・次のもぐらの予約をすべて止める（たたいても得点は変わらない）。
  // 再開したら、止めた時の残り時間から続けるので、ゲームの速さは止めなかった時と同じになる
  function pauseGame() {
    if (!playing || paused) return;
    paused = true;
    pausedAt = performance.now();
    clearInterval(clockTimer);
    clockTimer = null;
    spawnLeft = spawnTimer ? Math.max(0, spawnDue - pausedAt) : null;
    clearTimeout(spawnTimer);
    spawnTimer = null;
    holes.forEach((h) => {
      h.hideLeft = h.hideTimer ? Math.max(0, h.hideDue - pausedAt) : null;
      clearTimeout(h.hideTimer);
      h.hideTimer = null;
    });
    showPaused(true);
  }

  function resumeGame() {
    if (!playing || !paused) return;
    paused = false;
    startTime += performance.now() - pausedAt; // 止めていた時間は、経過時間に数えない
    clockTimer = setInterval(updateClock, 100);
    if (spawnLeft !== null) setSpawn(spawnLeft);
    spawnLeft = null;
    holes.forEach((h) => {
      if (h.hideLeft !== null) setHide(h, h.hideLeft);
      h.hideLeft = null;
    });
    showPaused(false);
  }

  function showPaused(on) {
    game.classList.toggle('paused', on);
    pauseBtn.textContent = on ? '▶ 再開' : '⏸ 一時停止';
  }

  // ---------- やり直し ----------
  // 確認している間はゲームを止めておく。「いいえ」なら元の状態（遊んでいた／止めていた）に戻す
  let pausedBeforeConfirm = false;
  function askRestart() {
    if (!playing) return;
    pausedBeforeConfirm = paused;
    pauseGame();
    confirmEl.classList.remove('hidden');
  }
  function closeConfirm() {
    confirmEl.classList.add('hidden');
  }

  function startGame() {
    unlockAudio(); // スマホではタップ時に音を有効化する必要がある
    playing = false;
    resetTimers();
    score = 0;
    scoreEl.textContent = score;
    updateWeather(); // 再スタートで雨に戻る
    timeEl.textContent = GAME_TIME;
    timeEl.parentElement.classList.remove('hurry');
    result.classList.add('hidden');
    closeConfirm();
    startBtn.disabled = true;

    playing = true;
    game.classList.add('playing'); // 「一時停止」「やり直し」ボタンを出す
    startTime = performance.now();
    sound.start();

    clockTimer = setInterval(updateClock, 100);
    setSpawn(600);
  }

  function updateClock() {
    if (paused) return;
    const left = Math.max(0, GAME_TIME - elapsed());
    timeEl.textContent = Math.ceil(left);
    if (left <= 5) timeEl.parentElement.classList.add('hurry');
    if (left <= 0) endGame();
  }

  // 1回に出すのは1匹か2匹。出たもぐらが全部引っ込みきってから、次を出す
  function spawnMole() {
    spawnTimer = null;
    if (!playing || activeMoles.size > 0) return;
    const t = elapsed();
    const count = Math.random() < doubleChance(t) ? 2 : 1;

    // 種類：2匹の時は必ず別々の種類にする
    const types = [pickType([])];
    if (count === 2) types.push(pickType(types));

    // 穴：2匹の時は必ず別々の穴にする
    const free = holes.slice();
    const stay = currentSpeed().stay + (count === 2 ? DOUBLE_EXTRA_STAY : 0);
    types.forEach((type) => {
      const h = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      showMole(h, type, stay);
    });
  }

  // 出現確率（普通40％・悪30％・天使30％）で種類を選ぶ。exclude にある種類は選ばない
  function pickType(exclude) {
    const table = [
      { type: 'normal', rate: 1 - ANGEL_RATE - BAD_RATE },
      { type: 'bad', rate: BAD_RATE },
      { type: 'angel', rate: ANGEL_RATE },
    ].filter((x) => !exclude.includes(x.type));
    const total = table.reduce((sum, x) => sum + x.rate, 0);
    let r = Math.random() * total;
    for (const x of table) {
      if ((r -= x.rate) < 0) return x.type;
    }
    return table[table.length - 1].type;
  }

  function scheduleNext() {
    if (!playing) return;
    // 引っ込むアニメーションが終わってから、間隔をあけて次を出す（どの種類のもぐらでも同じ間隔）
    setSpawn(HIDE_MS + currentSpeed().gap);
  }

  function showMole(h, type, stay) {
    activeMoles.add(h);
    h.up = true;
    h.type = type;
    h.el.classList.remove('hit');
    h.el.classList.toggle('angel', h.type === 'angel');
    h.el.classList.toggle('bad', h.type === 'bad');
    h.el.classList.add('up');
    // 出てくる時はどの種類も音を鳴らさない（音で天使モグラだとわからないように）

    // 顔を出している時間：0.8秒 → 0.45秒（見逃しても減点なし）
    setHide(h, stay);
  }

  function hideMole(h) {
    clearTimeout(h.hideTimer);
    h.hideTimer = null;
    h.up = false;
    h.el.classList.remove('up', 'hit');
    if (activeMoles.delete(h) && activeMoles.size === 0) scheduleNext();
  }

  function whack(h) {
    if (!playing || paused || !h.up || h.el.classList.contains('hit')) return; // 一時停止中は得点が変わらない
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
    updateWeather(); // 得点の段階が変わった時だけ天気を切り替える（下がった時は前の天気に戻る）
    // 「> <」の顔を少しだけ見せて、すぐ引っ込めて次へ（演出の文字や星は穴に残って続く）
    setHide(h, HIT_HOLD_MS);
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
    h.boomTimer = setTimeout(() => holeEl.classList.remove('boom'), JACKPOT_MS);

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
    addTemp(holeEl, pop, JACKPOT_MS);

    // 爆発の光と衝撃波
    const core = document.createElement('div');
    core.className = 'boom-core';
    addTemp(holeEl, core, 320);
    const ring = document.createElement('div');
    ring.className = 'boom-ring';
    addTemp(holeEl, ring, 370);

    // 赤と紫の稲妻
    const boltCount = 6;
    for (let i = 0; i < boltCount; i++) {
      const b = document.createElement('div');
      b.className = 'bolt';
      b.style.setProperty('--rot', (360 / boltCount) * i + Math.random() * 20 - 10 + 'deg');
      b.style.setProperty('--c', i % 2 ? '#b026ff' : '#ff2a3d');
      b.style.animationDelay = Math.random() * 0.03 + 's';
      addTemp(holeEl, b, 400);
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
      addTemp(holeEl, s, 390);
    }

    // 画面を一瞬赤紫に光らせて、軽く揺らす
    const flash = document.createElement('div');
    flash.className = 'flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 300);

    game.classList.remove('shake');
    void game.offsetWidth; // アニメーションを最初からやり直す
    game.classList.add('shake');
    setTimeout(() => game.classList.remove('shake'), 300);
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
    game.classList.remove('playing');
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
      document.dispatchEvent(new Event('mogura:result')); // 結果画面を出したことを更新機能（pwa.js）に知らせる
    }, 500);
  }

  startBtn.addEventListener('click', startGame);
  retryBtn.addEventListener('click', startGame);
  pauseBtn.addEventListener('click', () => (paused ? resumeGame() : pauseGame()));
  restartBtn.addEventListener('click', askRestart);
  confirmYes.addEventListener('click', () => {
    closeConfirm();
    startGame(); // 得点0点・残り45秒から（最高記録はそのまま）
  });
  confirmNo.addEventListener('click', () => {
    closeConfirm();
    if (!pausedBeforeConfirm) resumeGame(); // 遊んでいた時は続きから。止めていた時は止めたまま
  });

  // 更新機能（pwa.js）が「いまプレイ中か」を確かめるための窓口（一時停止中も「プレイ中」として扱い、更新しない）
  window.MoguraGame = { isPlaying: () => playing, isPaused: () => paused };
})();
