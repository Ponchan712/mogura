// もぐらたたき：オフライン対応と自動更新
// ・起動した時、ホーム画面から開き直した時、ゲームが終わった時、ネットにつながった時と、
//   開いたままの時も5分ごとに、新しいバージョンが公開されていないか確認する（プレイ中は確認しない）
// ・新しいバージョンが見つかったら、プレイ中でない安全なタイミングで最新版に切り替える
//     スタート画面にいる時 …… すぐに切り替える
//     プレイ中 ……………………… 切り替えない（ゲームが終わるまで待つ）
//     結果画面 ……………………… 「もう一度あそぶ」を押した時か、アプリを閉じた時に切り替える
(() => {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return; // https / localhost の時だけ動く

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 開いたままの時も5分ごとに確認
  const MIN_GAP_MS = 10 * 1000;             // 続けて何度も確認しないよう、10秒はあける
  const resultEl = document.getElementById('result');
  const startBtn = document.getElementById('startBtn');
  const retryBtn = document.getElementById('retryBtn');

  let registration = null;
  let waitingWorker = null;   // 切り替え待ちの新しいバージョン
  let switching = false;      // 自分で切り替えを始めた時だけ再読み込みする
  let lastCheck = 0;

  const isPlaying = () => !!(window.MoguraGame && window.MoguraGame.isPlaying());
  const isResultShown = () => !resultEl.classList.contains('hidden');
  const isSafeNow = () => !isPlaying() && !isResultShown();

  function applyUpdate() {
    if (!waitingWorker || switching) return;
    switching = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    // 念のため、切り替えの知らせが来なくても3秒後に読み込み直す（くり返し読み込みにならないよう1回だけ）
    let retried = false;
    try {
      retried = Date.now() - Number(sessionStorage.getItem('moguraUpdateReload') || 0) < 30000;
      sessionStorage.setItem('moguraUpdateReload', String(Date.now()));
    } catch (e) { /* 保存できない環境では気にしない */ }
    if (!retried) setTimeout(() => location.reload(), 3000);
  }

  // 新しいバージョンが届いた時
  function onUpdateReady(worker) {
    waitingWorker = worker;
    if (isSafeNow()) {
      applyUpdate();
    } else if (isResultShown()) {
      showNote();
    }
    // プレイ中なら何もしない。ゲームが終わって結果画面が出たら案内する
  }

  function showNote() {
    if (document.getElementById('updateNote')) return;
    const note = document.createElement('p');
    note.id = 'updateNote';
    note.className = 'updateNote';
    note.textContent = '✨ 新しいバージョンがあります。「もう一度あそぶ」で更新します';
    retryBtn.before(note);
  }

  function checkForUpdate() {
    if (!registration || switching || waitingWorker || isPlaying()) return;
    if (Date.now() - lastCheck < MIN_GAP_MS) return;
    lastCheck = Date.now();
    registration.update().catch(() => { /* オフラインの時は確認しない */ });
  }

  // 新しいバージョンが待っている時は、ボタンを押したタイミングで切り替える（キャプチャで先に受け取る）
  [startBtn, retryBtn].forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (waitingWorker && !isPlaying()) {
        e.stopImmediatePropagation();
        applyUpdate();
      }
    }, true);
  });

  // ゲームが終わった時：待っているバージョンがあれば案内し、なければ新しいバージョンがないか確認する
  // （見つかったら結果画面に案内が出て、「もう一度あそぶ」で切り替わる）
  document.addEventListener('mogura:result', () => {
    if (waitingWorker) showNote();
    else { lastCheck = 0; checkForUpdate(); }
  });
  window.addEventListener('online', checkForUpdate); // 電波が戻った時

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // アプリを閉じた（別のアプリに切り替えた）時、プレイ中でなければ裏で最新版にしておく
      if (waitingWorker && !isPlaying()) applyUpdate();
    } else {
      checkForUpdate(); // 開き直した時に確認
    }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkForUpdate(); });
  setInterval(() => {
    if (!document.hidden && Date.now() - lastCheck >= CHECK_INTERVAL_MS) checkForUpdate();
  }, 60 * 1000);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (switching) location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        lastCheck = Date.now(); // register() 自体が更新の確認もしている
        // 前回までに届いて、切り替え待ちになっているバージョン
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            // controller がある＝すでに古いバージョンで動いている（初回インストールではない）
            if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady(worker);
          });
        });
      })
      .catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
})();
