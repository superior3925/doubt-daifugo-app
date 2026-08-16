// CPU自己対戦アリーナ（開発用。アプリ本体からは一切読み込まない）
//
// 目的：CPUのロジックを変更したときに「本当に強くなったのか」を数値で確かめる。
// index.html は1ブラウザで同期的に進行する設計なので、描画と待ち時間さえ差し替えれば
// そのままヘッドレスで高速に回せる。ここではエンジンには一切手を触れず、外側から
// タイマー・描画・永続化だけを置き換えて全席をCPUに任せる。
//
// 使い方（ローカルサーバでアプリを開いた状態で、devtoolsのコンソールから）：
//   await import('./scripts/arena.js');            // ← window.__arena が生える
//   __arena.duel('legend','elite', {seats:4, jokers:2, doubt:true, chaos:false}, 5000);
//   __arena.baseline();                            // 3段階の総当たり
//   __arena.uninstall();                           // 元に戻す
//
// 注意：ラッパを二重に積むと計測が壊れる（過去に、積み残したラッパのせいで発動率が
// 実際の1/10に見えた事故がある）。install()は二重適用を拒否するので、作り直したい
// ときは必ずページをリロードしてから読み込むこと。

(function(){
  if(window.__arena){ console.warn('[arena] 既にインストール済み。作り直すならリロードしてください'); return; }

  // ---- let/const で宣言されたトップレベル束縛は window に載らないため、
  //      グローバルスコープで作った getter/setter 経由で読み書きする ----
  const G = window.eval(`({
    get cpuLevel(){return cpuLevel}, set cpuLevel(v){cpuLevel=v},
    get mySeat(){return mySeat}, set mySeat(v){mySeat=v},
    get seatCount(){return seatCount}, set seatCount(v){seatCount=v},
    get seatNames(){return seatNames}, set seatNames(v){seatNames=v},
    get onlineRole(){return onlineRole}, set onlineRole(v){onlineRole=v},
    get rules(){return rules}, set rules(v){rules=v},
    get jokerCount(){return jokerCount}, set jokerCount(v){jokerCount=v},
    get previousFinishedOrder(){return previousFinishedOrder}, set previousFinishedOrder(v){previousFinishedOrder=v},
    get RULE_DEFS(){return RULE_DEFS},
    get Feedback(){return Feedback},
    get field(){return field},
    get hands(){return hands},
    get outs(){return outs},
    get gameOver(){return gameOver},
    get finishedOrder(){return finishedOrder},
    get currentPlayerIndex(){return currentPlayerIndex},
    get passStreak(){return passStreak}
  })`);

  // ---- 仮想時計：実時間を待たず、最も早いタイマーを取り出して進める ----
  let vt = 0, seq = 0;
  const timers = new Map();
  const realSetTimeout = window.setTimeout, realClearTimeout = window.clearTimeout;
  window.setTimeout = function(fn, ms){
    const id = ++seq;
    timers.set(id, {t: vt + (Number(ms) || 0), fn: fn, args: Array.prototype.slice.call(arguments, 2)});
    return id;
  };
  window.clearTimeout = function(id){ timers.delete(id); };
  function step(){
    if(!timers.size) return false;
    let bestId = null, best = null;
    for(const e of timers){
      if(best === null || e[1].t < best.t || (e[1].t === best.t && e[0] < bestId)){ best = e[1]; bestId = e[0]; }
    }
    timers.delete(bestId);
    vt = best.t;
    best.fn.apply(null, best.args);
    return true;
  }

  // ---- 描画・効果音・永続化のスタブ（盤面の進行そのものには関与しない処理） ----
  const noop = function(){};
  const stubbed = {};
  ['render','log','showCutIn','updateDiscardPileButton','renderChaosRecent',
   'addSeasonScore','recordCareerResult','saveSeasonScores','markCloudDocChanged','renderSeasonScores']
   .forEach(function(n){ if(typeof window[n] === 'function'){ stubbed[n] = window[n]; window[n] = noop; } });
  if(G.Feedback) G.Feedback.sfx = noop;

  // ---- 決着の捕捉。showResults はゲーム終了の全経路から呼ばれる唯一の締め ----
  let result = null;
  const origShowResults = window.showResults;
  window.showResults = function(){
    if(!result) result = {ranking: window.computeFinalRanking().slice()};
  };

  // ---- 席ごとに違うCPU段階を割り当てる ----
  // cpuLevel はグローバル1個なので、席の判断に入る直前だけその席の段階に差し替え、
  // 抜けるときに必ず戻す。差し替え対象は「席番号を受け取るCPUの入口」すべて。
  let seatLevels = null;
  function withSeat(seat, fn, self, args){
    if(!seatLevels || seat == null || seat < 0 || !seatLevels[seat]) return fn.apply(self, args);
    const prev = G.cpuLevel;
    G.cpuLevel = seatLevels[seat];
    try { return fn.apply(self, args); } finally { G.cpuLevel = prev; }
  }
  const origFns = {};
  function wrapSeat(name, pickSeat){
    const f = window[name];
    if(typeof f !== 'function') throw new Error('[arena] 関数が見つかりません: ' + name);
    origFns[name] = f;
    window[name] = function(){ return withSeat(pickSeat.apply(null, arguments), f, this, arguments); };
  }
  const firstArg = function(a){ return a; };
  wrapSeat('cpuTurn', firstArg);            // 出す/パス/ダウト/宣言/特殊カード発動
  wrapSeat('cpuDoGive', firstArg);          // 7渡し
  wrapSeat('cpuDoDiscard', firstArg);       // 10捨て
  wrapSeat('cpuDoBomber', firstArg);        // 12ボンバー
  wrapSeat('cpuChaosSelection', firstArg);  // カオス特殊カードの選択
  wrapSeat('cpuPickExchangeCards', function(task){ return task ? task.giver : null; });

  // ---- 種付き乱数。同じ種なら配牌が完全に一致するので、変種同士を
  //      「同じ配牌の下で」比較できる（分散が大きく下がる） ----
  const realRandom = Math.random;
  function mulberry32(a){
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 対局条件 ----
  // 既定は全ルール有効。cfg.ruleOverrides で個別に上書きできる。
  function applyConfig(cfg){
    G.onlineRole = 'offline';
    G.mySeat = -1;                    // 自席を無くして全席を local-cpu にする
    G.seatCount = cfg.seats;
    G.seatNames = Array.from({length: cfg.seats}, function(_, i){ return 'P' + i; });
    const r = {};
    G.RULE_DEFS.forEach(function(d){ r[d.key] = true; });
    r.jokers = cfg.jokers > 0;
    r.jokerCountRandom = false;
    r.jokerCount = cfg.jokers > 0 ? cfg.jokers : 2;
    r.doubtMode = !!cfg.doubt;
    r.chaosMode = !!cfg.chaos;
    r.openDoubt = false;              // 人間向けの手番外ダウト猶予は使わない
    r.doubtWindowSec = 3;
    if(cfg.ruleOverrides) Object.assign(r, cfg.ruleOverrides);
    G.rules = r;
    G.jokerCount = r.jokerCount;
    G.previousFinishedOrder = null;   // 毎回フレッシュな配牌（カード交換の持ち越しなし）
  }

  // ---- 1戦。levels は席→段階の配列 ----
  const MAX_STEPS = 30000;
  function playOne(levels, seed){
    seatLevels = levels;
    timers.clear(); vt = 0; result = null;
    Math.random = mulberry32(seed);
    let steps = 0, err = null;
    try {
      window.startGame();
      while(!result && steps < MAX_STEPS){ if(!step()) break; steps++; }
    } catch(e){ err = (e && e.message) ? e.message : String(e); }
    const out = {steps: steps, err: err, ranking: result ? result.ranking : null};
    if(!out.ranking && !err){
      out.stuck = {hands: G.hands.map(function(h){ return h.length; }),
                   finished: G.finishedOrder.slice(), passStreak: G.passStreak};
    }
    return out;
  }

  // ---- 2陣営の直接対決。席数は偶数を前提に、各陣営が半数の席を持つ ----
  // 順位の合計は毎戦固定なので、片側の平均順位の分散からそのまま標準誤差が出る。
  // 平均順位は小さいほど強い。差 = A - B なので、差<0 なら A の勝ち。|z|>2 で有意。
  function duel(roleA, roleB, cfg, games, seed){
    applyConfig(cfg);
    const n = cfg.seats, half = n / 2;
    let sum = 0, sumSq = 0, used = 0, inc = 0, err = 0, firstA = 0, firstB = 0;
    const stuck = [];
    for(let g = 0; g < games; g++){
      const roles = [];
      for(let s = 0; s < n; s++) roles[s] = ((s + g) % 2 === 0) ? roleA : roleB;
      const r = playOne(roles, (seed || 0) + g);
      if(r.err){ err++; continue; }
      if(!r.ranking){ inc++; if(stuck.length < 2) stuck.push(r.stuck); continue; }
      let pa = 0;
      r.ranking.forEach(function(seat, pos){
        if(roles[seat] === roleA){ pa += pos; if(pos === 0) firstA++; }
        else if(pos === 0){ firstB++; }
      });
      const m = pa / half;
      sum += m; sumSq += m * m; used++;
    }
    const mean = sum / used;
    const sd = Math.sqrt(Math.max(0, sumSq / used - mean * mean));
    const se = sd / Math.sqrt(used);
    const neutral = (n - 1) / 2;
    const o = {games: used, incomplete: inc, errors: err};
    o[roleA + '_平均順位'] = +mean.toFixed(4);
    o[roleB + '_平均順位'] = +(2 * neutral - mean).toFixed(4);
    o['差'] = +(2 * (mean - neutral)).toFixed(4);
    o['SE'] = +(2 * se).toFixed(4);
    o['z'] = +((mean - neutral) / se).toFixed(2);
    o[roleA + '_1位率%'] = +(100 * firstA / used).toFixed(1);
    o[roleB + '_1位率%'] = +(100 * firstB / used).toFixed(1);
    if(stuck.length) o.stuck = stuck;
    return o;
  }

  // ---- 3段階の総当たりを主要3モードで ----
  function baseline(games){
    const N = games || 5000;
    const modes = {
      '通常': {seats: 4, jokers: 2, doubt: false, chaos: false},
      'ダウト': {seats: 4, jokers: 2, doubt: true, chaos: false},
      'カオス': {seats: 4, jokers: 2, doubt: true, chaos: true}
    };
    const pairs = [['legend','elite'], ['legend','normal'], ['elite','normal']];
    const out = {};
    Object.keys(modes).forEach(function(m){
      out[m] = {};
      pairs.forEach(function(p, i){
        out[m][p[0] + ' vs ' + p[1]] = duel(p[0], p[1], modes[m], N, 40000 + i * 100000);
      });
    });
    return out;
  }

  function uninstall(){
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
    Math.random = realRandom;
    Object.keys(stubbed).forEach(function(n){ window[n] = stubbed[n]; });
    Object.keys(origFns).forEach(function(n){ window[n] = origFns[n]; });
    window.showResults = origShowResults;
    delete window.__arena;
  }

  window.__arena = {duel: duel, baseline: baseline, playOne: playOne,
                    applyConfig: applyConfig, uninstall: uninstall, G: G};
  console.log('[arena] インストール完了。__arena.duel(...) / __arena.baseline() が使えます');
})();
