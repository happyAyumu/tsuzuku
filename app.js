/* ==============================================
   TSUZUKU — アプリロジック
   ============================================== */

/* ============================================================
   定数・テーブル
   ============================================================ */

// 継続日数 → 上位% 変換テーブル（1〜90日）
const STREAK_PERCENTILE = {
  1:77.0,2:69.2,3:64.6,4:61.3,5:58.8,6:56.7,7:55.0,8:52.2,9:49.8,10:47.6,
  11:45.7,12:43.9,13:42.2,14:40.7,15:39.3,16:38.0,17:36.7,18:35.5,19:34.4,20:33.4,
  21:32.4,22:31.4,23:30.5,24:29.6,25:28.8,26:27.9,27:27.2,28:26.4,29:25.7,30:25.0,
  31:24.5,32:24.1,33:23.6,34:23.2,35:22.8,36:22.3,37:21.9,38:21.6,39:21.2,40:20.8,
  41:20.5,42:20.1,43:19.8,44:19.4,45:19.1,46:18.8,47:18.5,48:18.2,49:17.9,50:17.6,
  51:17.3,52:17.0,53:16.7,54:16.4,55:16.2,56:15.9,57:15.7,58:15.4,59:15.1,60:14.9,
  61:14.7,62:14.4,63:14.2,64:14.0,65:13.7,66:13.5,67:13.3,68:13.1,69:12.9,70:12.7,
  71:12.5,72:12.2,73:12.0,74:11.9,75:11.7,76:11.5,77:11.3,78:11.1,79:10.9,80:10.7,
  81:10.5,82:10.4,83:10.2,84:10.0,85:9.8,86:9.7,87:9.5,88:9.3,89:9.2,90:9.0
};

// 累計達成日数 → 開発スキルマイルストーン
const DEV = [
  [10,  "コンポーネント設計を自分でできる"],
  [20,  "useState/useEffectを迷わず使える"],
  [30,  "CRUD APIルートを自走実装できる"],
  [40,  "Supabaseリアルタイム機能を独力で組める"],
  [50,  "Clerk認証フローを自前でカスタマイズできる"],
  [60,  "MVPの設計〜実装を一人で完結できる"],
  [70,  "SEO・OGP・メタタグを実装できる"],
  [80,  "Stripe基本課金フローを組める"],
  [90,  "サブスク課金（Webhook含む）を単独実装できる"],
  [120, "パフォーマンス最適化・キャッシュ戦略が分かる"],
  [150, "複数プロダクトを並行管理できる設計ができる"],
  [180, "有料機能・管理画面・ダッシュボードを独力で作れる"],
];

// デフォルトタスク（初回起動時のみ使用）
const DEFAULT_TASKS = [
  { id: "d1", text: "朝6時に起きる" },
  { id: "d2", text: "朝の30分の作業" },
  { id: "d3", text: "ノートを書く・予定の確認" },
];

// ポモドーロ設定（秒単位）
const POMO_FOCUS      = 25 * 60;
const POMO_BREAK      = 5  * 60;
const POMO_LONG       = 15 * 60;
const POMO_LONG_EVERY = 4;       // 何ポモドーロごとに長休憩を入れるか


/* ============================================================
   ユーティリティ
   ============================================================ */

const $ = id => document.getElementById(id);

const pad     = n => String(n).padStart(2, "0");
const dstr    = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today   = () => dstr(new Date());
const fmtDate = s => { const p = s.split("-"); return `${+p[1]}/${+p[2]}`; };
const fmtMin  = sec => Math.floor(sec / 60);
const fmtTime = sec => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;

/** 秒 → 「X時間Y分」形式。1時間未満は「Y分」 */
function fmtHM(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

/** 指定した要素を一時的に表示し、2秒後にフェードアウトさせる（保存フィードバック用） */
function showToast(el, text) {
  if (text !== undefined) el.textContent = text;
  el.hidden = false;
  el.style.animation = "none";
  el.offsetWidth;                       // リフロー強制（再アニメ用）
  el.style.animation = "";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2000);
}

