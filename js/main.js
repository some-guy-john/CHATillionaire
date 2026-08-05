const screenEl = document.getElementById('screen');
const connStatusEl = document.getElementById('conn-status');
const connLabelEl = document.getElementById('conn-label');

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
  connStatusEl.classList.toggle('conn-status--on', connected);
  connStatusEl.classList.toggle('conn-status--off', !connected);
  connLabelEl.textContent = connected ? 'Room is live!' : 'Getting things ready';
}

function renderPlayerRoster(state, showResults = false) {
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
    }

    const safeName = escapeHtml(player.name);
    const gagClass = revealBonk && state.revealGag ? `gag-${state.revealGag}` : '';
    const nameMarkup = newlyEliminated || revealBonk
      ? `<span class="player-name-fx ${gagClass}" aria-label="${safeName}"><span class="name-half name-half--left" aria-hidden="true">${safeName}</span><span class="name-half name-half--right" aria-hidden="true">${safeName}</span></span>`
      : `<span class="player-name">${safeName}</span>`;

    return `<div class="player-row ${isAlive ? '' : 'player-row--out'} ${newlyEliminated || revealBonk ? 'player-row--new-out' : ''}">
      <span class="pname"><span class="avatar ${isAlive ? '' : 'dead'}">${initials(player.name)}</span>${nameMarkup}</span>
      <span class="player-meta"><span class="player-score">${player.score} pts</span>${status}</span>
    </div>`;
  }

  return `<aside class="players-panel">
    <div class="players-heading"><span>Who's still in?</span><strong>${alive.length} alive &middot; ${state.players.length} total</strong></div>
    <div class="player-group-label">Leaderboard &middot; alive first</div>
    <div class="player-list">${rankedPlayers.length ? rankedPlayers.map(player => renderPlayer(player, player.alive)).join('') : '<div class="player-empty">Nobody left standing!</div>'}</div>
  </aside>`;
}

function copyJoinLink() {
  const link = document.getElementById('join-link');
  if (!link) return;
  navigator.clipboard?.writeText(link.value).then(() => {
    const button = document.getElementById('copy-link');
    if (!button) return;
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
  });
}

function renderSetup(state) {
  screenEl.innerHTML = `
    <div class="intro-layout">
      <div class="intro-copy">
        <p class="eyebrow">Welcome to the quiz party</p>
        <h2>Put chat in the <em>hot seat!</em></h2>
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
        <p id="setup-error" class="small setup-error" ${state.error ? '' : 'hidden'}>${escapeHtml(state.error || '')}</p>
        <button class="primary full" id="btn-create">Make a room!</button>
      </div>
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

  document.getElementById('btn-create').addEventListener('click', async () => {
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
    <h2>${countdown ? 'The countdown is on!' : 'Send in the players!'}</h2>
    <p class="small" style="margin:0 0 22px;">${lobbyText}</p>
    <div class="share-card">
      <span class="share-label">Player join link</span>
      <div class="share-controls"><input id="join-link" type="text" readonly value="${escapeHtml(state.joinUrl)}"><button id="copy-link">Copy link</button></div>
      <strong>Room code: ${escapeHtml(state.roomCode)}</strong>
    </div>
    <div class="list lobby-list">
      ${state.players.length
        ? state.players.map(player => `<div class="list-row"><span class="pname"><span class="avatar">${initials(player.name)}</span><span>${escapeHtml(player.name)}</span></span><span class="pill pill--accent">ready</span></div>`).join('')
        : '<div class="list-row"><span class="muted">It is quiet in here... share the link!</span></div>'}
    </div>
    <div class="live-board">
      <div class="stat"><strong>${state.players.length}</strong><span>Players in</span></div>
      <div class="stat"><strong>${state.totalRounds}</strong><span>Rounds of chaos</span></div>
      <div class="stat"><strong>${formatSeconds(state.lobbySeconds)}</strong><span>Lobby time</span></div>
    </div>
  `;
  document.getElementById('copy-link').addEventListener('click', copyJoinLink);
}

