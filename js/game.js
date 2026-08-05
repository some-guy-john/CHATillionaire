const Game = (() => {
  const LOBBY_MAX_MS = 5 * 60 * 1000;
  const SECOND_PLAYER_COUNTDOWN_MS = 30 * 1000;
  const AUTO_NEXT_MS = 4 * 1000;
  const SHORTENED_SECONDS = 12;
  const LETTERS = ['A', 'B', 'C', 'D'];

  let questionBank = null;
  let config = { totalRounds: 10, timerSeconds: 30, speedupEnabled: true, sfxEnabled: true };
  let room = null;
  let players = [];
  let currentQuestion = null;
  let currentRound = null;
  let roundSecret = null;
  let votes = new Map();
  let sped = false;
  let usedQuestionIds = new Set();
  let revealOrder = [];
  let revealedIndices = new Set();
  let revealVerdicts = new Set();
  let revealStep = 0;
  let revealMode = '';
  let revealLastVerdictIndex = null;
  let revealGag = '';
  let revealComplete = false;
  let lastResult = null;
  let lobbySeconds = 0;
  let autoNextAt = null;
  let phaseTimer = null;
  let revealHandle = null;
  let autoNextHandle = null;
  let subscription = null;
  let transitionLock = false;
  let listeners = [];
  let errorMessage = '';
  let state = makeState();

  function onChange(callback) { listeners.push(callback); }
  function emit() {
    state = makeState();
    listeners.forEach(callback => callback(state));
  }

  function makeState() {
    const phase = room?.phase || 'setup';
    const question = currentQuestion || room?.current_question || null;
    const alive = players.filter(player => player.alive).length;
    return {
      phase,
      room,
      roomCode: room?.code || '',
      joinUrl: room ? buildJoinUrl(room.code) : '',
      players: players.map(player => ({ ...player, name: player.nickname })),
      roundNumber: room?.round_number || 0,
      totalRounds: room?.total_rounds || config.totalRounds,
      currentQuestion: question,
      votes,
      timeLeft: room?.phase === 'voting' ? Math.max(0, Math.ceil((new Date(room.round_deadline).getTime() - Date.now()) / 1000)) : 0,
      sped,
      lastResult,
      revealOrder,
      revealedIndices,
      revealVerdicts,
      revealLastVerdictIndex,
      revealGag,
      revealMode,
      revealComplete,
      lobbyStage: room?.lobby_stage || 'waiting',
      lobbyDeadline: room?.lobby_deadline || null,
      lobbySeconds,
      autoNextAt,
      alive,
      error: errorMessage,
      config: { ...config, channel: room?.code || '' }
    };
  }

  function buildJoinUrl(code) {
    const url = new URL('join.html', window.location.href);
    url.searchParams.set('room', code);
    return url.href;
  }

  function setQuestionBank(bank) { questionBank = bank; }

  function normalizeConfig(next) {
    config = {
      ...config,
      totalRounds: Math.max(1, Math.min(Number(next.totalRounds) || 10, questionBank?.rounds.length || 10)),
      timerSeconds: Math.max(5, Math.min(Number(next.timerSeconds) || 30, 120)),
      speedupEnabled: next.speedupEnabled !== false,
      sfxEnabled: next.sfxEnabled !== false
    };
    SFX.setEnabled(config.sfxEnabled);
  }

  async function createRoom(nextConfig) {
    clearTimers();
    errorMessage = '';
    normalizeConfig(nextConfig);
    room = await ChatSupabase.createRoom(config);
    usedQuestionIds = new Set();
    players = [];
    currentQuestion = null;
    currentRound = null;
    roundSecret = null;
    votes = new Map();
    sped = false;
    lastResult = null;
    revealComplete = false;
    saveHostRoom(room);
    await loadPlayers();
    subscribe();
    startPhaseTimer();
    emit();
  }

  async function restoreRoom() {
    const saved = readHostRoom();
    if (!saved) return false;
    try {
      const user = await ChatSupabase.ensureAuth();
      const restored = await ChatSupabase.getRoom(saved.id);
      if (!restored || restored.host_user_id !== user.id) return false;
      room = restored;
      lobbySeconds = room.lobby_deadline
        ? Math.max(0, Math.ceil((new Date(room.lobby_deadline).getTime() - Date.now()) / 1000))
        : 0;
      config = {
        ...config,
        totalRounds: restored.total_rounds,
        timerSeconds: restored.timer_seconds,
        speedupEnabled: restored.speedup_enabled,
        sfxEnabled: restored.sfx_enabled
      };
      SFX.setEnabled(config.sfxEnabled);
      await loadPlayers();
      if (room.phase === 'voting') {
        currentQuestion = room.current_question;
        currentRound = await ChatSupabase.getRound(room.id, room.round_number);
        roundSecret = currentRound.answer_index;
        await loadVotes();
        sped = false;
      } else if (room.phase === 'reveal') {
        currentQuestion = room.current_question;
        currentRound = await ChatSupabase.getRound(room.id, room.round_number);
        roundSecret = currentRound.answer_index;
        await loadVotes();
        const outcomes = await ChatSupabase.getOutcomes(room.id, room.round_number);
        lastResult = makeRoundResult(outcomes);
        revealComplete = room.reveal_complete;
        if (revealComplete) {
          const allIndices = currentQuestion.options.map((_, index) => index);
          revealOrder = allIndices;
          revealedIndices = new Set(allIndices);
          revealVerdicts = new Set(allIndices);
          revealMode = 'final standings';
          revealLastVerdictIndex = null;
          revealGag = '';
          autoNextAt = Date.now() + AUTO_NEXT_MS;
        } else {
          const plan = buildRevealPlan(lastResult.correctIndex);
          revealOrder = plan.order;
          revealMode = plan.name;
          revealedIndices = new Set();
          revealVerdicts = new Set();
          revealStep = 0;
          revealLastVerdictIndex = null;
          revealGag = '';
          revealHandle = setTimeout(() => advanceReveal(plan.delays), 800);
        }
      }
      subscribe();
      startPhaseTimer();
      emit();
      return true;
    } catch {
      clearHostRoom();
      return false;
    }
  }

  async function loadPlayers() {
    if (!room) return;
    players = await ChatSupabase.getPlayers(room.id);
    emit();
  }

  async function loadVotes() {
    if (!room || !['voting', 'reveal'].includes(room.phase)) return;
    const rawVotes = await ChatSupabase.getVotes(room.id, room.round_number);
    votes = new Map(rawVotes.map(vote => {
      const player = players.find(item => item.id === vote.player_id);
      return [player ? player.nickname.toLowerCase() : vote.player_id, vote.option_index];
    }));
    emit();
  }

  function subscribe() {
    if (subscription || !room) return;
    subscription = ChatSupabase.subscribeRoom(room.id, async payload => {
      if (payload?.table === 'players' || !payload) await loadPlayers();
      if (room?.phase === 'voting' && (payload?.table === 'votes' || !payload)) await loadVotes();
      if (room?.phase === 'lobby') {
        await refreshRoom();
        if (room?.phase === 'lobby') await lobbyTick(Date.now());
      }
    });
  }

  async function refreshRoom() {
    if (!room || transitionLock) return;
    const latest = await ChatSupabase.getRoom(room.id);
    if (latest.phase !== room.phase || latest.round_number !== room.round_number) {
      room = latest;
      if (room.phase === 'voting') {
        currentQuestion = room.current_question;
        currentRound = await ChatSupabase.getRound(room.id, room.round_number);
        roundSecret = currentRound.answer_index;
        await loadVotes();
      }
    } else {
      room = latest;
    }
    emit();
  }

  function startPhaseTimer() {
    if (phaseTimer) return;
    phaseTimer = setInterval(() => tick().catch(showError), 1000);
  }

  async function tick() {
    if (!room || transitionLock) return;
    const now = Date.now();
    if (room.phase === 'lobby') {
      lobbySeconds = Math.max(0, Math.ceil((new Date(room.lobby_deadline).getTime() - now) / 1000));
      if (lobbySeconds === 0 || players.length >= 2) {
        await loadPlayers();
        await lobbyTick(now);
      } else {
        emit();
      }
      return;
    }

    if (room.phase === 'voting') {
      await loadVotes();
      await maybeSpeedUp();
      const aliveIds = new Set(players.filter(player => player.alive).map(player => player.id));
      const answered = [...votes.keys()].filter(key => {
        const player = players.find(item => item.nickname.toLowerCase() === key || item.id === key);
        return player && aliveIds.has(player.id);
      }).length;
      const deadlineReached = !room.round_deadline || new Date(room.round_deadline).getTime() <= now;
      if (deadlineReached || (aliveIds.size > 0 && answered >= aliveIds.size)) {
        await finishVoting();
      } else {
        emit();
      }
      return;
    }

    if (room.phase === 'reveal' && revealComplete && autoNextAt) {
      emit();
      if (now >= autoNextAt && !autoNextHandle) await nextRound();
    }
  }

  async function lobbyTick(now) {
    if (room.lobby_stage === 'waiting' && players.length >= 2) {
      room = await ChatSupabase.updateRoom(room.id, {
        lobby_stage: 'countdown',
        lobby_deadline: new Date(now + SECOND_PLAYER_COUNTDOWN_MS).toISOString()
      });
      lobbySeconds = 30;
      emit();
      return;
    }

    if (room.lobby_stage === 'countdown' && players.length >= 1 && new Date(room.lobby_deadline).getTime() <= now) {
      await startRound(1);
      return;
    }

    if (room.lobby_stage === 'waiting' && players.length === 1 && new Date(room.lobby_deadline).getTime() <= now) {
      await startRound(1);
      return;
    }

    emit();
  }

  function pickQuestion(roundNumber) {
    const roundData = questionBank.rounds.find(round => round.round === roundNumber);
    const pool = roundData.pool.filter(question => !usedQuestionIds.has(question.id));
    const source = pool.length ? pool : roundData.pool;
    const question = source[Math.floor(Math.random() * source.length)];
    usedQuestionIds.add(question.id);
    return question;
  }

  function publicQuestion(question) {
    return {
      id: question.id,
      question: question.question,
      options: question.options
    };
  }

  async function startRound(roundNumber) {
    if (transitionLock || !room) return;
    transitionLock = true;
    try {
      const question = pickQuestion(roundNumber);
      const startedAt = new Date();
      const deadline = new Date(startedAt.getTime() + config.timerSeconds * 1000);
      currentQuestion = publicQuestion(question);
      currentRound = await ChatSupabase.createRound({
        room_id: room.id,
        round_number: roundNumber,
        question_id: question.id,
        question_public: currentQuestion,
        answer_index: question.answerIndex,
        started_at: startedAt.toISOString(),
        round_deadline: deadline.toISOString()
      });
      roundSecret = question.answerIndex;
      votes = new Map();
      sped = false;
      lastResult = null;
      revealComplete = false;
      autoNextAt = null;
      room = await ChatSupabase.updateRoom(room.id, {
        phase: 'voting',
        lobby_stage: 'waiting',
        lobby_deadline: null,
        round_number: roundNumber,
        current_question: currentQuestion,
        round_started_at: startedAt.toISOString(),
        round_deadline: deadline.toISOString(),
        reveal_complete: false
      });
      emit();
    } finally {
      transitionLock = false;
    }
  }

  function parseVoteLetter(message) {
    const cleaned = String(message).trim().toUpperCase();
    if (LETTERS.includes(cleaned)) return LETTERS.indexOf(cleaned);
    if (['1', '2', '3', '4'].includes(cleaned)) return Number(cleaned) - 1;
    return null;
  }

  function buildRevealPlan(correctIndex) {
    const wrong = LETTERS.map((_, index) => index).filter(index => index !== correctIndex);
    const countVotes = index => [...votes.values()].filter(vote => vote === index).length;
    const most = [...wrong].sort((a, b) => countVotes(b) - countVotes(a));
    const modes = [
      { name: 'crowd favorite', order: most, delays: [700, 800, 900] },
      { name: 'plot twist', order: [...wrong].reverse(), delays: [850, 650, 950] },
      { name: 'hot potato', order: [...wrong].sort(() => Math.random() - 0.5), delays: [700, 900, 650] }
    ];
    const mode = modes[Math.floor(Math.random() * modes.length)];
    return { ...mode, order: [...mode.order, correctIndex] };
  }

  function makeRoundResult(savedOutcomes = null) {
    const count = currentQuestion.options.map((_, index) => [...votes.values()].filter(vote => vote === index).length);
    const source = savedOutcomes?.length
      ? savedOutcomes.map(outcome => {
        const player = players.find(item => item.id === outcome.player_id);
        return {
          id: outcome.player_id,
          userId: outcome.user_id,
          name: player?.nickname || 'Unknown player',
          vote: outcome.vote_index,
          correct: outcome.survived,
          reason: outcome.message
        };
      })
      : players.filter(player => player.alive).map(player => {
        const vote = votes.get(player.nickname.toLowerCase()) ?? null;
        return {
          id: player.id,
          userId: player.user_id,
          name: player.nickname,
          vote,
          correct: vote === roundSecret,
          reason: vote === null ? 'no answer' : `voted ${LETTERS[vote]}`
        };
      });
    const playerResults = source;
    return {
      question: currentQuestion,
      correctIndex: roundSecret,
      voteCounts: count,
      playerResults,
      eliminated: playerResults.filter(result => !result.correct).map(result => ({ name: result.name, reason: result.reason }))
    };
  }

  async function finishVoting() {
    if (transitionLock || !room || room.phase !== 'voting') return;
    transitionLock = true;
    try {
      await loadVotes();
      lastResult = makeRoundResult();
      const plan = buildRevealPlan(lastResult.correctIndex);
      revealOrder = plan.order;
      revealMode = plan.name;
      revealedIndices = new Set();
      revealVerdicts = new Set();
      revealStep = 0;
      revealLastVerdictIndex = null;
      revealGag = '';
      revealComplete = false;
      room = await ChatSupabase.updateRoom(room.id, { phase: 'reveal', reveal_complete: false });
      SFX.play('reveal-start');
      emit();
      revealHandle = setTimeout(() => advanceReveal(plan.delays), 800);
    } finally {
      transitionLock = false;
    }
  }

  async function maybeSpeedUp() {
    if (!config.speedupEnabled || sped || !room || room.phase !== 'voting') return;
    const alive = players.filter(player => player.alive);
    const answered = [...votes.keys()].filter(key => alive.some(player => (
      player.id === key || player.nickname.toLowerCase() === key
    ))).length;
    if (!alive.length || answered < Math.ceil(alive.length / 2)) return;

    const shortenedDeadline = Date.now() + SHORTENED_SECONDS * 1000;
    const currentDeadline = new Date(room.round_deadline).getTime();
    sped = true;
    if (currentDeadline > shortenedDeadline) {
      room = await ChatSupabase.updateRoom(room.id, {
        round_deadline: new Date(shortenedDeadline).toISOString()
      });
    }
    emit();
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
    revealGag = index === lastResult.correctIndex ? 'confetti' : pickGag(index);
    SFX.play(index === lastResult.correctIndex ? 'correct' : 'wrong');
    emit();
    const hasVoters = lastResult.voteCounts[index] > 0;
    if (revealStep < revealOrder.length) {
      revealHandle = setTimeout(() => advanceReveal(delays), hasVoters ? (index === lastResult.correctIndex ? 1700 : 2300) : 800);
    } else {
      revealHandle = setTimeout(finishReveal, hasVoters ? 1700 : 1250);
    }
  }

  function pickGag(index) {
    return ['kick', 'burn', 'trapdoor', 'rocket'][(room.round_number + index + revealStep) % 4];
  }

  async function finishReveal() {
    if (transitionLock) return;
    transitionLock = true;
    revealHandle = null;
    try {
      const points = room.round_number * 10;
      const outcomes = lastResult.playerResults.map(result => ({
        room_id: room.id,
        player_id: result.id,
        user_id: result.userId,
        round_number: room.round_number,
        survived: result.correct,
        vote_index: result.vote,
        message: result.correct ? 'Nailed it!' : result.vote === null ? 'No answer - bonked!' : 'Bonked!'
      }));
      await Promise.all(lastResult.playerResults.map(result => ChatSupabase.updatePlayer(result.id, {
        alive: result.correct,
        score: result.correct ? (players.find(player => player.id === result.id).score + points) : players.find(player => player.id === result.id).score
      })));
      await Promise.all(outcomes.map(outcome => ChatSupabase.createOutcome(outcome)));
      players = await ChatSupabase.getPlayers(room.id);
      revealComplete = true;
      revealLastVerdictIndex = null;
      revealGag = '';
      autoNextAt = Date.now() + AUTO_NEXT_MS;
      room = await ChatSupabase.updateRoom(room.id, { reveal_complete: true });
      SFX.play('finish');
      emit();
    } finally {
      transitionLock = false;
    }
  }

  async function nextRound() {
    if (transitionLock || !room || room.phase !== 'reveal' || !revealComplete) return;
    transitionLock = true;
    try {
      autoNextAt = null;
      const alive = players.filter(player => player.alive).length;
      if (room.round_number >= room.total_rounds || alive === 0) {
        room = await ChatSupabase.updateRoom(room.id, { phase: 'gameover' });
        emit();
        return;
      }
      transitionLock = false;
      await startRound(room.round_number + 1);
    } finally {
      transitionLock = false;
    }
  }

  function forceEndRound() {
    if (room?.phase === 'voting') finishVoting().catch(showError);
  }

  function clearTimers() {
    if (phaseTimer) clearInterval(phaseTimer);
    if (revealHandle) clearTimeout(revealHandle);
    if (autoNextHandle) clearTimeout(autoNextHandle);
    phaseTimer = null;
    revealHandle = null;
    autoNextHandle = null;
    if (subscription) ChatSupabase.unsubscribe(subscription);
    subscription = null;
  }

  function showError(error) {
    errorMessage = error.message || 'Something went wrong.';
    emit();
  }

  function saveHostRoom(savedRoom) {
    localStorage.setItem('chatillionaire-host-room', JSON.stringify({ id: savedRoom.id, code: savedRoom.code }));
  }
  function readHostRoom() {
    try { return JSON.parse(localStorage.getItem('chatillionaire-host-room')); } catch { return null; }
  }
  function clearHostRoom() { localStorage.removeItem('chatillionaire-host-room'); }

  return {
    onChange,
    setQuestionBank,
    createRoom,
    restoreRoom,
    forceEndRound,
    nextRound,
    getState: () => state
  };
})();
