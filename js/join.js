const joinScreen = document.getElementById('join-screen');
const joinStatus = document.getElementById('join-status');
const joinStatusLabel = document.getElementById('join-status-label');
const roomCode = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || '';

let room = null;
let player = null;
let players = [];
let round = null;
let myVote = null;
let outcome = null;
let subscription = null;
let refreshTimer = null;
let busy = false;
let errorMessage = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function setStatus(connected, label) {
  joinStatus.classList.toggle('conn-status--on', connected);
  joinStatus.classList.toggle('conn-status--off', !connected);
  joinStatusLabel.textContent = label;
}

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${safe}s`;
}

function renderError() {
  joinScreen.innerHTML = `<div class="viewer-message"><p class="eyebrow">Oops!</p><h2>${escapeHtml(errorMessage)}</h2><p class="small">Ask the streamer for a fresh join link and try again.</p></div>`;
  setStatus(false, 'Room unavailable');
}

function renderJoin() {
  joinScreen.innerHTML = `
    <div class="viewer-center">
      <p class="eyebrow">Room ${escapeHtml(roomCode || '??????')}</p>
      <h2>Ready to become a <em>legend?</em></h2>
      <p class="small">Pick a nickname. No account, no fuss, just quiz chaos.</p>
      <div class="field viewer-field"><label for="nickname">Your nickname</label><input id="nickname" type="text" maxlength="18" autocomplete="off" placeholder="e.g. Quiz Goblin"></div>
      <p id="join-error" class="small setup-error" hidden></p>
      <button class="primary full" id="join-button">Join the game!</button>
      <p class="viewer-note">You will answer here. Watch the stream for the dramatic reveal.</p>
    </div>`;
  document.getElementById('join-button').addEventListener('click', joinGame);
  document.getElementById('nickname').addEventListener('keydown', event => {
    if (event.key === 'Enter') joinGame();
  });
}

async function joinGame() {
  if (busy) return;
  const input = document.getElementById('nickname');
  const button = document.getElementById('join-button');
  const error = document.getElementById('join-error');
  const nickname = input.value.trim();
  if (!nickname) {
    error.textContent = 'Pick a nickname first!';
    error.hidden = false;
    return;
  }
  busy = true;
  button.disabled = true;
  try {
    const result = await ChatSupabase.joinRoom(roomCode, nickname);
    room = result.room;
    player = result.player;
    localStorage.setItem(`chatillionaire-player-${room.id}`, JSON.stringify({ id: player.id, nickname: player.nickname }));
    subscribe();
    await refresh();
  } catch (joinError) {
    error.textContent = joinError.message || 'Could not join that room.';
    error.hidden = false;
    button.disabled = false;
  } finally {
    busy = false;
  }
}

function getSavedPlayer(roomId) {
  try { return JSON.parse(localStorage.getItem(`chatillionaire-player-${roomId}`)); } catch { return null; }
}

async function discoverRoom() {
  if (!roomCode) {
    errorMessage = 'This link is missing its room code.';
    renderError();
    return;
  }
  try {
    room = await ChatSupabase.getRoomByCode(roomCode);
    if (!room) throw new Error('That room does not exist.');
    const saved = getSavedPlayer(room.id);
    if (saved) {
      player = await ChatSupabase.getMyPlayer(room.id);
      if (!player) localStorage.removeItem(`chatillionaire-player-${room.id}`);
    }
    if (player) subscribe();
    await refresh();
  } catch (error) {
    errorMessage = error.message || 'Could not find that room.';
    renderError();
  }
}

function subscribe() {
  if (subscription || !room) return;
  subscription = ChatSupabase.subscribeRoom(room.id, () => refresh().catch(() => {}));
}

async function refresh() {
  if (!room) return;
  room = await ChatSupabase.getRoom(room.id);
  players = await ChatSupabase.getPlayers(room.id);
  const currentPlayer = players.find(item => item.id === player?.id);
  if (currentPlayer) player = currentPlayer;
  if (!player) {
    setStatus(true, 'Room is live!');
    renderJoin();
    return;
  }

  if (room.phase === 'voting') {
    round = { question_public: room.current_question };
    myVote = await ChatSupabase.getMyVote(room.id, player.id, room.round_number);
    outcome = null;
  } else if (room.phase === 'reveal' || room.phase === 'gameover') {
    myVote = room.round_number ? await ChatSupabase.getMyVote(room.id, player.id, room.round_number) : null;
    outcome = room.reveal_complete && room.round_number ? await ChatSupabase.getMyOutcome(room.id, player.id, room.round_number) : null;
  } else {
    round = null;
    myVote = null;
    outcome = null;
  }

  setStatus(true, 'You are in!');
  renderPlayerState();
}

function renderPlayerState() {
  if (room.phase === 'lobby') renderPlayerLobby();
  else if (room.phase === 'voting' && player.alive) renderPlayerVoting();
  else if (room.phase === 'voting') renderPlayerEliminated();
  else if (room.phase === 'reveal') renderPlayerReveal();
  else renderPlayerGameover();
}

function renderPlayerLobby() {
  const countdown = room.lobby_stage === 'countdown';
  const seconds = Math.max(0, Math.ceil((new Date(room.lobby_deadline).getTime() - Date.now()) / 1000));
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">You're in the room!</p><h2>Welcome, <em>${escapeHtml(player.nickname)}</em>.</h2><div class="viewer-wait-card"><strong>${countdown ? `Game starts in ${formatSeconds(seconds)}` : 'Waiting for one more brave player...'}</strong><span>${countdown ? 'The streamer can see you. Get your brain ready!' : 'Share the link with a friend. If nobody arrives, the game starts solo after five minutes.'}</span></div><div class="viewer-player-count"><strong>${players.length}</strong><span>players in the room</span></div></div>`;
  scheduleRefresh(1000);
}

