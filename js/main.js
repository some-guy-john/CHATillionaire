const screenEl = document.getElementById('screen');
const connStatusEl = document.getElementById('conn-status');
const connLabelEl = document.getElementById('conn-label');
let currentViewKey = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function initials(name) {
  return String(name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
}

function playerKey(name) {
  return String(name).toLowerCase();
}

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  return minutes ? `${minutes}:${String(safe % 60).padStart(2, '0')}` : `${safe}s`;
}

function setConnection(connected) {
  const mode = typeof connected === 'string' ? connected : connected ? 'online' : 'offline';
  connStatusEl.classList.toggle('conn-status--on', mode === 'online');
  connStatusEl.classList.toggle('conn-status--off', mode !== 'online');
  connLabelEl.textContent = mode === 'online' ? 'Room is live!' : mode === 'reconnecting' ? 'Reconnecting...' : mode === 'connecting' ? 'Connecting...' : 'Getting things ready';
}

function bindKickButtons() {
  document.querySelectorAll('[data-kick-player]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const playerName = button.dataset.playerName || 'this player';
      if (!window.confirm(`Kick ${playerName} from the room?`)) return;
      button.disabled = true;
      button.textContent = '...';
      try {
        await Game.kickPlayer(button.dataset.kickPlayer);
      } catch {
        button.disabled = false;
        button.textContent = 'Kick';
      }
    });
  });
}

function kickButton(player, canKick) {
  if (!canKick || player.is_host_player) return '';
  const safeName = escapeHtml(player.name);
  return `<button class="kick-player" type="button" data-kick-player="${escapeHtml(player.id)}" data-player-name="${safeName}" aria-label="Kick ${safeName}">Kick</button>`;
}

function renderPlayerRoster(state, showResults = false, canKick = false) {
  const rankedPlayers = [...state.players].sort((a, b) => (
    Number(b.alive) - Number(a.alive)
    || b.score - a.score
    || a.name.localeCompare(b.name)
  ));
  const alive = rankedPlayers.filter(player => player.alive);
  const results = new Map((state.lastResult?.playerResults || []).map(result => [playerKey(result.name), result]));

  function renderPlayer(player, isAlive) {
    const result = results.get(playerKey(player.name));
    const voted = state.votes.has(playerKey(player.name));
    const newlyEliminated = showResults && result && !result.correct;
    const revealBonk = state.phase === 'reveal'
      && state.revealLastVerdictIndex !== null
      && state.revealLastVerdictIndex !== undefined
      && result
      && result.vote === state.revealLastVerdictIndex
      && !result.correct;
    let status = '';
    if (showResults && result) {
      status = result.correct
        ? '<span class="vote-result vote-result--good">Nailed it!</span>'
        : `<span class="vote-result vote-result--bad">${result.vote === null ? 'No answer' : 'Bonked'}</span>`;
    } else if (revealBonk) {
      status = '<span class="vote-result vote-result--bad">Bonked!</span>';
    } else if (isAlive && voted) {
      status = '<span class="vote-check" title="Vote locked in" aria-label="Vote locked in">&#10003;</span>';
    } else if (!isAlive) {
      status = '<span class="vote-result vote-result--bad">Eliminated</span>';
    }

    const safeName = escapeHtml(player.name);
    const gagClass = revealBonk && state.revealGag ? `gag-${state.revealGag}` : '';
    const nameMarkup = newlyEliminated || revealBonk
      ? `<span class="player-name-fx ${gagClass}" aria-label="${safeName}"><span class="name-half name-half--left" aria-hidden="true">${safeName}</span><span class="name-half name-half--right" aria-hidden="true">${safeName}</span></span>`
      : `<span class="player-name">${safeName}</span>`;
    const kick = kickButton(player, canKick);

    return `<div class="player-row ${isAlive ? '' : 'player-row--out'} ${newlyEliminated || revealBonk ? 'player-row--new-out' : ''}">
      <span class="pname"><span class="avatar ${isAlive ? '' : 'dead'}">${initials(player.name)}</span>${nameMarkup}</span>
      <span class="player-meta"><span class="player-score">${player.score} pts</span>${status}${kick}</span>
    </div>`;
  }

  return `<aside class="players-panel" id="players-panel">
    <div class="players-heading"><span>Who's still in?</span><strong>${alive.length} alive &middot; ${state.players.length} total</strong></div>
    <div class="player-group-label">Leaderboard &middot; alive first</div>
    <div class="player-list">${rankedPlayers.length ? rankedPlayers.map(player => renderPlayer(player, player.alive)).join('') : '<div class="player-empty">Nobody left standing!</div>'}</div>
  </aside>`;
}