/** 継続日数 → 上位% を返す（90日超は補間） */
function getPercentile(streak) {
  if (streak <= 0) return null;
  if (streak <= 90) return STREAK_PERCENTILE[streak];
  const t = (Math.log(streak) - Math.log(90)) / (Math.log(365) - Math.log(90));
  return Math.max(5.0, Math.round((9.0 + t * (5.0 - 9.0)) * 10) / 10);
}


/* ============================================================
   アプリ状態（グローバル変数）
   ============================================================ */

const KEY      = "tsuzuku_v2";       // localStorage のキー
const GOAL_KEY    = "tsuzuku_goal_html";    // 「人生の目標」カスタムHTMLのキー
const COMPASS_KEY = "tsuzuku_compass_html"; // 「羅針盤」カスタムHTMLのキー

let S;                    // アプリ全体のデータオブジェクト
let pendingDeleteId = null;   // 削除確認中のタスクID
let memoHistoryOpen = false;  // 過去メモ展開フラグ（後方互換用、現在未使用）
const openMonths = new Set(); // 展開中の月キー "YYYY-MM"
let pomoTickId = null;        // ポモドーロ用インターバルID


/* ============================================================
   データ管理（ロード / セーブ / ロールオーバー）
   ============================================================ */

function defaultPomo() {
  return {
    phase: "focus",
    remaining: POMO_FOCUS,
    running: false,
    endAt: null,
    sessionsToday: 0,
    cycleCount: 0,
    sessionDate: today(),
    partialElapsed: 0,  // バナー表示時の経過秒数（スキップ後の誤計算防止用）
  };
}

/** バナーを確実に非表示にするヘルパー（inline styleでCSSクラスの display:flex を上書き） */
function hidePomoBanner() {
  $("pomoPartial").style.display = "none";
  S.pomo.partialElapsed = 0;
}

/** バナーを表示してメッセージとタイマー表示時の経過時間を保存するヘルパー */
function showPomoBanner(elapsed) {
  S.pomo.partialElapsed = elapsed;
  $("pomoPartialMsg").textContent = `${fmtHM(elapsed)}経過 — この時間を記録しますか？`;
  $("pomoPartial").style.display = "";  // inline styleを削除してCSSに委ねる（display:flex）
}

function pomoDuration(phase) {
  if (phase === "focus")     return POMO_FOCUS;
  if (phase === "longBreak") return POMO_LONG;
  return POMO_BREAK;
}

function load() {
  let s;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = JSON.parse(raw);
  } catch(e) {}

  if (!s) {
    s = {
      tasks:       DEFAULT_TASKS.map(dt => ({ id: dt.id, text: dt.text })),
      achieved:    {},
      todayChecks: { date: today(), ids: [] },
      memos:       {},
      focusTime:   { byDate: {}, total: 0 },
      pomo:        defaultPomo(),
      charBase:    1,
      best:        0,
      lastProcessed: today(),
      seq:         1,
    };
  }

  // --- 旧バージョンからのデータ移行 ---
  if (!s.memos) {
    s.memos = {};
    if (s.todayMemo && s.todayMemo.text) {
      s.memos[s.todayMemo.date || today()] = s.todayMemo.text;
    }
  }
  if (!s.focusTime) s.focusTime = { byDate: {}, total: 0 };
  if (!s.pomo)      s.pomo = defaultPomo();
  if (s.pomo.partialElapsed === undefined) s.pomo.partialElapsed = 0;

  // メモやタスクのフォーマット正規化
  if (s.tasks) s.tasks = s.tasks.map(({ id, text }) => ({ id, text }));

  return s;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e) {}
}

/** 日付をまたいだときの処理（クライムマップ位置の更新・チェックリストのリセット） */
function rollover() {
  const t = today();

  if (S.lastProcessed !== t) {
    let d = new Date(S.lastProcessed + "T00:00:00");
    while (dstr(d) < t) {
      S.charBase += S.achieved[dstr(d)] ? 1 : -1;
      if (S.charBase < 1) S.charBase = 1;
      d.setDate(d.getDate() + 1);
    }
    S.lastProcessed = t;
  }

  if (S.todayChecks.date !== t) {
    S.todayChecks = { date: t, ids: [] };
  }

  if (S.pomo.sessionDate !== t) {
    S.pomo.sessionsToday = 0;
    S.pomo.sessionDate   = t;
    if (!S.pomo.running) {
      S.pomo.phase     = "focus";
      S.pomo.remaining = POMO_FOCUS;
    }
  }

  save();
}


