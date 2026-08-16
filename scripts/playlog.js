// 実戦の記録係（開発用。アプリ本体からは一切読み込まない）
//
// 目的：CPU同士の自己対戦（scripts/arena.js）では原理的に見つからない弱点を、
// 人間との実戦から拾う。自己対戦は全CPUが同じ盲点を共有しているので、その盲点は
// 「弱点」として現れない。あなたが勝ち続けている理由は、あなたの対局にしか映らない。
//
// 使い方（ローカルサーバでアプリを開いた状態で、devtoolsのコンソールから）：
//   await import('./scripts/playlog.js');   // ← 以後の対局が自動で記録される
//   __playlog.summary();                    // 途中経過（あなたの成績と、疑わしい判断の数）
//   __playlog.save();                       // JSONファイルとして書き出す
//   __playlog.reset();                      // 記録を消す
//
// 記録はlocalStorageに追記されるので、ページを再読み込みしても消えない。
// そのまま何戦か遊んで、最後にsave()したものを渡してもらえれば解析できる。
//
// 秘匿について：これは「あなたの端末に残る、あなたのための解析用データ」であって、
// 対局中の画面には一切出さない。ただし中身は全席の手札を含む完全な情報なので、
// 対局中にこのログを覗くのはカンニングになる。見るのは対局が終わってから。