function renderVoting(state) {
  const q = state.currentQuestion;
  const alive = state.players.filter(player => player.alive).length;
  const answered = state.votes.size;
  const pct = alive > 0 ? Math.round((answered / alive) * 100) : 0;
  screenEl.innerHTML = `<div class="game-layout">
    <section class="question-panel">
      <div class="round-meta"><p class="eyebrow" style="margin:0;">Round ${state.roundNumber} / ${state.totalRounds}</p><span class="pill pill--accent">${alive} alive</span></div>
      <div class="question-heading"><h2>${escapeHtml(q.question)}</h2></div>
      <div class="answer-grid">${q.options.map((option, index) => `<div class="opt"><span class="letter">${'ABCD'[index]}</span><span>${escapeHtml(option)}</span></div>`).join('')}</div>
      <div class="timer-row"><span>${answered}/${alive} locked in</span><span class="time-left ${state.timeLeft <= 5 ? 'time-left--urgent' : ''}">${state.timeLeft}s left</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="actions"><span class="small">Viewers answer on the join page</span><button id="btn-force">Reveal it!</button></div>
    </section>
    ${renderPlayerRoster(state)}
  </div>`;
  document.getElementById('btn-force').addEventListener('click', () => Game.forceEndRound());
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
  const gagCopy = { kick: ['KICKED OFF THE SHOW', 'Please exit via the nearest cartoon door.'], burn: ['TOASTED!', 'That answer was served extra crispy.'], trapdoor: ['TRAPDOOR ACTIVATED', 'The floor has opinions.'], rocket: ['LAUNCHED INTO ORBIT', 'See you in the next dimension.'], confetti: ['BIG BRAIN MOMENT', 'Correctly chosen by:'] };
  const gagText = gagCopy[state.revealGag] || gagCopy.burn;
  const gagStage = showSpotlight ? `<div class="gag-stage gag-stage--${state.revealGag || 'burn'}" aria-hidden="true"><span class="gag-target">${spotlightCorrect ? 'BIG BRAIN' : 'BAD ANSWER'}</span><span class="gag-prop gag-prop--main">${spotlightCorrect ? '🎉' : state.revealGag === 'kick' ? '👢' : state.revealGag === 'burn' ? '🔥' : state.revealGag === 'trapdoor' ? '⬇' : '🚀'}</span><span class="gag-prop gag-prop--extra">${spotlightCorrect ? '✨' : state.revealGag === 'burn' ? '🔥' : state.revealGag === 'rocket' ? '💨' : '💥'}</span><span class="gag-impact">${spotlightCorrect ? 'YES!' : state.revealGag === 'kick' ? 'POW!' : state.revealGag === 'burn' ? 'HOT!' : state.revealGag === 'trapdoor' ? 'BYE!' : 'WHOOSH!'}</span></div>` : '';
  const spotlight = showSpotlight ? `<div class="reveal-spotlight ${spotlightCorrect ? 'reveal-spotlight--correct' : 'reveal-spotlight--wrong'} gag-${state.revealGag || 'burn'}" role="status">${gagStage}<span class="spotlight-eyebrow">${gagText[0]}</span><strong>${spotlightCorrect ? 'Look at these geniuses!' : `Oh no... ${'ABCD'[lastVerdictIndex]} was a trap!`}</strong><span class="spotlight-copy">${spotlightCorrect ? 'Correctly chosen by:' : `Chosen by ${spotlightVoters.length === 1 ? 'this brave soul' : 'these brave souls'}:`}</span><span class="spotlight-names">${spotlightVoters.map(result => `<span class="spotlight-name gag-${state.revealGag || 'burn'}">${escapeHtml(result.name)}</span>`).join('')}</span><span class="spotlight-punchline">${spotlightCorrect ? 'Absolutely massive brains.' : gagText[1]}</span></div>` : '';
  const countdown = state.autoNextAt ? Math.max(0, Math.ceil((state.autoNextAt - Date.now()) / 1000)) : 4;

  screenEl.innerHTML = `<div class="game-layout"><section class="question-panel reveal-panel"><p class="eyebrow">${finished ? 'The big reveal!' : showSpotlight ? 'The bonk has landed!' : revealed.size ? 'Ooooh, not that one...' : 'The cards are thinking...'}</p><p class="reveal-mode">${escapeHtml(state.revealMode || 'mystery mode')}</p><h2>${escapeHtml(question.question)}</h2><div class="answer-grid">${question.options.map((option, index) => { const isRevealed = revealed.has(index); const hasVerdict = verdicts.has(index); const correct = index === correctIndex; const voters = state.lastResult.playerResults.filter(result => result.vote === index); const cardClass = hasVerdict ? (correct ? 'is-correct' : 'is-wrong') : isRevealed ? 'is-showing-voters' : 'is-pending'; const count = finished ? ` <span class="vote-count">${state.lastResult.voteCounts[index]} vote${state.lastResult.voteCounts[index] === 1 ? '' : 's'}</span>` : ''; const tag = hasVerdict && correct ? 'Nailed it!' : hasVerdict ? 'Bonked!' : 'Who picked this?'; const voterText = isRevealed ? voters.length ? voters.map(result => `<span class="voter-name">${escapeHtml(result.name)}</span>`).join('<span class="voter-comma">, </span>') : '<span class="voter-name voter-name--nobody">Nobody!</span>' : '<span class="voter-name voter-name--sealed">Vote sealed</span>'; return `<div class="opt reveal-card ${cardClass} ${lastVerdictIndex === index ? 'is-fresh-verdict' : ''}"><span class="letter">${'ABCD'[index]}</span><span class="answer-copy"><strong>${escapeHtml(option)}</strong><span class="voter-line">${tag} <span class="voter-names">${voterText}</span></span>${count}</span></div>`; }).join('')}</div>${spotlight}${finished ? `<div class="reveal-verdict"><strong>${eliminated.length ? `${eliminated.length} player${eliminated.length === 1 ? '' : 's'} got bonked.` : 'Everybody nailed it!'}</strong><span>Next question in ${countdown}s.</span></div>` : '<div class="reveal-dots" aria-label="Reveal in progress"><span></span><span></span><span></span></div>'}</section>${renderPlayerRoster(state, finished)}</div>`;
}