function copyJoinLink() {
  const link = document.getElementById('join-link');
  if (!link) return;
  const copied = () => {
    const button = document.getElementById('copy-link');
    if (!button) return;
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
  };
  const failed = () => {
    link.focus();
    link.select();
    const status = document.getElementById('copy-status');
    if (status) status.textContent = 'Copy was blocked. The link is selected so you can copy it manually.';
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link.value).then(copied, failed);
  else failed();
}

function hostPlayerUrl(state) {
  const url = new URL(state.joinUrl);
  url.searchParams.set('host', '1');
  return url.href;
}

function renderJoinQr(state) {
  const canvas = document.getElementById('join-qr');
  const status = document.getElementById('qr-status');
  if (!canvas) return;
  const showFailure = () => {
    canvas.hidden = true;
    if (status) {
      status.textContent = 'QR unavailable. Use the link below.';
      status.hidden = false;
    }
  };
  if (!window.QRCode) {
    showFailure();
    return;
  }
  canvas.hidden = false;
  try {
    QRCode.toCanvas(canvas, state.joinUrl, {
      width: 156,
      margin: 1,
      color: { dark: '#29233d', light: '#fffaf0' }
    }).then(() => {
      if (status) status.hidden = true;
    }).catch(showFailure);
  } catch (error) {
    showFailure();
  }
}

function renderSetup(state) {
  screenEl.innerHTML = `
    <div class="intro-layout">
      <form class="intro-copy" id="setup-form">
        <p class="eyebrow">Welcome to the quiz party</p>
        <h1>Put chat in the <em>hot seat!</em></h1>
        <p class="small">Create a room, share the player link, and let your audience battle from their own phones while you run the show.</p>
        <div class="row">
          <div class="field">
            <label for="in-rounds">How many rounds?</label>
            <input id="in-rounds" type="number" min="1" max="10" value="${state.config.totalRounds}">
          </div>
          <div class="field">
            <label for="in-timer">Seconds to answer</label>
            <input id="in-timer" type="number" min="5" max="120" value="${state.config.timerSeconds}">
          </div>
        </div>
        <div class="checkfield">
          <input id="in-speedup" type="checkbox" ${state.config.speedupEnabled ? 'checked' : ''}>
          <label for="in-speedup">Make it spicy when half has voted</label>
        </div>
        <div class="checkfield">
          <input id="in-sfx" type="checkbox" ${state.config.sfxEnabled ? 'checked' : ''}>
          <label for="in-sfx">Play goofy game-show sound effects</label>
        </div>
        <p id="setup-error" class="small setup-error" role="alert" ${state.error ? '' : 'hidden'}>${escapeHtml(state.error || '')}</p>
        <button class="primary full" id="btn-create" type="submit">Make a room!</button>
      </form>
      <aside class="briefing" aria-label="How the game works">
        <div class="briefing-heading"><span>How to play</span><span>no login fuss</span></div>
        <div class="briefing-list">
          <div class="briefing-item"><b>1</b><span>Make a room and share the player link.</span></div>
          <div class="briefing-item"><b>2</b><span>Viewers pick a nickname and answer on their phones.</span></div>
          <div class="briefing-item"><b>3</b><span>You get the big reveal. They get the panic.</span></div>
        </div>
      </aside>
    </div>
  `;

  document.getElementById('setup-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const button = document.getElementById('btn-create');
    button.disabled = true;
    try {
      await Game.createRoom({
        totalRounds: Number(document.getElementById('in-rounds').value) || 10,
        timerSeconds: Number(document.getElementById('in-timer').value) || 30,
        speedupEnabled: document.getElementById('in-speedup').checked,
        sfxEnabled: document.getElementById('in-sfx').checked
      });
    } catch (error) {
      button.disabled = false;
      const errorEl = document.getElementById('setup-error');
      errorEl.textContent = error.message || 'Could not make the room.';
      errorEl.hidden = false;
    }
  });
}