/* ============================================================
   集中時間の記録
   ============================================================ */

function getTodayFocusSec() {
  return S.focusTime.byDate[today()] || 0;
}

/** 指定した月曜日 (YYYY-MM-DD) から始まる7日間の集中秒数を合計 */
function getWeekFocusSec(mondayStr) {
  let total = 0;
  const start = new Date(mondayStr + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    total += S.focusTime.byDate[dstr(d)] || 0;
  }
  return total;
}

/** 指定日が属する週の月曜日を返す */
function getMondayStr(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return dstr(d);
}

const thisWeekFocusSec = () => getWeekFocusSec(getMondayStr(new Date()));
function lastWeekFocusSec() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return getWeekFocusSec(getMondayStr(d));
}

function addFocusTime(sec) {
  const t = today();
  S.focusTime.byDate[t] = (S.focusTime.byDate[t] || 0) + sec;
  S.focusTime.total     = (S.focusTime.total     || 0) + sec;
  save();
}


/* ============================================================
   ポモドーロタイマー
   ============================================================ */

/** アプリを閉じた間に経過した時間を endAt から復元する */
function restorePomoFromEndAt() {
  const p = S.pomo;
  if (!p.running || !p.endAt) return;
  const left = Math.ceil((p.endAt - Date.now()) / 1000);
  if (left <= 0) completePomoPhase(true);
  else p.remaining = left;
}

/** 現在の残り秒数を返す（実行中は endAt から計算） */
function pomoRemainingNow() {
  const p = S.pomo;
  if (p.running && p.endAt) return Math.max(0, Math.ceil((p.endAt - Date.now()) / 1000));
  return p.remaining;
}

function startPomo() {
  const p = S.pomo;
  p.running = true;
  p.endAt   = Date.now() + pomoRemainingNow() * 1000;
  hidePomoBanner();
  save(); renderPomo(); startPomoTick();
}

function pausePomo() {
  const p = S.pomo;
  if (p.running && p.endAt) {
    p.remaining = Math.max(0, Math.ceil((p.endAt - Date.now()) / 1000));
  }
  p.running = false;
  p.endAt   = null;
  save(); renderPomo(); stopPomoTick();

  // 集中フェーズで1分以上経過していたら途中記録バナーを表示
  if (p.phase === "focus") {
    const elapsed = POMO_FOCUS - p.remaining;
    if (elapsed >= 60) {
      showPomoBanner(elapsed);
    } else {
      hidePomoBanner();
    }
  } else {
    hidePomoBanner();
  }
}

/** 途中経過時間を記録してタイマーをリセット */
function recordPartialTime() {
  const p = S.pomo;
  // hidePomoBanner()がpartialElapsedを0にリセットするため、隠す前に値を確保しておく
  const elapsed = p.partialElapsed || 0;
  // 連打防止のため即座に隠す（CSSクラスに負けないようinline styleで確実に消す）
  hidePomoBanner();
  // 集中フェーズかつ一時停止中のみ記録する（休憩フェーズでの誤記録を防ぐ）
  if (p.phase !== "focus" || p.running) return;
  if (elapsed > 0) addFocusTime(elapsed);
  p.phase     = "focus";
  p.remaining = POMO_FOCUS;
  save(); renderPomo();
}

/** バナーを表示せずにタイマーを止め、次のフェーズに切り替える（pausePomo()は呼ばない） */
function skipPomoPhase() {
  const p = S.pomo;
  if (p.running && p.endAt) {
    p.remaining = Math.max(0, Math.ceil((p.endAt - Date.now()) / 1000));
  }
  p.running = false;
  p.endAt   = null;
  stopPomoTick();
  hidePomoBanner(); // 既存バナーも閉じる（表示を経由しないので二重加算にならない）

  p.phase     = (p.phase === "focus") ? "break" : "focus";
  p.remaining = pomoDuration(p.phase);
  save(); renderPomo();
}

