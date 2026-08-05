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
      status = '<span class="vote-check" title="Vote locked in" aria-label="Vote locked in">✓</span>';
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
    <div class="players-heading"><span>Who's still in?</span><strong>${alive.length} alive · ${state.players.length} total</strong></div>
    <div class="player-group-label">Leaderboard · alive first</div>
    <div class="player-list">${rankedPlayers.length ? rankedPlayers.map(player => renderPlayer(player, player.alive)).join('') : '<div class="player-empty">Nobody left standing!</div>'}</div>
  </aside>`;
}

function setConnStatus(connected) {
  connStatusEl.classList.toggle('conn-status--on', connected);
  connStatusEl.classList.toggle('conn-status--off', !connected);
  connLabelEl.textContent = connected ? 'Chat is ready!' : 'Chat is snoozing';
}

function renderSetup() {
  const config = Game.getState().config;

  screenEl.innerHTML = `
    <div class="intro-layout">
      <div class="intro-copy">
        <p class="eyebrow">Welcome to the quiz party</p>
        <h2>Put chat in the <em>hot seat!</em></h2>
        <p class="small">A silly, speedy knockout quiz for your whole community. Pick a channel, invite your chat, and see who has the biggest brain in the room.</p>
        <div class="field">
          <label for="in-channel">Which Twitch channel are we playing in?</label>
          <input id="in-channel" type="text" placeholder="yourchannelname" autocomplete="off" value="${escapeHtml(config.channel)}">
        </div>
        <div class="row">
          <div class="field">
            <label for="in-rounds">How many rounds?</label>
            <input id="in-rounds" type="number" min="1" max="10" value="${config.totalRounds}">
          </div>
          <div class="field">
            <label for="in-timer">Seconds to answer</label>
            <input id="in-timer" type="number" min="5" max="120" value="${config.timerSeconds}">
          </div>
        </div>
        <div class="checkfield">
          <input id="in-speedup" type="checkbox" ${config.speedupEnabled ? 'checked' : ''}>
          <label for="in-speedup">Make it spicy when half has voted</label>
        </div>
        <div class="checkfield">
          <input id="in-sfx" type="checkbox" ${config.sfxEnabled ? 'checked' : ''}>
          <label for="in-sfx">Play goofy game-show sound effects</label>
        </div>
        <p id="setup-error" class="small" style="color:var(--danger-text); display:none;"></p>
        <button class="primary full" id="btn-connect">Let's play!</button>
      </div>
      <aside class="briefing" aria-label="How the game works">
        <div class="briefing-heading"><span>How to play</span><span>easy peasy</span></div>
        <div class="briefing-list">
          <div class="briefing-item"><b>1</b><span>Chat types <code>!join</code> to jump in.</span></div>
          <div class="briefing-item"><b>2</b><span>Everyone shouts A, B, C, or D in chat.</span></div>
          <div class="briefing-item"><b>3</b><span>Wrong answers get bonked out.</span></div>
        </div>
      </aside>
    </div>
  `;

  document.getElementById('btn-connect').addEventListener('click', () => {
    const channel = document.getElementById('in-channel').value.trim();
    const errEl = document.getElementById('setup-error');

    if (!channel) {
      errEl.textContent = 'Pop in a Twitch channel name first!';
      errEl.style.display = 'block';
      return;
    }

    Game.configure({
      channel,
      totalRounds: Number(document.getElementById('in-rounds').value) || 10,
      timerSeconds: Number(document.getElementById('in-timer').value) || 30,
      speedupEnabled: document.getElementById('in-speedup').checked,
      sfxEnabled: document.getElementById('in-sfx').checked
    });

    TwitchChat.connect(channel).then(() => {
      Game.resetGame();
    }).catch(() => {
      errEl.textContent = 'That channel did not answer. Check the name and try again.';
      errEl.style.display = 'block';
    });
  });
}

function renderLobby(state) {
  const players = state.players;
  screenEl.innerHTML = `
    <p class="eyebrow">The party is forming</p>
    <h2>Who's brave enough to play?</h2>
    <p class="small" style="margin:0 0 22px;">We're hanging out in <code>#${escapeHtml(state.config.channel)}</code>. Tell chat to type <code>!join</code>!</p>
    <div class="list">
      ${players.length === 0
        ? "<div class=\"list-row\"><span class=\"muted\">It's quiet in here... summon your chat!</span></div>"
        : players.map(p => `
          <div class="list-row">
            <span class="pname"><span class="avatar">${initials(p.name)}</span><span>${escapeHtml(p.name)}</span></span>
            <span class="pill pill--accent">joined</span>
          </div>
        `).join('')}
    </div>
    <div class="live-board">
      <div class="stat"><strong>${players.length}</strong><span>Players in</span></div>
      <div class="stat"><strong>${state.totalRounds}</strong><span>Rounds of chaos</span></div>
      <div class="stat"><strong>${state.config.timerSeconds}s</strong><span>To think</span></div>
    </div>
    <div class="actions">
      <span class="small">${players.length} player${players.length === 1 ? '' : 's'} ready to rumble</span>
      <button class="primary" id="btn-start" ${players.length === 0 ? 'disabled' : ''}>Start the fun</button>
    </div>
  `;
  document.getElementById('btn-start').addEventListener('click', () => Game.startGame());
}

function renderVoting(state) {
  const q = state.currentQuestion;
  const alive = state.players.filter(p => p.alive).length;
  const answered = state.votes.size;
  const pct = alive > 0 ? Math.round((answered / alive) * 100) : 0;

  screenEl.innerHTML = `<div class="game-layout">
    <section class="question-panel">
      <div class="round-meta">
        <p class="eyebrow" style="margin:0;">Round ${state.roundNumber} / ${state.totalRounds}</p>
        <span class="pill pill--accent">${alive} alive</span>
      </div>
      <div class="question-heading"><h2>${escapeHtml(q.question)}</h2></div>
      <div class="answer-grid">
        ${q.options.map((opt, i) => `
          <div class="opt"><span class="letter">${'ABCD'[i]}</span><span>${escapeHtml(opt)}</span></div>
        `).join('')}
      </div>
      <div class="timer-row">
        <span>${answered}/${alive} locked in ${state.sped ? '<span class="sped">&nbsp;spicy mode!</span>' : ''}</span>
        <span class="time-left ${state.timeLeft <= 5 ? 'time-left--urgent' : ''}">${state.timeLeft}s left</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="actions"><span class="small">Shout your answer: <code>A</code> <code>B</code> <code>C</code> <code>D</code></span><button id="btn-force">Reveal it!</button></div>
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
  const revealMessage = finished
    ? 'The big reveal!'
    : lastVerdictIndex !== null && lastVerdictIndex !== undefined
      ? (lastVerdictIndex === correctIndex ? 'We have a winner!' : 'The bonk has landed!')
    : revealed.size === 0
      ? 'The cards are thinking...'
      : 'Ooooh, not that one...';
  const spotlightVoters = lastVerdictIndex === null || lastVerdictIndex === undefined
    ? []
    : state.lastResult.playerResults.filter(result => result.vote === lastVerdictIndex);
  const showSpotlight = !finished
    && lastVerdictIndex !== null
    && lastVerdictIndex !== undefined
    && spotlightVoters.length > 0;
  const spotlightCorrect = lastVerdictIndex === correctIndex;
  const gagCopy = {
    kick: ['KICKED OFF THE SHOW', 'Please exit via the nearest cartoon door.'],
    burn: ['TOASTED!', 'That answer was served extra crispy.'],
    trapdoor: ['TRAPDOOR ACTIVATED', 'The floor has opinions.'],
    rocket: ['LAUNCHED INTO ORBIT', 'See you in the next dimension.'],
    confetti: ['BIG BRAIN MOMENT', 'Correctly chosen by:']
  };
  const gagText = gagCopy[state.revealGag] || gagCopy.burn;
  const gagStage = showSpotlight ? `
    <div class="gag-stage gag-stage--${state.revealGag || 'burn'}" aria-hidden="true">
      <span class="gag-target">${spotlightCorrect ? 'BIG BRAIN' : 'BAD ANSWER'}</span>
      <span class="gag-prop gag-prop--main">${spotlightCorrect ? '🎉' : state.revealGag === 'kick' ? '👢' : state.revealGag === 'burn' ? '🔥' : state.revealGag === 'trapdoor' ? '⬇' : '🚀'}</span>
      <span class="gag-prop gag-prop--extra">${spotlightCorrect ? '✨' : state.revealGag === 'burn' ? '🔥' : state.revealGag === 'rocket' ? '💨' : '💥'}</span>
      <span class="gag-impact">${spotlightCorrect ? 'YES!' : state.revealGag === 'kick' ? 'POW!' : state.revealGag === 'burn' ? 'HOT!' : state.revealGag === 'trapdoor' ? 'BYE!' : 'WHOOSH!'}</span>
      ${state.revealGag === 'trapdoor' ? '<span class="gag-trapdoor-left"></span><span class="gag-trapdoor-right"></span>' : ''}
    </div>` : '';
  const spotlight = showSpotlight ? `
    <div class="reveal-spotlight ${spotlightCorrect ? 'reveal-spotlight--correct' : 'reveal-spotlight--wrong'} gag-${state.revealGag || 'burn'}" role="status">
      ${gagStage}
      <span class="spotlight-eyebrow">${spotlightCorrect ? gagText[0] : gagText[0]}</span>
      <strong>${spotlightCorrect ? 'Look at these geniuses!' : `Oh no... ${'ABCD'[lastVerdictIndex]} was a trap!`}</strong>
      <span class="spotlight-copy">${spotlightCorrect ? 'Correctly chosen by:' : `Chosen by ${spotlightVoters.length === 1 ? 'this brave soul' : 'these brave souls'}:`}</span>
      <span class="spotlight-names">${spotlightVoters.map(result => `<span class="spotlight-name gag-${state.revealGag || 'burn'}">${escapeHtml(result.name)}</span>`).join('')}</span>
      <span class="spotlight-punchline">${spotlightCorrect ? 'Absolutely massive brains.' : gagText[1]}</span>
    </div>` : '';

  screenEl.innerHTML = `<div class="game-layout">
    <section class="question-panel reveal-panel">
      <p class="eyebrow">${revealMessage}</p>
      <p class="reveal-mode">${escapeHtml(state.revealMode || 'mystery mode')}</p>
      <h2>${escapeHtml(question.question)}</h2>
      <div class="answer-grid">
        ${question.options.map((opt, i) => {
          const isRevealed = revealed.has(i);
          const hasVerdict = verdicts.has(i);
          const isCorrect = i === correctIndex;
          const isFreshVerdict = lastVerdictIndex === i;
          const voters = state.lastResult.playerResults.filter(result => result.vote === i);
          const cardClass = hasVerdict
            ? (isCorrect ? 'is-correct' : 'is-wrong')
            : isRevealed ? 'is-showing-voters' : 'is-pending';
          const count = finished ? ` <span class="vote-count">${state.lastResult.voteCounts[i]} vote${state.lastResult.voteCounts[i] === 1 ? '' : 's'}</span>` : '';
          const tag = hasVerdict && isCorrect ? 'Nailed it!' : hasVerdict ? 'Bonked!' : 'Who picked this?';
          const voterText = isRevealed
            ? voters.length
              ? voters.map(result => `<span class="voter-name">${escapeHtml(result.name)}</span>`).join('<span class="voter-comma">, </span>')
              : '<span class="voter-name voter-name--nobody">Nobody!</span>'
            : '<span class="voter-name voter-name--sealed">Vote sealed</span>';
          return `<div class="opt reveal-card ${cardClass} ${isFreshVerdict ? 'is-fresh-verdict' : ''}">
            <span class="letter">${'ABCD'[i]}</span>
            <span class="answer-copy"><strong>${escapeHtml(opt)}</strong><span class="voter-line">${tag} <span class="voter-names">${voterText}</span></span>${count}</span>
          </div>`;
        }).join('')}
      </div>
      ${spotlight}
      ${finished ? `<div class="reveal-verdict"><strong>${eliminated.length ? `${eliminated.length} player${eliminated.length === 1 ? '' : 's'} got bonked.` : 'Everybody nailed it!'}</strong><span>Correct answers earn ${(state.roundNumber) * 10} points.</span></div>` : '<div class="reveal-dots" aria-label="Reveal in progress"><span></span><span></span><span></span></div>'}
      <button class="primary full" id="btn-next" style="margin-top:24px;" ${finished ? '' : 'disabled'}>${finished ? 'Next question!' : 'Wait for it...'}</button>
    </section>
    ${renderPlayerRoster(state, finished)}
  </div>`;
  document.getElementById('btn-next').addEventListener('click', () => Game.nextRound());
}