function renderGameover(state) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || Number(b.alive) - Number(a.alive));
  const winner = ranked[0];
  screenEl.innerHTML = `<p class="eyebrow">That's all, folks!</p><div class="winner-panel"><span class="winner-badge">#1</span><h2>${winner ? `${escapeHtml(winner.name)} is the big brain!` : 'No winner this time'}</h2></div><div class="list">${ranked.map((player, index) => `<div class="list-row"><span class="pname"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="avatar ${player.alive ? '' : 'dead'}">${initials(player.name)}</span><span>${escapeHtml(player.name)}${!player.alive ? ' <span class="muted">eliminated</span>' : ''}</span></span><span class="score">${player.score} pts</span></div>`).join('')}</div>`;
}

function render(state) {
  setConnection(Boolean(state.room));
  if (state.phase === 'setup') renderSetup(state);
  else if (state.phase === 'lobby') renderLobby(state);
  else if (state.phase === 'voting') renderVoting(state);
  else if (state.phase === 'reveal') renderReveal(state);
  else if (state.phase === 'gameover') renderGameover(state);
}

Game.onChange(render);

fetch('data/questions.json')
  .then(response => response.json())
  .then(async bank => {
    Game.setQuestionBank(bank);
    const restored = await Game.restoreRoom();
    if (!restored) render(Game.getState());
  })
  .catch(() => {
    screenEl.innerHTML = '<p class="small setup-error">Could not load the question bank. Run this through a local server or GitHub Pages.</p>';
  });
