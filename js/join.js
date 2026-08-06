const joinScreen = document.getElementById('join-screen');
const joinStatus = document.getElementById('join-status');
const joinStatusLabel = document.getElementById('join-status-label');
const roomCode = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || '';
const hostJoin = new URLSearchParams(window.location.search).get('host') === '1';

let snapshot = null;
let room = null;
let player = null;
let myVote = null;
let outcome = null;
let pollHandle = null;
let pollInFlight = false;
let pollDelay = 2000;
let busy = false;
let selectedOption = null;
let currentViewKey = '';
let requestSequence = 0;
let appliedSequence = 0;
let pollCount = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function setStatus(mode, label) {
  joinStatus.classList.toggle('conn-status--on', mode === 'online');
  joinStatus.classList.toggle('conn-status--off', mode !== 'online');
  joinStatusLabel.textContent = label;
}

function formatSeconds(seconds) {
  return `${Math.max(0, Number(seconds) || 0)}s`;
}

function renderError(message, retryable = true) {
  joinScreen.removeAttribute('aria-busy');
  joinScreen.innerHTML = `<div class="viewer-message"><p class="eyebrow">Oops!</p><h1>${escapeHtml(message)}</h1><p class="small">${retryable ? 'The connection did not stick. Check your connection, then try again.' : 'Ask the streamer for a fresh join link and try again.'}</p>${retryable ? '<div class="error-actions"><button class="primary" id="retry-join" type="button">Try again</button></div>' : ''}</div>`;
  setStatus('offline', retryable ? 'Reconnecting' : 'Room unavailable');
  if (retryable) document.getElementById('retry-join').addEventListener('click', discoverRoom);
}

function isRetryableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return !message.includes('does not exist')
    && !message.includes('missing its room code')
    && !message.includes('already started');
}

function renderJoin() {
  currentViewKey = 'join';
  joinScreen.removeAttribute('aria-busy');
  joinScreen.innerHTML = `
    <form class="viewer-center" id="join-form">
      <p class="eyebrow">Room ${escapeHtml(roomCode || '??????')}</p>
      <h1>Ready to become a <em>legend?</em></h1>
      <p class="small">${hostJoin ? 'You are joining as a player from the streamer account.' : 'Pick a nickname. No account, no fuss, just quiz chaos.'}</p>
      <div class="field viewer-field"><label for="nickname">Your nickname</label><input id="nickname" type="text" maxlength="18" autocomplete="off" placeholder="e.g. Quiz Goblin" aria-describedby="join-error"></div>
      <p id="join-error" class="small setup-error" role="alert" hidden></p>
      <button class="primary full" id="join-button" type="submit">Join the game!</button>
      <p class="viewer-note">You will answer here. Watch the stream for the dramatic reveal.</p>
    </form>`;
  document.getElementById('join-form').addEventListener('submit', joinGame);
}

async function joinGame(event) {
  event.preventDefault();
  if (busy) return;
  const input = document.getElementById('nickname');
  const button = document.getElementById('join-button');
  const error = document.getElementById('join-error');
  const nickname = input.value.trim();
  if (nickname.length < 2) {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = 'Pick a nickname with at least 2 characters.';
    error.hidden = false;
    return;
  }

  busy = true;
  stopPolling();
  button.disabled = true;
  button.textContent = 'Joining...';
  try {
    const sequence = ++requestSequence;
    applySnapshot(await ChatSupabase.joinRoom(roomCode, nickname, hostJoin), sequence);
    startPolling();
  } catch (joinError) {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = joinError.message || 'Could not join that room.';
    error.hidden = false;
    button.disabled = false;
    button.textContent = 'Join the game!';
  } finally {
    busy = false;
  }
}