function renderGameover(state) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  screenEl.innerHTML = `
    <p class="eyebrow">That's all, folks!</p>
    <div class="winner-panel">
      <span class="winner-badge">#1</span>
      <h2>${winner ? `${escapeHtml(winner.name)} is the big brain!` : 'No winner this time'}</h2>
    </div>
    <div class="list">
      ${ranked.map((p, i) => `
        <div class="list-row">
          <span class="pname">
            <span class="rank-number">${String(i + 1).padStart(2, '0')}</span>
            <span class="avatar ${p.alive ? '' : 'dead'}">${initials(p.name)}</span>
            <span>${escapeHtml(p.name)}${!p.alive ? ' <span class="muted">eliminated</span>' : ''}</span>
          </span>
          <span class="score">${p.score} pts</span>
        </div>
      `).join('')}
    </div>
    <button class="primary full" id="btn-again" style="margin-top:24px;">Play again!</button>
  `;
  document.getElementById('btn-again').addEventListener('click', () => Game.resetGame());
}

function render(state) {
  if (state.phase === 'setup') renderSetup();
  else if (state.phase === 'lobby') renderLobby(state);
  else if (state.phase === 'voting') renderVoting(state);
  else if (state.phase === 'reveal') renderReveal(state);
  else if (state.phase === 'gameover') renderGameover(state);
}

Game.onChange(render);
TwitchChat.onStatus(setConnStatus);
TwitchChat.onMessage(({ username, message }) => Game.handleChatMessage(username, message));

fetch('data/questions.json')
  .then(res => res.json())
  .then(bank => {
    Game.setQuestionBank(bank);
    render(Game.getState());
  })
  .catch(() => {
    screenEl.innerHTML = '<p style="color:var(--danger-text)">Could not load data/questions.json. Make sure you are running this through a local server, not opening index.html directly as a file.</p>';
  });