function renderLobby(state) {
  const countdown = state.lobbyStage === 'countdown';
  const lobbyText = countdown
    ? `The room starts in ${formatSeconds(state.lobbySeconds)}. More players can still jump in!`
    : `Waiting for player two. This room will start solo after ${formatSeconds(state.lobbySeconds)}.`;
  screenEl.innerHTML = `
    <p class="eyebrow">Room ${escapeHtml(state.roomCode)}</p>
    <h1>${countdown ? 'The countdown is on!' : 'Send in the players!'}</h1>
    <p class="small" id="lobby-copy" style="margin:0 0 22px;">${lobbyText}</p>
    <div class="share-card">
      <div class="share-heading"><span><span class="share-label">Player join link</span><strong>Scan or share this with chat</strong></span><span class="qr-wrap"><canvas id="join-qr" width="156" height="156" aria-label="QR code for the player join link"></canvas><span id="qr-status" class="qr-status" role="status" hidden></span></span></div>
      <div class="share-controls"><input id="join-link" type="text" readonly value="${escapeHtml(state.joinUrl)}"><button id="copy-link">Copy link</button></div>
      <span id="copy-status" class="muted" role="status"></span>
      <strong>Room code: ${escapeHtml(state.roomCode)}</strong>
      <a class="secondary-action" href="${escapeHtml(hostPlayerUrl(state))}" target="_blank" rel="noopener">Play on this device &rarr;</a>
    </div>
    <div class="list lobby-list" id="lobby-player-list">
      ${state.players.length
        ? state.players.map(player => `<div class="list-row"><span class="pname"><span class="avatar">${initials(player.name)}</span><span>${escapeHtml(player.name)}</span></span><span class="lobby-player-actions"><span class="pill pill--accent">ready</span>${kickButton(player, state.kickEnabled)}</span></div>`).join('')
        : '<div class="list-row"><span class="muted">It is quiet in here... share the link!</span></div>'}
    </div>
    <div class="live-board">
      <div class="stat"><strong id="lobby-player-count">${state.players.length}</strong><span>Players in</span></div>
      <div class="stat"><strong>${state.totalRounds}</strong><span>Rounds of chaos</span></div>
      <div class="stat"><strong id="lobby-time">${formatSeconds(state.lobbySeconds)}</strong><span>Lobby time</span></div>
    </div>
  `;
  document.getElementById('copy-link').addEventListener('click', copyJoinLink);
  bindKickButtons();
  renderJoinQr(state);
}

function updateLobby(state) {
  const countdown = state.lobbyStage === 'countdown';
  document.getElementById('lobby-copy').textContent = countdown
    ? `The room starts in ${formatSeconds(state.lobbySeconds)}. More players can still jump in!`
    : `Waiting for player two. This room will start solo after ${formatSeconds(state.lobbySeconds)}.`;
  document.getElementById('lobby-player-count').textContent = state.players.length;
  document.getElementById('lobby-time').textContent = formatSeconds(state.lobbySeconds);
  document.getElementById('lobby-player-list').innerHTML = state.players.length
     ? state.players.map(player => `<div class="list-row"><span class="pname"><span class="avatar">${initials(player.name)}</span><span>${escapeHtml(player.name)}</span></span><span class="lobby-player-actions"><span class="pill pill--accent">ready</span>${kickButton(player, state.kickEnabled)}</span></div>`).join('')
    : '<div class="list-row"><span class="muted">It is quiet in here... share the link!</span></div>';
  bindKickButtons();
}

function renderVoting(state) {
  const q = state.currentQuestion;
  const alive = state.players.filter(player => player.alive).length;
  const answered = state.votes.size;
  const pct = alive > 0 ? Math.round((answered / alive) * 100) : 0;
  screenEl.innerHTML = `<div class="game-layout">
    <section class="question-panel">
      <div class="round-meta"><p class="eyebrow" style="margin:0;">Round ${state.roundNumber} / ${state.totalRounds}</p><span class="pill pill--accent" id="alive-count">${alive} alive</span></div>
      <div class="question-heading"><h1>${escapeHtml(q.question)}</h1></div>
      <div class="answer-grid">${q.options.map((option, index) => `<div class="opt"><span class="letter">${'ABCD'[index]}</span><span>${escapeHtml(option)}</span></div>`).join('')}</div>
      <div class="timer-row"><span id="host-vote-count">${answered}/${alive} locked in</span><span id="host-time-left" class="time-left ${state.timeLeft <= 5 ? 'time-left--urgent' : ''}">${state.timeLeft}s left</span></div>
      <div class="progress-track"><div class="progress-fill" id="host-vote-progress" style="width:${pct}%"></div></div>
      <div class="actions"><span class="small">Viewers answer on the join page</span><button id="btn-force">Reveal it!</button></div>
    </section>
    ${renderPlayerRoster(state, false, state.kickEnabled)}
  </div>`;
  document.getElementById('btn-force').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Closing...';
    try { await Game.forceEndRound(); } catch { event.currentTarget.disabled = false; event.currentTarget.textContent = 'Reveal it!'; }
  });
  bindKickButtons();
}

