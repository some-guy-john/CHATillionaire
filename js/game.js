const Game = (() => {
  const LETTERS = ['A', 'B', 'C', 'D'];
  const POLL_MS = 1000;
  const MAX_BACKOFF_MS = 10000;

  let config = { totalRounds: 10, timerSeconds: 30, speedupEnabled: true, sfxEnabled: true };
  let remote = null;
  let room = null;
  let players = [];
  let lastResult = null;
  let votes = new Map();
  let revealOrder = [];
  let revealedIndices = new Set();
  let revealVerdicts = new Set();
  let revealStep = 0;
  let revealMode = '';
  let revealLastVerdictIndex = null;
  let revealGag = '';
  let revealVariant = null;
  let revealLine = '';
  let revealComplete = false;
  let revealRoomRound = null;
  let revealHandle = null;
  let pollHandle = null;
  let pollInFlight = false;
  let pollDelay = POLL_MS;
  let listeners = [];
  let errorMessage = '';
  let connection = 'offline';
  let requestSequence = 0;
  let appliedSequence = 0;
  let pendingCreationToken = null;
  let restoreHandle = null;
  let state = makeState();

  function onChange(callback) { listeners.push(callback); }
  function emit() {
    state = makeState();
    listeners.forEach(callback => callback(state));
  }

  function makeState() {
    const phase = room?.phase || 'setup';
    const alive = players.filter(player => player.alive).length;
    const now = Date.now();
    const deadline = phase === 'lobby' ? room?.lobby_deadline : room?.round_deadline;
    return {
      phase,
      room,
      roomCode: room?.code || '',
      joinUrl: room ? buildJoinUrl(room.code) : '',
      players: players.map(player => ({ ...player, name: player.nickname })),
      roundNumber: room?.round_number || 0,
      totalRounds: room?.total_rounds || config.totalRounds,
      currentQuestion: room?.current_question || null,
      votes,
      timeLeft: deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000)) : 0,
      sped: false,
      lastResult,
      revealOrder,
      revealedIndices,
      revealVerdicts,
      revealLastVerdictIndex,
      revealGag,
      revealVariant,
      revealLine,
      revealMode,
      revealComplete,
      lobbyStage: room?.lobby_stage || 'waiting',
      lobbySeconds: room?.lobby_deadline ? Math.max(0, Math.ceil((new Date(room.lobby_deadline).getTime() - now) / 1000)) : 0,
      autoNextAt: room?.next_round_at ? new Date(room.next_round_at).getTime() : null,
      alive,
      error: errorMessage,
      connection,
      config: { ...config }
    };
  }

  function buildJoinUrl(code) {
    const url = new URL('join.html', window.location.href);
    url.searchParams.set('room', code);
    return url.href;
  }

  function normalizeConfig(next) {
    config = {
      totalRounds: Math.max(1, Math.min(Number(next.totalRounds) || 10, 10)),
      timerSeconds: Math.max(5, Math.min(Number(next.timerSeconds) || 30, 120)),
      speedupEnabled: next.speedupEnabled !== false,
      sfxEnabled: next.sfxEnabled !== false
    };
    SFX.setEnabled(config.sfxEnabled);
  }

  async function createRoom(nextConfig) {
    stopPolling();
    cancelRestore();
    errorMessage = '';
    normalizeConfig(nextConfig);
    connection = 'connecting';
    emit();
    pendingCreationToken ||= crypto.randomUUID();
    const sequence = ++requestSequence;
    try {
      const payload = await ChatSupabase.createRoom(config, pendingCreationToken);
      applyRemote(payload, true, sequence, true);
      pendingCreationToken = null;
      saveHostRoom(room);
      startPolling();
    } catch (error) {
      connection = 'offline';
      errorMessage = error.message || 'Could not create the room.';
      emit();
      throw error;
    }
  }

  async function restoreRoom() {
    restoreHandle = null;
    const saved = readHostRoom();
    if (!saved) return false;
    connection = 'connecting';
    try {
      const sequence = ++requestSequence;
      const payload = await ChatSupabase.getHostState(saved.id);
      if (!payload?.room) {
        clearHostRoom();
        connection = 'offline';
        errorMessage = 'Your saved room is no longer available. Create a new room.';
        emit();
        return false;
      }
      applyRemote(payload, false, sequence, true);
      startPolling();
      emit();
      return true;
    } catch (error) {
      errorMessage = error.message || 'Could not restore the room. Retrying is safe.';
      connection = 'reconnecting';
      emit();
      if (restoreHandle) clearTimeout(restoreHandle);
      restoreHandle = setTimeout(() => restoreRoom(), 3000);
      return false;
    }
  }

  function applyRemote(payload, shouldEmit = true, sequence = ++requestSequence, allowRoomChange = false) {
    if (!payload?.room) return;
    if (sequence < appliedSequence) return;
    if (!allowRoomChange && room && payload.room.id !== room.id) return;
    appliedSequence = sequence;
    const previousPhase = room?.phase;
    const previousRound = room?.round_number;
    remote = payload;
    room = payload.room;
    players = payload.players || [];
    votes = new Map(players.filter(player => player.has_voted).map(player => [player.nickname.toLowerCase(), null]));
    config = {
      totalRounds: room.total_rounds,
      timerSeconds: room.timer_seconds,
      speedupEnabled: room.speedup_enabled,
      sfxEnabled: room.sfx_enabled
    };
    SFX.setEnabled(config.sfxEnabled);
    connection = 'online';
    errorMessage = '';

    if (room.phase === 'reveal' && payload.reveal) {
      lastResult = payload.reveal;
      const newReveal = previousPhase !== 'reveal' || previousRound !== room.round_number || revealRoomRound !== room.round_number;
      if (room.reveal_complete) {
        completeRevealLocally();
      } else if (newReveal && !revealHandle) {
        startReveal();
      }
    } else if (room.phase !== 'reveal') {
      clearReveal();
    }

    if (shouldEmit) emit();
  }

  function startPolling() {
    stopPolling();
    pollDelay = POLL_MS;
    schedulePoll(0);
  }

  function stopPolling() {
    if (pollHandle) clearTimeout(pollHandle);
    pollHandle = null;
    pollInFlight = false;
  }

  function schedulePoll(delay = pollDelay) {
    if (!room || room.phase === 'gameover') return;
    if (pollHandle) clearTimeout(pollHandle);
    pollHandle = setTimeout(poll, delay);
  }

  async function poll() {
    pollHandle = null;
    if (!room || pollInFlight) return schedulePoll();
    pollInFlight = true;
    const sequence = ++requestSequence;
    try {
      const payload = await ChatSupabase.tickRoom(room.id);
      applyRemote(payload, true, sequence);
      pollDelay = POLL_MS;
    } catch (error) {
      connection = 'reconnecting';
      errorMessage = error.message || 'Reconnecting to the room...';
      pollDelay = Math.min(pollDelay * 2, MAX_BACKOFF_MS);
      emit();
    } finally {
      pollInFlight = false;
      schedulePoll();
    }
  }

  async function forceEndRound() {
    if (!room || room.phase !== 'voting') return;
    try {
      const sequence = ++requestSequence;
      const payload = await ChatSupabase.forceCloseRound(room.id);
      applyRemote(payload, true, sequence);
    } catch (error) {
      errorMessage = error.message || 'Could not close voting. Try again.';
      emit();
      throw error;
    }
  }

  async function finishReveal() {
    if (!room || room.phase !== 'reveal') return;
    try {
      const sequence = ++requestSequence;
      const payload = await ChatSupabase.finishReveal(room.id);
      applyRemote(payload, true, sequence);
    } catch (error) {
      errorMessage = error.message || 'Could not finish the reveal. Retrying...';
      emit();
    }
  }

  async function createAnotherRoom() {
    const oldRoom = room;
    stopPolling();
    if (oldRoom) {
      try {
        await ChatSupabase.endRoom(oldRoom.id);
      } catch (error) {
        errorMessage = error.message || 'Could not end this room. Try again.';
        emit();
        throw error;
      }
    }
    clearHostRoom();
    resetLocal();
    emit();
  }

  function buildRevealPlan(correctIndex) {
    const wrong = LETTERS.map((_, index) => index).filter(index => index !== correctIndex);
    const countVotes = index => lastResult.voteCounts[index] || 0;
    const modes = [
      { name: 'crowd favorite', order: [...wrong].sort((a, b) => countVotes(b) - countVotes(a)), delays: [700, 800, 900] },
      { name: 'plot twist', order: [...wrong].reverse(), delays: [850, 650, 950] },
      { name: 'hot potato', order: [...wrong].sort(() => Math.random() - 0.5), delays: [700, 900, 650] }
    ];
    const mode = modes[Math.floor(Math.random() * modes.length)];
    return { ...mode, order: [...mode.order, correctIndex] };
  }

  function startReveal() {
    clearRevealTimers();
    revealRoomRound = room.round_number;
    revealComplete = false;
    const plan = buildRevealPlan(lastResult.correctIndex);
    revealOrder = plan.order;
    revealMode = plan.name;
    revealedIndices = new Set();
    revealVerdicts = new Set();
    revealStep = 0;
    revealLastVerdictIndex = null;
    revealGag = '';
    revealVariant = null;
    revealLine = '';
    SFX.play('reveal-start');
    revealHandle = setTimeout(() => advanceReveal(plan.delays), 800);
  }

  function advanceReveal(delays) {
    revealHandle = null;
    const index = revealOrder[revealStep];
    if (index === undefined) return;
    revealLastVerdictIndex = null;
    revealedIndices.add(index);
    revealStep += 1;
    emit();
    revealHandle = setTimeout(() => resolveReveal(index, delays), delays[revealStep - 1] || 700);
  }

  function resolveReveal(index, delays) {
    revealHandle = null;
    revealVerdicts.add(index);
    revealLastVerdictIndex = index;
    revealGag = index === lastResult.correctIndex ? 'crown' : Gags.deal();
    revealVariant = Gags.rollVariant(revealGag);
    revealLine = Gags.line(revealGag);
    SFX.play(index === lastResult.correctIndex ? 'correct' : 'wrong');
    emit();
    const hasVoters = (lastResult.voteCounts[index] || 0) > 0;
    if (revealStep < revealOrder.length) {
      revealHandle = setTimeout(() => advanceReveal(delays), hasVoters ? (index === lastResult.correctIndex ? 1700 : 2300) : 800);
    } else {
      revealHandle = setTimeout(() => finishReveal(), hasVoters ? 1700 : 1250);
    }
  }

  function completeRevealLocally() {
    clearRevealTimers();
    if (!lastResult?.question?.options) return;
    const indices = lastResult.question.options.map((_, index) => index);
    revealRoomRound = room.round_number;
    revealOrder = indices;
    revealedIndices = new Set(indices);
    revealVerdicts = new Set(indices);
    revealMode = 'final standings';
    revealLastVerdictIndex = null;
    revealGag = '';
    revealVariant = null;
    revealLine = '';
    revealComplete = true;
  }

  function clearRevealTimers() {
    if (revealHandle) clearTimeout(revealHandle);
    revealHandle = null;
  }

  function clearReveal() {
    clearRevealTimers();
    lastResult = null;
    revealOrder = [];
    revealedIndices = new Set();
    revealVerdicts = new Set();
    revealStep = 0;
    revealMode = '';
    revealLastVerdictIndex = null;
    revealGag = '';
    revealVariant = null;
    revealLine = '';
    revealComplete = false;
    revealRoomRound = null;
  }

  function resetLocal() {
    requestSequence += 1;
    appliedSequence = requestSequence;
    stopPolling();
    clearReveal();
    remote = null;
    room = null;
    players = [];
    votes = new Map();
    connection = 'offline';
    errorMessage = '';
    pendingCreationToken = null;
    cancelRestore();
  }

  function cancelRestore() {
    if (restoreHandle) clearTimeout(restoreHandle);
    restoreHandle = null;
  }

  function saveHostRoom(savedRoom) {
    try {
      localStorage.setItem('chatillionaire-host-room', JSON.stringify({ id: savedRoom.id, code: savedRoom.code }));
    } catch {
      errorMessage = 'This browser could not remember the room. Keep this tab open.';
    }
  }
  function readHostRoom() {
    try {
      const saved = JSON.parse(localStorage.getItem('chatillionaire-host-room'));
      return saved && typeof saved.id === 'string' ? saved : null;
    } catch { return null; }
  }
  function clearHostRoom() {
    try { localStorage.removeItem('chatillionaire-host-room'); } catch { /* Nothing else to clear. */ }
  }

  return {
    onChange,
    createRoom,
    restoreRoom,
    forceEndRound,
    createAnotherRoom,
    getState: () => state
  };
})();