/** タイマーを初期状態（25分・集中フェーズ・停止中）に戻す。記録済みの勉強時間は保持する */
function resetPomo() {
  stopPomoTick();
  S.pomo.running   = false;
  S.pomo.endAt     = null;
  S.pomo.phase     = "focus";
  S.pomo.remaining = POMO_FOCUS;
  hidePomoBanner();
  save(); renderPomo();
}

/** タイマーが 0 になったときに呼ばれる（fromTimer=true で完了扱い） */
function completePomoPhase(fromTimer) {
  const p = S.pomo;

  if (p.phase === "focus") {
    addFocusTime(POMO_FOCUS);
    p.sessionsToday = (p.sessionsToday || 0) + 1;
    p.cycleCount    = (p.cycleCount    || 0) + 1;
    p.phase = (p.cycleCount >= POMO_LONG_EVERY) ? "longBreak" : "break";
    if (p.phase === "longBreak") p.cycleCount = 0;
  } else {
    p.phase = "focus";
  }

  p.remaining = pomoDuration(p.phase);
  p.running   = false;
  p.endAt     = null;
  hidePomoBanner();
  save(); renderPomo();

  if (fromTimer && "vibrate" in navigator) navigator.vibrate([200, 100, 200]);
}

function startPomoTick() {
  stopPomoTick();
  if (!S.pomo.running) return;
  pomoTickId = setInterval(() => {
    const left = pomoRemainingNow();
    if (S.pomo.running && left <= 0) { completePomoPhase(true); return; }
    renderPomoDisplay(left);
  }, 250);
}

function stopPomoTick() {
  if (pomoTickId) { clearInterval(pomoTickId); pomoTickId = null; }
}


/* ============================================================
   Streak・達成判定
   ============================================================ */

const isAchievedToday = () =>
  S.tasks.length > 0 && S.tasks.every(x => S.todayChecks.ids.includes(x.id));