async function discoverRoom() {
  if (!roomCode) {
    renderError('This link is missing its room code.', false);
    return;
  }
  setStatus('connecting', 'Finding room');
  const sequence = ++requestSequence;
  try {
    const initial = await ChatSupabase.getPlayerState(roomCode);
    if (!initial?.room) throw new Error('That room does not exist.');
    applySnapshot(initial, sequence);
    startPolling();
  } catch (error) {
    if (sequence < appliedSequence) return;
    renderError(error.message || 'Could not find that room.', isRetryableError(error));
  }
}

function applySnapshot(next, sequence = ++requestSequence) {
  if (!next?.room) return;
  if (sequence < appliedSequence) return;
  if (room && next.room.id !== room.id) return;
  appliedSequence = sequence;
  snapshot = next;
  room = next.room;
  player = next.player;
  myVote = next.my_vote;
  outcome = next.outcome;
  selectedOption = myVote?.option_index ?? selectedOption;
  pollDelay = 2000;
  setStatus('online', player ? 'You are in!' : 'Room is live!');
  joinScreen.removeAttribute('aria-busy');
  renderState();
}

function startPolling() {
  stopPolling();
  schedulePoll(0);
}

function stopPolling() {
  if (pollHandle) clearTimeout(pollHandle);
  pollHandle = null;
  pollInFlight = false;
}

function schedulePoll(delay = pollDelay) {
  if (room?.phase === 'gameover' || (!player && room?.phase !== 'lobby')) return;
  if (pollHandle) clearTimeout(pollHandle);
  pollHandle = setTimeout(poll, delay);
}

async function poll() {
  pollHandle = null;
  if (pollInFlight) return schedulePoll();
  pollInFlight = true;
  const sequence = ++requestSequence;
  try {
    pollCount += 1;
    const next = await ChatSupabase.getPlayerState(roomCode);
    applySnapshot(next, sequence);
  } catch {
    pollDelay = Math.min(pollDelay * 2, 10000);
    setStatus('reconnecting', 'Reconnecting');
  } finally {
    pollInFlight = false;
    schedulePoll();
  }
}

function renderState() {
  if (!player) {
    if (room.phase === 'lobby') renderJoin();
    else renderError('This game has already started.', false);
    return;
  }
  if (room.phase === 'lobby') renderLobby();
  else if (room.phase === 'voting' && player.alive) renderVoting();
  else if (room.phase === 'voting') renderEliminated();
  else if (room.phase === 'reveal') renderReveal();
  else renderGameover();
}

function renderLobby() {
  const key = `lobby-${room.lobby_stage}`;
  const seconds = Math.max(0, Math.ceil((new Date(room.lobby_deadline).getTime() - Date.now()) / 1000));
  if (currentViewKey !== key) {
    currentViewKey = key;
    joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">You're in the room!</p><h1>Welcome, <em>${escapeHtml(player.nickname)}</em>.</h1><div class="viewer-wait-card"><strong id="lobby-message"></strong><span id="lobby-copy"></span></div><div class="viewer-player-count"><strong id="player-count">${snapshot.player_count}</strong><span>players in the room</span></div></div>`;
  }
  document.getElementById('lobby-message').textContent = room.lobby_stage === 'countdown' ? `Game starts in ${formatSeconds(seconds)}` : 'Waiting for one more brave player...';
  document.getElementById('lobby-copy').textContent = room.lobby_stage === 'countdown' ? 'The streamer can see you. Get your brain ready!' : 'Share the link with a friend. If nobody arrives, the game starts solo after five minutes.';
  document.getElementById('player-count').textContent = snapshot.player_count;
}