function updateVoting(state) {
  const alive = state.players.filter(player => player.alive).length;
  const answered = state.votes.size;
  const pct = alive > 0 ? Math.round((answered / alive) * 100) : 0;
  document.getElementById('alive-count').textContent = `${alive} alive`;
  document.getElementById('host-vote-count').textContent = `${answered}/${alive} locked in`;
  const timer = document.getElementById('host-time-left');
  timer.textContent = `${state.timeLeft}s left`;
  timer.classList.toggle('time-left--urgent', state.timeLeft <= 5);
  document.getElementById('host-vote-progress').style.width = `${pct}%`;
  const roster = document.getElementById('players-panel');
  if (roster) {
    roster.outerHTML = renderPlayerRoster(state, false, state.kickEnabled);
    bindKickButtons();
  }
}

function renderReveal(state) {
  const { question, correctIndex, eliminated } = state.lastResult;
  const revealed = state.revealedIndices || new Set();
  const verdicts = state.revealVerdicts || new Set();
  const lastVerdictIndex = state.revealLastVerdictIndex;
  const finished = state.revealComplete;
  const spotlightVoters = lastVerdictIndex === null || lastVerdictIndex === undefined ? [] : state.lastResult.playerResults.filter(result => result.vote === lastVerdictIndex);
  const showSpotlight = !finished && lastVerdictIndex !== null && lastVerdictIndex !== undefined && spotlightVoters.length > 0;
  const spotlightCorrect = lastVerdictIndex === correctIndex;
  const gag = Gags.get(state.revealGag);
  const scoreByName = new Map(state.players.map(player => [playerKey(player.name), player.score]));
  const variantStyle = state.revealVariant ? Object.entries(state.revealVariant.vars).map(([key, value]) => `${key}:${value}`).join(';') : '';
  const variantFlip = state.revealVariant && state.revealVariant.flip ? ' flip' : '';
  const shownVoters = spotlightVoters.slice(0, 6);
  const extraVoters = spotlightVoters.length - shownVoters.length;
  const victimCard = result => `<span class="victim gag-${state.revealGag}${variantFlip}" style="${variantStyle}"><span class="victim-card"><span class="vface">${initials(result.name)}</span><span class="vname">${escapeHtml(result.name)}</span><span class="vpts">${scoreByName.get(playerKey(result.name)) || 0} pts</span></span><span class="fx" aria-hidden="true"><span class="prop p1">${gag.props[0] || ''}</span><span class="prop p2">${gag.props[1] || ''}</span><span class="door door-l"></span><span class="door door-r"></span></span><span class="shout" aria-hidden="true">${gag.shout}</span></span>`;
  const spotlight = showSpotlight ? `<div class="reveal-spotlight ${spotlightCorrect ? 'reveal-spotlight--correct' : 'reveal-spotlight--wrong'}" role="status"><span class="spotlight-eyebrow">${escapeHtml(String(gag.label || '').toUpperCase())}</span><strong>${spotlightCorrect ? 'Look at these geniuses!' : `Oh no... ${'ABCD'[lastVerdictIndex]} was a trap!`}</strong><span class="spotlight-copy">${spotlightCorrect ? 'Correctly chosen by:' : `Chosen by ${spotlightVoters.length === 1 ? 'this brave soul' : 'these brave souls'}:`}</span><span class="spotlight-names">${shownVoters.map(victimCard).join('')}${extraVoters > 0 ? `<span class="victims-more">+${extraVoters} more</span>` : ''}</span><span class="spotlight-punchline">${escapeHtml(state.revealLine || '')}</span></div>` : '';
  const countdown = state.autoNextAt ? Math.max(0, Math.ceil((state.autoNextAt - Date.now()) / 1000)) : 4;
  const gameWillEnd = state.roundNumber >= state.totalRounds || state.players.every(player => !player.alive);

  screenEl.innerHTML = `<div class="game-layout"><section class="question-panel reveal-panel"><p class="eyebrow">${finished ? 'The big reveal!' : showSpotlight ? 'The bonk has landed!' : revealed.size ? 'Ooooh, not that one...' : 'The cards are thinking...'}</p><p class="reveal-mode">${escapeHtml(state.revealMode || 'mystery mode')}</p><h1>${escapeHtml(question.question)}</h1><div class="answer-grid">${question.options.map((option, index) => { const isRevealed = revealed.has(index); const hasVerdict = verdicts.has(index); const correct = index === correctIndex; const voters = state.lastResult.playerResults.filter(result => result.vote === index); const cardClass = hasVerdict ? (correct ? 'is-correct' : 'is-wrong') : isRevealed ? 'is-showing-voters' : 'is-pending'; const count = finished ? ` <span class="vote-count">${state.lastResult.voteCounts[index]} vote${state.lastResult.voteCounts[index] === 1 ? '' : 's'}</span>` : ''; const tag = hasVerdict && correct ? 'Nailed it!' : hasVerdict ? 'Bonked!' : 'Who picked this?'; const voterText = isRevealed ? voters.length ? voters.map(result => `<span class="voter-name">${escapeHtml(result.name)}</span>`).join('<span class="voter-comma">, </span>') : '<span class="voter-name voter-name--nobody">Nobody!</span>' : '<span class="voter-name voter-name--sealed">Vote sealed</span>'; return `<div class="opt reveal-card ${cardClass} ${lastVerdictIndex === index ? 'is-fresh-verdict' : ''}"><span class="letter">${'ABCD'[index]}</span><span class="answer-copy"><strong>${escapeHtml(option)}</strong><span class="voter-line">${tag} <span class="voter-names">${voterText}</span></span>${count}</span></div>`; }).join('')}</div>${spotlight}${finished ? `<div class="reveal-verdict"><strong>${eliminated.length ? `${eliminated.length} player${eliminated.length === 1 ? '' : 's'} got bonked.` : 'Everybody nailed it!'}</strong><span>${gameWillEnd ? 'Final results' : 'Next question'} in <span id="auto-next-countdown">${countdown}</span>s.</span></div>` : '<div class="reveal-dots" aria-label="Reveal in progress"><span></span><span></span><span></span></div>'}</section>${renderPlayerRoster(state, finished)}</div>`;
}