function streakNow() {
  let s = 0, d = new Date();
  if (!isAchievedToday()) d.setDate(d.getDate() - 1);
  while (S.achieved[dstr(d)]) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

const charPos   = () => Math.max(1, S.charBase + (isAchievedToday() ? 1 : 0));
const totalDays = () => Object.keys(S.achieved).length;

/** 次に到達できる上位% と、あと何日かを返す */
function nextTier(streak) {
  const p = getPercentile(Math.max(streak, 1));
  const tiers = [69, 55, 50, 40, 30, 25, 20, 15, 12, 10, 9, 8, 7, 6, 5];
  const target = tiers.find(x => x < (streak > 0 ? p : 77.1));
  if (!target) return null;
  for (let d = Math.max(streak + 1, 1); d <= 365; d++) {
    if (getPercentile(d) <= target) return { tier: target, days: d - streak };
  }
  return null;
}


/* ============================================================
   レンダリング
   ============================================================ */

function render() {
  const t = today(), ach = isAchievedToday(), streak = streakNow();
  if (streak > S.best) { S.best = streak; save(); }
  const p = getPercentile(streak);

  // --- ヒーローカード ---
  $("streakNum").textContent = streak;
  $("pctLine").innerHTML = p !== null
    ? `あなたの継続力は <b>上位${p}%</b> です`
    : `今日1日達成すれば <b>上位${getPercentile(1)}%</b> に入る`;
  $("bestVal").textContent  = S.best;
  $("totalVal").textContent = totalDays();
  $("hoursVal").textContent = (S.focusTime.total / 3600).toFixed(1);

  // --- 追跡ライン ---
  const chase = $("chaseLine"); chase.innerHTML = "";
  if (streak > 0 && streak === S.best) {
    chase.innerHTML = `<span class="chase best">🏆 いま自己ベスト更新中。今日の自分が過去最強</span>`;
  } else if (S.best > streak && S.best > 0) {
    chase.innerHTML = `<span class="chase">自己ベスト更新まで あと${S.best - streak + 1}日</span>`;
  } else {
    const nt = nextTier(streak);
    if (nt) chase.innerHTML = `<span class="chase">あと${nt.days}日で 上位${nt.tier}% 圏内</span>`;
  }

  // --- 警告カード（Streakを失うリスク） ---
  const loss = $("lossCard");
  if (S.tasks.length > 0 && !ach && streak > 0) {
    loss.style.display = "block";
    $("lossText").innerHTML = `⚠️ 今日達成しないと：Streak <b>${streak}日 → 0日</b>／上位 <b>${p}% → 77.0%</b> に逆戻り、キャラも1歩後退。<br>取り返すには最短でも${streak}日かかる。今日の30分が一番安い。`;
  } else {
    loss.style.display = "none";
  }

  // --- タスク進捗バー ---
  const done = S.tasks.filter(x => S.todayChecks.ids.includes(x.id)).length;
  $("progLabel").textContent = S.tasks.length
    ? (ach
        ? `✅ 今日達成！ ${done}/${S.tasks.length}`
        : `${done}/${S.tasks.length}　あと${S.tasks.length - done}個で今日を達成`)
    : "タスクを追加して今日を始めよう";
  $("progBar").style.width = S.tasks.length ? (done / S.tasks.length * 100) + "%" : "0%";

  // --- メモ（フォーカス中は上書きしない） ---
  const memoEl = $("dayMemo");
  if (memoEl && document.activeElement !== memoEl) {
    memoEl.value = S.memos[t] || "";
  }
  renderMemoHistory();
  renderPomo();

  // --- タスクリスト ---
  const list = $("taskList"); list.innerHTML = "";
  if (!S.tasks.length) {
    list.innerHTML = `<p class="empty">タスクを追加して今日を始めよう</p>`;
  }
  S.tasks.forEach(task => {
    const on         = S.todayChecks.ids.includes(task.id);
    const confirming = pendingDeleteId === task.id;
    const div        = document.createElement("div");
    div.className = "task" + (on ? " done" : "");
    div.innerHTML = `
      <div class="task-row">
        <button type="button" class="chk${on ? " on" : ""}" data-a="toggle" data-id="${task.id}">✓</button>
        <span class="task-text"></span>
        <button type="button" class="icon-btn${confirming ? " danger" : ""}" data-a="del" data-id="${task.id}" title="削除">✕</button>
      </div>
      ${confirming ? `<div class="del-confirm">
        <span>このタスクを削除しますか？</span>
        <button type="button" class="yes" data-a="delYes" data-id="${task.id}">削除</button>
        <button type="button" class="no"  data-a="delNo"  data-id="${task.id}">キャンセル</button>
      </div>` : ""}`;
    div.querySelector(".task-text").textContent = task.text;
    list.appendChild(div);
  });

  renderMap();
  renderForecast(streak);
  renderDev();
}

function renderPomo() {
  renderPomoDisplay(pomoRemainingNow());

  const todaySec = getTodayFocusSec();
  const thisSec  = thisWeekFocusSec();
  const lastSec  = lastWeekFocusSec();
  const diffSec  = thisSec - lastSec;

  $("pomoTodayMin").textContent = fmtMin(todaySec);
  $("pomoTotalHr").textContent  = (S.focusTime.total / 3600).toFixed(1);
  $("pomoSessions").textContent = `今日 ${S.pomo.sessionsToday || 0} ポモドーロ完了（25分×${S.pomo.sessionsToday || 0}）`;
  $("pomoMain").textContent     = S.pomo.running ? "一時停止" : "開始";

  $("studyToday").textContent     = fmtHM(todaySec);
  $("studyThisWeek").textContent  = fmtHM(thisSec);
  $("studyLastWeek").textContent  = fmtHM(lastSec);

  const diffEl = $("studyDiff");
  if (diffSec === 0) {
    diffEl.textContent = "—";
    diffEl.className   = "study-val study-diff same";
  } else if (diffSec > 0) {
    diffEl.textContent = "+" + fmtHM(diffSec) + " ↑";
    diffEl.className   = "study-val study-diff up";
  } else {
    diffEl.textContent = "−" + fmtHM(-diffSec) + " ↓";
    diffEl.className   = "study-val study-diff down";
  }
}

function renderPomoDisplay(left) {
  const p = S.pomo, total = pomoDuration(p.phase);
  const pct = total ? ((total - left) / total * 100).toFixed(1) + "%" : "0%";
  $("pomoRing").style.background = p.phase === "focus"
    ? `conic-gradient(var(--flame) ${pct}, var(--surface2) 0)`
    : `conic-gradient(var(--good)  ${pct}, var(--surface2) 0)`;
  $("pomoTime").textContent = fmtTime(left);

  const modeEl = $("pomoMode");
  if (p.phase === "focus") {
    modeEl.textContent = "集中";
    modeEl.className   = "pomo-mode focus";
  } else {
    modeEl.textContent = p.phase === "longBreak" ? "長休憩" : "休憩";
    modeEl.className   = "pomo-mode break";
  }
}

function renderMemoHistory() {
  const t   = today();
  const all = Object.keys(S.memos)
    .filter(d => S.memos[d].trim())
    .sort((a, b) => b.localeCompare(a));

  const container = $("memoMonthList");
  if (!container) return;

  if (!all.length) { container.innerHTML = ""; return; }

  // 月ごとにグループ化  { "2026-07": ["2026-07-05", ...], ... }
  const groups = {};
  all.forEach(d => {
    const monthKey = d.slice(0, 7); // "YYYY-MM"
    if (!groups[monthKey]) groups[monthKey] = [];
    groups[monthKey].push(d);
  });

  const monthKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  container.innerHTML = monthKeys.map(mk => {
    const [y, m] = mk.split("-");
    const label  = `${+m}月のメモ`;
    const days   = groups[mk];
    const isOpen = openMonths.has(mk);
    return `
      <div class="memo-month-group" data-month="${mk}">
        <div class="memo-month-header" data-toggle="${mk}">
          <span>${label}</span>
          <span>
            <span class="memo-month-count">${days.length}件</span>
            <span class="memo-month-arrow">${isOpen ? " ▲" : " ▼"}</span>
          </span>
        </div>
        <div class="memo-month-body${isOpen ? " open" : ""}" id="memo-month-${mk}"></div>
      </div>`;
  }).join("");

  // 各月の中身を安全に挿入（XSS対策でtextContent使用）
  monthKeys.forEach(mk => {
    const body = $("memo-month-" + mk);
    if (!body) return;
    groups[mk].forEach(d => {
      const item = document.createElement("div");
      item.className = "memo-item";
      const dateEl = document.createElement("div");
      dateEl.className   = "memo-date";
      dateEl.textContent = fmtDate(d) + (d === t ? " · 今日" : "");
      const bodyEl = document.createElement("div");
      bodyEl.className   = "memo-body";
      bodyEl.textContent = S.memos[d];
      item.appendChild(dateEl);
      item.appendChild(bodyEl);
      body.appendChild(item);
    });
  });
}

/* ---------- カスタムHTML読み込み機能（人生の目標・羅針盤で共通） ---------- */

/**
 * prefix（例: "goal" / "compass"）とlocalStorageキーを渡すと、
 * ${prefix}UploadBtn / ${prefix}ResetBtn / ${prefix}FileInput / ${prefix}UploadNote /
 * ${prefix}DefaultContent / ${prefix}CustomContent / ${prefix}SavedMsg のIDを持つ要素一式に対して
 * アップロード・リセット・表示切り替えのイベントを配線し、表示更新用のrender関数を返す。
 */
function setupUploadableCard(prefix, storageKey) {
  const uploadBtn  = $(prefix + "UploadBtn");
  const resetBtn   = $(prefix + "ResetBtn");
  const fileInput  = $(prefix + "FileInput");
  const note       = $(prefix + "UploadNote");
  const defaultBox = $(prefix + "DefaultContent");
  const customBox  = $(prefix + "CustomContent");
  const savedMsg   = $(prefix + "SavedMsg");

  function loadHtml() {
    try { return localStorage.getItem(storageKey); } catch(e) { return null; }
  }

  function render() {
    const html = loadHtml();
    const isCustom = !!html;
    defaultBox.hidden    = isCustom;
    customBox.hidden     = !isCustom;
    customBox.innerHTML  = isCustom ? html : "";
    resetBtn.hidden = !isCustom;
    note.hidden     = !isCustom;
  }

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", e => {
    const file = e.target.files[0];
    e.target.value = ""; // 同じファイルを再選択できるようにする
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { localStorage.setItem(storageKey, String(reader.result)); } catch(e) {}
      render();
      showToast(savedMsg, "✅ 読み込みました");
    };
    reader.onerror = () => {
      showToast(savedMsg, "⚠️ 読み込みに失敗しました");
    };
    reader.readAsText(file);
  });

  resetBtn.addEventListener("click", () => {
    try { localStorage.removeItem(storageKey); } catch(e) {}
    render();
    showToast(savedMsg, "✅ デフォルトに戻しました");
  });

  return render;
}