function renderVoting() {
  const key = `voting-${room.round_number}`;
  const locked = Boolean(myVote);
  const question = room.current_question;
  const seconds = Math.max(0, Math.ceil((new Date(room.round_deadline).getTime() - Date.now()) / 1000));
  const votingClosed = seconds === 0;
  if (currentViewKey !== key || Boolean(document.querySelector('.viewer-answer:disabled')) !== locked) {
    currentViewKey = key;
    joinScreen.innerHTML = `<div class="viewer-play"><div class="round-meta"><p class="eyebrow" style="margin:0;">Round ${room.round_number} / ${room.total_rounds}</p><span class="pill pill--accent" id="round-timer">${formatSeconds(seconds)} left</span></div><p class="eyebrow">${escapeHtml(player.nickname)}, lock in!</p><h1>${escapeHtml(question.question)}</h1><div class="viewer-answer-grid" role="group" aria-label="Answer choices">${question.options.map((option, index) => `<button class="viewer-answer ${myVote?.option_index === index ? 'selected' : ''}" data-option="${index}" aria-pressed="${myVote?.option_index === index}" ${locked || votingClosed ? 'disabled' : ''}><span>${'ABCD'[index]}</span><span class="viewer-answer-copy">${escapeHtml(option)}${myVote?.option_index === index ? '<small>Your answer &#10003;</small>' : ''}</span></button>`).join('')}</div><div id="vote-state" class="viewer-vote-state ${locked ? 'is-locked' : ''}" role="status">${locked ? `Vote locked: ${'ABCD'[myVote.option_index]}. Watch the stream for the reveal.` : votingClosed ? 'Voting is closed. Watch the stream for the reveal.' : 'Pick one answer. You only get one shot!'}</div></div>`;
    document.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => submitVote(Number(button.dataset.option))));
  } else {
    document.getElementById('round-timer').textContent = `${formatSeconds(seconds)} left`;
    if (votingClosed) {
      document.querySelectorAll('[data-option]').forEach(button => { button.disabled = true; });
      document.getElementById('vote-state').textContent = 'Voting is closed. Watch the stream for the reveal.';
    }
  }
}

async function submitVote(optionIndex) {
  if (busy || myVote) return;
  busy = true;
  stopPolling();
  selectedOption = optionIndex;
  const status = document.getElementById('vote-state');
  document.querySelectorAll('[data-option]').forEach(button => { button.disabled = true; });
  if (status) {
    status.textContent = 'Submitting your answer...';
    status.setAttribute('aria-busy', 'true');
  }
  try {
    const sequence = ++requestSequence;
    applySnapshot(await ChatSupabase.submitVote(room.id, optionIndex), sequence);
    startPolling();
  } catch (error) {
    document.querySelectorAll('[data-option]').forEach(button => { button.disabled = false; });
    if (status) {
      status.textContent = error.message || 'Your answer did not get through. Try again.';
      status.removeAttribute('aria-busy');
    }
    startPolling();
  } finally {
    busy = false;
  }
}

function renderEliminated() {
  if (currentViewKey === `spectator-${room.round_number}`) return;
  currentViewKey = `spectator-${room.round_number}`;
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">Spectator mode</p><h1>You're out, but the chaos continues!</h1><div class="viewer-wait-card"><strong>Watch the stream for the next bonk.</strong><span>You can stay here while the remaining players battle it out.</span></div></div>`;
}

function renderReveal() {
  const hasResult = Boolean(outcome);
  const key = `reveal-${room.round_number}-${hasResult}`;
  if (currentViewKey === key) return;
  currentViewKey = key;
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">${hasResult ? 'Reveal complete!' : 'The answer is being revealed!'}</p><h1>${hasResult && outcome.survived ? 'You survived the bonk!' : 'Watch the stream for the <em>bonk.</em>'}</h1><div class="viewer-wait-card"><strong>${hasResult ? escapeHtml(outcome.message) : 'The cards are doing their thing...'}</strong><span>${hasResult ? (outcome.survived ? 'You live to quiz another day.' : 'That answer sent you flying. You can watch the rest of the chaos.') : 'Your result will appear here when the reveal finishes.'}</span></div></div>`;
}

function renderGameover() {
  stopPolling();
  if (currentViewKey === 'gameover') return;
  currentViewKey = 'gameover';
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">Game over!</p><h1>${player.alive ? 'You made it to the end!' : 'The quiz has ended.'}</h1><p class="small">Thanks for playing, ${escapeHtml(player.nickname)}. Check the stream for the final leaderboard.</p></div>`;
}

renderJoin();
discoverRoom();