function renderPlayerEliminated() {
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">Spectator mode</p><h2>You're out, but the chaos continues!</h2><div class="viewer-wait-card"><strong>Watch the stream for the next bonk.</strong><span>You can stay here and follow the game while the remaining players battle it out.</span></div></div>`;
  scheduleRefresh(2000);
}

function renderPlayerVoting() {
  const seconds = Math.max(0, Math.ceil((new Date(room.round_deadline).getTime() - Date.now()) / 1000));
  const locked = Boolean(myVote);
  joinScreen.innerHTML = `<div class="viewer-play"><div class="round-meta"><p class="eyebrow" style="margin:0;">Round ${room.round_number} / ${room.total_rounds}</p><span class="pill pill--accent">${formatSeconds(seconds)} left</span></div><p class="eyebrow">${escapeHtml(player.nickname)}, lock in!</p><h2>${escapeHtml(round.question_public.question)}</h2><div class="viewer-answer-grid">${round.question_public.options.map((option, index) => `<button class="viewer-answer ${myVote?.option_index === index ? 'selected' : ''}" data-option="${index}" ${locked ? 'disabled' : ''}><span>${'ABCD'[index]}</span>${escapeHtml(option)}</button>`).join('')}</div><div class="viewer-vote-state ${locked ? 'is-locked' : ''}">${locked ? 'Vote locked! Watch the stream for the reveal.' : 'Pick one answer. You only get one shot!'}</div></div>`;
  document.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => submitVote(Number(button.dataset.option))));
  scheduleRefresh(1000);
}

async function submitVote(optionIndex) {
  if (busy || myVote) return;
  busy = true;
  try {
    await ChatSupabase.submitVote(room.id, player.id, room.round_number, optionIndex);
    myVote = { option_index: optionIndex };
    renderPlayerVoting();
  } catch (error) {
    errorMessage = error.message || 'Your answer did not get through. Try again.';
    renderError();
  } finally {
    busy = false;
  }
}

function renderPlayerReveal() {
  const hasResult = Boolean(outcome);
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">${hasResult ? 'Reveal complete!' : 'The answer is being revealed!'}</p><h2>${hasResult ? (outcome.survived ? 'You survived the bonk!' : 'Watch the stream for the <em>bonk.</em>') : 'Watch the stream for the <em>bonk.</em>'}</h2><div class="viewer-wait-card"><strong>${hasResult ? escapeHtml(outcome.message) : 'The cards are doing their thing...'}</strong><span>${hasResult ? (outcome.survived ? 'You live to quiz another day.' : 'That answer sent you flying. You can watch the rest of the chaos.') : 'Your result will appear here when the reveal finishes.'}</span></div></div>`;
  scheduleRefresh(1000);
}

function renderPlayerGameover() {
  joinScreen.innerHTML = `<div class="viewer-center"><p class="eyebrow">Game over!</p><h2>${outcome?.survived ? 'You made it to the end!' : 'The quiz has ended.'}</h2><p class="small">Thanks for playing, ${escapeHtml(player.nickname)}. Check the stream for the final leaderboard.</p></div>`;
}

function scheduleRefresh(delay) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), delay);
}

renderJoin();
discoverRoom();