function renderMap() {
  const pos = charPos();
  $("mapPos").textContent   = pos;
  $("mapTotal").textContent = totalDays();

  const N     = Math.max(pos + 8, 24);
  const marks = {
    7:  "🚩 1週間",  14: "🚩 2週間",
    30: "⛰ 30日",   50: "⛰ 50日",
    60: "🏔 MVP圏", 90: "🏔 90日",
    120:"🌄 120日", 180:"🌅 180日",
  };

  const trail = $("trail"); trail.innerHTML = "";
  for (let i = 1; i <= N; i++) {
    const n = document.createElement("div");
    n.className = "node" + (i === pos ? " now" : (i < pos ? " passed" : ""));
    n.textContent = i === pos ? "🧗" : i;
    if (marks[i]) {
      const f = document.createElement("span");
      f.className   = "flag";
      f.textContent = marks[i];
      n.appendChild(f);
    }
    trail.appendChild(n);
  }
}

function scrollMapToNow() {
  const sky = $("sky"), cur = $("trail").querySelector(".now");
  if (cur) sky.scrollTop = cur.offsetTop - sky.clientHeight / 2;
}

function renderForecast(streak) {
  const f = $("forecast"); f.innerHTML = "";
  [10, 30, 90].forEach(n => {
    const row = document.createElement("div"); row.className = "fore-row";
    row.innerHTML = `<span class="when">${n}日後（Streak ${streak + n}日）</span><span class="val">上位${getPercentile(streak + n)}%</span>`;
    f.appendChild(row);
  });
}