(function(){
  if(window.__playlog){ console.warn('[playlog] 既に有効です'); return; }

  const KEY = 'ddf_playlog_v1';
  // let/const で宣言されたトップレベル束縛は window に載らないので、グローバルスコープで
  // 作った getter 経由で読む（scripts/arena.js と同じ手口）。
  const G = window.eval(`({
    get hands(){return hands},
    get field(){return field},
    get outs(){return outs},
    get cpuLevel(){return cpuLevel},
    get mySeat(){return mySeat},
    get seatCount(){return seatCount},
    get rules(){return rules},
    get finishedOrder(){return finishedOrder},
    get currentPlayerIndex(){return currentPlayerIndex},
    get trickIndex(){return trickIndex},
    get revolution(){return revolution},
    get chaosHands(){return chaosHands}
  })`);

  let log = [];
  try { const raw = localStorage.getItem(KEY); if(raw) log = JSON.parse(raw) || []; } catch(e){}
  let game = null;
  let saveTimer = null;
  function persist(){
    // 1手ごとに書くとJSON化が重いので、少し溜めてから書く。
    if(saveTimer) return;
    saveTimer = setTimeout(function(){
      saveTimer = null;
      try { localStorage.setItem(KEY, JSON.stringify(log)); }
      catch(e){ console.warn('[playlog] 保存できませんでした（容量超過？）', e); }
    }, 500);
  }

  // 手札は「ランク→枚数」に畳んで記録する。スートは読み合いにほぼ効かないので落とす
  // （ファイルサイズを抑えるため。しばりの判断を追いたくなったら戻す）。
  function foldHand(cards){
    const m = {};
    (cards||[]).forEach(function(c){ m[c.rank] = (m[c.rank]||0)+1; });
    return m;
  }
  function snapshot(){
    return {
      t: G.trickIndex,
      turn: G.currentPlayerIndex,
      rev: !!G.revolution,
      hands: (G.hands||[]).map(function(h){ return h.length; }),
      outs: (G.outs||[]).slice(0, G.seatCount),
      field: G.field ? {rank:G.field.rank, count:G.field.count, owner:G.field.owner,
                        faceDown:!!G.field.faceDown} : null
    };
  }
  function startGame(){
    game = {
      started: new Date().toISOString(),
      cpuLevel: G.cpuLevel,
      seats: G.seatCount,
      mySeat: G.mySeat,
      rules: {doubt:!!G.rules.doubtMode, chaos:!!G.rules.chaosMode,
              jokers:G.rules.jokers ? (G.rules.jokerCount||2) : 0},
      // 配牌を残しておくと、あとから同じ局面を再現して「最善手は何だったか」を検討できる。
      deal: (G.hands||[]).map(foldHand),
      events: [],
      result: null
    };
    log.push(game);
    persist();
  }
  function ev(kind, data){
    if(!game) return;
    game.events.push(Object.assign({k:kind, s:snapshot()}, data||{}));
    persist();
  }

  const orig = {};
  function hook(name, make){
    if(typeof window[name] !== 'function') return;
    orig[name] = window[name];
    window[name] = make(orig[name]);
  }

  hook('startGame', function(o){ return function(){ const r=o.apply(this,arguments); startGame(); return r; }; });
  hook('startGameWithExchange', function(o){ return function(){ const r=o.apply(this,arguments); startGame(); return r; }; });

  // CPUが手を確定する瞬間。宣言と実札の両方を残す（伏せた札の正体もここに入る）。
  hook('cpuCommitPlay', function(o){ return function(idx, decl, actual){
    ev('play', {seat:idx, by:'cpu', level:G.cpuLevel,
                decl:(decl||[]).map(c=>c.rank),
                actual:(actual||decl||[]).map(c=>c.rank),
                lie: !!(actual && !window.isDeclarationTruthful(decl, actual)),
                hand: foldHand(G.hands[idx])});
    return o.apply(this, arguments);
  }; });
  // あなたの手。CPUの手と同じ形で残すので、同じ局面での選択を突き合わせられる。
  hook('resolvePlayCore', function(o){ return function(idx, decl, eb, actual){
    if(idx===G.mySeat){
      ev('play', {seat:idx, by:'human',
                  decl:(decl||[]).map(c=>c.rank),
                  actual:(actual||decl||[]).map(c=>c.rank),
                  lie: !!(actual && !window.isDeclarationTruthful(decl, actual)),
                  hand: foldHand(G.hands[idx])});
    }
    return o.apply(this, arguments);
  }; });
  hook('passAction', function(o){ return function(idx){
    ev('pass', {seat:idx, by: idx===G.mySeat ? 'human' : 'cpu', hand: foldHand(G.hands[idx])});
    return o.apply(this, arguments);
  }; });
  hook('doubtAction', function(o){ return function(idx){
    const f = G.field;
    ev('doubt', {seat:idx, by: idx===G.mySeat ? 'human' : 'cpu',
                 target: f ? f.owner : null,
                 decl: f ? (f.cards||[]).map(c=>c.rank) : null,
                 actual: f ? (f.actual||[]).map(c=>c.rank) : null,
                 correct: f ? !window.isDeclarationTruthful(f.cards, f.actual) : null});
    return o.apply(this, arguments);
  }; });
  hook('addOut', function(o){ return function(idx, reason){
    ev('out', {seat:idx, reason:String(reason||'')});
    return o.apply(this, arguments);
  }; });
  hook('chaosUseCard', function(o){ return function(seat, card){
    ev('chaos', {seat:seat, by: seat===G.mySeat ? 'human' : 'cpu',
                 type: card && card.type,
                 held: (G.chaosHands[seat]||[]).map(c=>c.type)});
    return o.apply(this, arguments);
  }; });
  hook('showResults', function(o){ return function(){
    if(game && !game.result){
      game.result = {ranking: window.computeFinalRanking().slice(),
                     myPlace: window.computeFinalRanking().indexOf(G.mySeat)};
      persist();
    }
    return o.apply(this, arguments);
  }; });

  function finished(){ return log.filter(function(g){ return g.result; }); }

  window.__playlog = {
    get raw(){ return log; },
    // ざっくりした現状。あなたの順位分布と、CPUの判断のうち検討に値するものの件数。
    summary: function(){
      const done = finished();
      const byLevel = {};
      done.forEach(function(g){
        const k = g.cpuLevel + (g.rules.chaos ? '/カオス' : (g.rules.doubt ? '/ダウト' : '/通常'));
        if(!byLevel[k]) byLevel[k] = {games:0, placeSum:0, wins:0, lasts:0};
        const b = byLevel[k];
        b.games++; b.placeSum += g.result.myPlace;
        if(g.result.myPlace===0) b.wins++;
        if(g.result.myPlace===g.seats-1) b.lasts++;
      });
      const out = {};
      Object.keys(byLevel).forEach(function(k){
        const b = byLevel[k];
        out[k] = {対戦数:b.games, 平均順位:+(b.placeSum/b.games).toFixed(2),
                  '1位率%':+(100*b.wins/b.games).toFixed(1),
                  '最下位率%':+(100*b.lasts/b.games).toFixed(1)};
      });
      console.log('記録済み', done.length, '戦（未完走を含む総数', log.length, '）');
      console.table(out);
      return out;
    },
    save: function(){
      const blob = new Blob([JSON.stringify(log, null, 1)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'daifugo-playlog.json';
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
      console.log('[playlog]', log.length, '戦ぶんを書き出しました');
    },
    reset: function(){ log = []; try{ localStorage.removeItem(KEY); }catch(e){} console.log('[playlog] 記録を消しました'); },
    uninstall: function(){
      Object.keys(orig).forEach(function(n){ window[n] = orig[n]; });
      delete window.__playlog;
    }
  };
  console.log('[playlog] 記録を開始しました（既存 '+log.length+' 戦）。'
            + 'あとで __playlog.summary() / __playlog.save() を実行してください');
})();