function renderGameover(state) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || Number(b.alive) - Number(a.alive));
  const winner = ranked.find(player => player.alive) || null;
  screenEl.innerHTML = `<p class="eyebrow">That's all, folks!</p><div class="winner-panel"><span class="winner-badge">#1</span><h1>${winner ? `${escapeHtml(winner.name)} is the big brain!` : 'No winner this time'}</h1></div><div class="list">${ranked.map((player, index) => `<div class="list-row"><span class="pname"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="avatar ${player.alive ? '' : 'dead'}">${initials(player.name)}</span><span>${escapeHtml(player.name)}${!player.alive ? ' <span class="muted">eliminated</span>' : ''}</span></span><span class="score">${player.score} pts</span></div>`).join('')}</div><button class="primary full" id="btn-new-room" style="margin-top:24px;">Create another room</button>`;
  document.getElementById('btn-new-room').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Ending room...';
    try { await Game.createAnotherRoom(); } catch { event.currentTarget.disabled = false; event.currentTarget.textContent = 'Create another room'; }
  });
}

function render(state) {
  setConnection(state.connection);
  const revealKey = state.phase === 'reveal'
    ? `${state.roundNumber}-${state.revealComplete}-${[...state.revealedIndices].join('')}-${[...state.revealVerdicts].join('')}-${state.revealLastVerdictIndex}-${state.revealGag}-${JSON.stringify(state.revealVariant)}-${state.revealLine}`
    : '';
  const key = state.phase === 'setup'
    ? `setup-${state.error || ''}`
    : state.phase === 'reveal' ? `reveal-${revealKey}` : `${state.phase}-${state.roundNumber}-${state.lobbyStage}`;

  if (currentViewKey === key) {
    if (state.phase === 'lobby') updateLobby(state);
    else if (state.phase === 'voting') updateVoting(state);
    else if (state.phase === 'reveal' && state.revealComplete) {
      const countdown = document.getElementById('auto-next-countdown');
      if (countdown) countdown.textContent = Math.max(0, Math.ceil((state.autoNextAt - Date.now()) / 1000));
    }
    return;
  }

  currentViewKey = key;
  screenEl.removeAttribute('aria-busy');
  if (state.phase === 'setup') renderSetup(state);
  else if (state.phase === 'lobby') renderLobby(state);
  else if (state.phase === 'voting') renderVoting(state);
  else if (state.phase === 'reveal') renderReveal(state);
  else if (state.phase === 'gameover') renderGameover(state);
}

Game.onChange(render);
Game.restoreRoom().then(restored => {
  if (!restored) render(Game.getState());
});