function renderDev() {
  const td  = totalDays();
  const cur = [...DEV].reverse().find(m => td >= m[0]);
  $("devNow").textContent = cur
    ? `いまのレベル：${cur[1]}（累計${td}日・${(td * 0.5).toFixed(1)}時間）`
    : `いまは仕込み期間（累計${td}日・${(td * 0.5).toFixed(1)}時間）。最初の到達点まであと${DEV[0][0] - td}日。`;

  const next = DEV.filter(m => m[0] > td).slice(0, 3);
  const box  = $("devNext"); box.innerHTML = "";
  next.forEach(m => {
    const row = document.createElement("div"); row.className = "fore-row";
    row.innerHTML = `<span class="when">あと${m[0] - td}日<span class="hours">(累計${m[0] * 0.5}h)</span></span><span class="val small">${m[1]}</span>`;
    box.appendChild(row);
  });
}

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#FF6B2C", "#FF9D42", "#FFD080", "#1FA85C", "#3B7BF0"];
  for (let i = 0; i < 44; i++) {
    const c = document.createElement("div");
    c.className  = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    document.body.appendChild(c);
    const fall = c.animate(
      [{ transform: "translateY(0) rotate(0)", opacity: 1 },
       { transform: `translateY(${70 + Math.random() * 30}vh) rotate(${360 + Math.random() * 720}deg)`, opacity: 0 }],
      { duration: 1200 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.3,1)" }
    );
    fall.onfinish = () => c.remove();
  }
}


/* ============================================================
   イベントハンドラ
   ============================================================ */

// タブ切り替え
const SUBS = {
  today: "今日の分を積む",
  timer: "今日の集中時間を積む",
  memo:  "気づきを書き留める",
  map:   "夜明けまで登る",
  goal:  "28歳・月100万円へ",
};
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    const pg = btn.dataset.page;
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + pg));
    $("brandSub").textContent = SUBS[pg];
    if (pg === "map") requestAnimationFrame(scrollMapToNow);
    window.scrollTo({ top: 0 });
  });
});

// タスク操作（チェック・削除）
function deleteTask(id) {
  S.tasks             = S.tasks.filter(x => x.id !== id);
  S.todayChecks.ids   = S.todayChecks.ids.filter(x => x !== id);
  pendingDeleteId     = null;
  const t = today();
  if (isAchievedToday() && S.tasks.length > 0) S.achieved[t] = true;
  else delete S.achieved[t];
  save(); render();
}

$("taskList").addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  e.preventDefault();
  const id = b.dataset.id, a = b.dataset.a;

  if (a === "toggle") {
    pendingDeleteId = null;
    const was = isAchievedToday();
    const ids = S.todayChecks.ids, i = ids.indexOf(id);
    i >= 0 ? ids.splice(i, 1) : ids.push(id);
    const now = isAchievedToday(), t = today();
    if (now && !was) { S.achieved[t] = true; confetti(); }
    if (!now && was)  delete S.achieved[t];
    save(); render();
  } else if (a === "del") {
    pendingDeleteId = (pendingDeleteId === id) ? null : id;
    render();
  } else if (a === "delYes") {
    deleteTask(id);
  } else if (a === "delNo") {
    pendingDeleteId = null;
    render();
  }
});

// タスク追加
function addTask() {
  const inp = $("newTask"), text = inp.value.trim();
  if (!text) return;
  S.tasks.push({ id: "t" + (S.seq++), text });
  delete S.achieved[today()];
  inp.value = ""; save(); render();
}
$("addBtn").addEventListener("click", addTask);
$("newTask").addEventListener("keydown", e => { if (e.key === "Enter") addTask(); });

// メモ
$("dayMemo").addEventListener("input", e => {
  const t = today(), v = e.target.value;
  if (v.trim()) S.memos[t] = v; else delete S.memos[t];
  save(); renderMemoHistory();
});

$("memoSaveBtn").addEventListener("click", () => {
  const t = today(), v = $("dayMemo").value;
  if (v.trim()) S.memos[t] = v; else delete S.memos[t];
  save(); renderMemoHistory();
  showToast($("memoSavedMsg"), "✅ 保存しました");
});

// 月グループ開閉（memoMonthList にイベント委譲）
$("memoMonthList").addEventListener("click", e => {
  const hdr = e.target.closest("[data-toggle]");
  if (!hdr) return;
  const mk = hdr.dataset.toggle;
  openMonths.has(mk) ? openMonths.delete(mk) : openMonths.add(mk);
  renderMemoHistory();
});

// 人生の目標・羅針盤：ファイル読み込み・リセット
const renderGoalPage    = setupUploadableCard("goal", GOAL_KEY);
const renderCompassPage = setupUploadableCard("compass", COMPASS_KEY);

// ポモドーロ
$("pomoMain").addEventListener("click", () => {
  S.pomo.running ? pausePomo() : startPomo();
});
$("pomoSkip").addEventListener("click", skipPomoPhase);
$("pomoReset").addEventListener("click", resetPomo);
$("pomoPartialYes").addEventListener("click", recordPartialTime);
$("pomoPartialNo").addEventListener("click", () => {
  hidePomoBanner();
});


/* ============================================================
   PWA（マニフェスト & Service Worker）
   ============================================================ */

(function() {
  const manifest = {
    name: "TSUZUKU", short_name: "TSUZUKU",
    start_url: ".", display: "standalone",
    background_color: "#FFFFFF", theme_color: "#FFFFFF",
    icons: [{
      src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23FF6B2C'/%3E%3Ctext x='50' y='68' font-size='52' text-anchor='middle' fill='white'%3E🔥%3C/text%3E%3C/svg%3E",
      sizes: "any", type: "image/svg+xml",
    }],
  };
  $("manifest").href = "data:application/manifest+json," + encodeURIComponent(JSON.stringify(manifest));
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();


/* ============================================================
   起動処理
   ============================================================ */

S = load();
restorePomoFromEndAt();
rollover(); save(); render();
renderGoalPage();
renderCompassPage();
if (S.pomo.running) startPomoTick();

// 30秒ごとに日付変更チェック
setInterval(() => {
  if (S.todayChecks.date !== today()) { rollover(); render(); }
}, 30000);

// 画面復帰時（スマホでバックグラウンドから戻ったとき）
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  restorePomoFromEndAt();
  if (S.pomo.running) startPomoTick();
  renderPomo();
  if (S.todayChecks.date !== today()) { rollover(); render(); }
});
