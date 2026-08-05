const Game = (() => {
  const SHORTENED_SECONDS = 12;
  const LETTERS = ['A', 'B', 'C', 'D'];

  let questionBank = null;
  let config = { channel: '', totalRounds: 10, timerSeconds: 30, speedupEnabled: true, sfxEnabled: true };
  let phase = 'setup';
  let players = new Map();
  let roundIndex = 0;
  let currentQuestion = null;
  let votes = new Map();
  let usedQuestionIds = new Set();
  let timeLeft = 0;
  let sped = false;
  let timerHandle = null;
  let revealHandle = null;
  let lastResult = null;
  let revealOrder = [];
  let revealedIndices = new Set();
  let revealVerdicts = new Set();
  let revealStep = 0;
  let revealMode = '';
  let revealLastVerdictIndex = null;
  let revealGag = '';
  let revealComplete = false;
  let listeners = [];

  function onChange(cb) { listeners.push(cb); }
  function emit() { listeners.forEach(cb => cb(getState())); }

  function setQuestionBank(bank) { questionBank = bank; }

  function configure(newConfig) {
    config = { ...config, ...newConfig };
    if (questionBank) {
      config.totalRounds = Math.max(1, Math.min(Number(config.totalRounds) || 10, questionBank.rounds.length));
    }
    config.timerSeconds = Math.max(5, Math.min(Number(config.timerSeconds) || 30, 120));
    SFX.setEnabled(config.sfxEnabled);
  }

  function resetGame() {
    stopTimer();
    stopReveal();
    SFX.stop();
    phase = 'lobby';
    players = new Map();
    roundIndex = 0;
    currentQuestion = null;
    votes = new Map();
    usedQuestionIds = new Set();
    lastResult = null;
    revealOrder = [];
    revealedIndices = new Set();
    revealVerdicts = new Set();
    revealStep = 0;
    revealMode = '';
    revealLastVerdictIndex = null;
    revealGag = '';
    revealComplete = false;
    emit();
  }

  function normalizeName(name) { return name.toLowerCase(); }

  function addPlayer(username) {
    const key = normalizeName(username);
    if (players.has(key)) return;
    players.set(key, { name: username, alive: true, score: 0 });
    emit();
  }

  function alivePlayers() {
    return [...players.values()].filter(p => p.alive);
  }

  function startGame() {
    if (players.size === 0) return;
    phase = 'voting';
    roundIndex = 0;
    startRound();
  }

  function pickQuestion(roundNumber) {
    const roundData = questionBank.rounds.find(r => r.round === roundNumber);
    const pool = roundData.pool.filter(q => !usedQuestionIds.has(q.id));
    const source = pool.length > 0 ? pool : roundData.pool;
    const q = source[Math.floor(Math.random() * source.length)];
    usedQuestionIds.add(q.id);
    return q;
  }

  function startRound() {
    stopTimer();
    stopReveal();
    phase = 'voting';
    currentQuestion = pickQuestion(roundIndex + 1);
    votes = new Map();
    timeLeft = config.timerSeconds;
    sped = false;
    lastResult = null;
    revealOrder = [];
    revealedIndices = new Set();
    revealVerdicts = new Set();
    revealStep = 0;
    revealMode = '';
    revealLastVerdictIndex = null;
    revealGag = '';
    revealComplete = false;

    timerHandle = setInterval(tick, 1000);
    emit();
  }

  function parseVoteLetter(message) {
    const cleaned = message.trim().toUpperCase();
    if (LETTERS.includes(cleaned)) return LETTERS.indexOf(cleaned);
    if (['1', '2', '3', '4'].includes(cleaned)) return Number(cleaned) - 1;
    return null;
  }

  function handleChatMessage(username, message) {
    if (phase === 'lobby') {
      if (message.trim().toLowerCase() === '!join') {
        addPlayer(username);
      }
      return;
    }

    if (phase !== 'voting') return;

    const key = normalizeName(username);
    const player = players.get(key);
    if (!player || !player.alive) return;
    if (votes.has(key)) return;

    const optionIndex = parseVoteLetter(message);
    if (optionIndex === null || optionIndex >= currentQuestion.options.length) return;

    votes.set(key, optionIndex);
    if (votes.size >= alivePlayers().length) {
      endRound();
      return;
    }
    checkSpeedup();
    emit();
  }

  function checkSpeedup() {
    if (!config.speedupEnabled || sped) return;
    const alive = alivePlayers().length;
    const answered = votes.size;
    if (answered >= Math.ceil(alive / 2)) {
      timeLeft = Math.min(timeLeft, SHORTENED_SECONDS);
      sped = true;
    }
  }

  function tick() {
    timeLeft -= 1;
    if (timeLeft <= 0) {
      endRound();
    } else {
      emit();
    }
  }

  function forceEndRound() {
    if (phase !== 'voting') return;
    endRound();
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function stopReveal() {
    if (revealHandle) {
      clearTimeout(revealHandle);
      revealHandle = null;
    }
  }

  function shuffle(values) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function buildRevealPlan(correctIndex) {
    const wrongIndices = LETTERS.map((_, index) => index).filter(index => index !== correctIndex);
    const countVotes = index => [...votes.values()].filter(vote => vote === index).length;
    const byMostVotes = [...wrongIndices].sort((a, b) => countVotes(b) - countVotes(a));
    const byFewestVotes = [...wrongIndices].sort((a, b) => countVotes(a) - countVotes(b));
    const modes = [
      { name: 'crowd favorite', order: byMostVotes, delays: [700, 800, 900] },
      { name: 'sneaky shuffle', order: shuffle(wrongIndices), delays: [650, 850, 750] },
      { name: 'plot twist', order: byFewestVotes, delays: [850, 650, 950] },
      { name: 'hot potato', order: shuffle(wrongIndices), delays: [700, 900, 650] }
    ];
    const mode = modes[Math.floor(Math.random() * modes.length)];
    return { name: mode.name, order: [...mode.order, correctIndex], delays: mode.delays };
  }

  function makeRoundResult() {
    const correctIndex = currentQuestion.answerIndex;
    const voteCounts = currentQuestion.options.map((_, index) => (
      [...votes.values()].filter(vote => vote === index).length
    ));
    const playerResults = alivePlayers().map(player => {
      const key = normalizeName(player.name);
      const vote = votes.has(key) ? votes.get(key) : null;
      const correct = vote === correctIndex;
      return {
        name: player.name,
        vote,
        correct,
        reason: vote === null ? 'no answer' : `voted ${LETTERS[vote]}`
      };
    });

    return {
      question: currentQuestion,
      correctIndex,
      voteCounts,
      playerResults,
      eliminated: playerResults.filter(result => !result.correct).map(result => ({
        name: result.name,
        reason: result.reason
      }))
    };
  }

  function endRound() {
    stopTimer();
    stopReveal();
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
    phase = 'reveal';

    SFX.play('reveal-start');
    revealHandle = setTimeout(() => advanceReveal(plan.delays), 800);
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

    if (revealStep < revealOrder.length) {
      const voteCount = lastResult.voteCounts[index];
      const hasVoters = voteCount > 0;
      const verdictPause = hasVoters
        ? (index === lastResult.correctIndex ? 1700 : 2300)
        : 800;
      revealHandle = setTimeout(() => advanceReveal(delays), verdictPause);
    } else {
      revealHandle = setTimeout(finishReveal, lastResult.voteCounts[index] > 0 ? 1700 : 1250);
    }
  }

  function pickGag(index) {
    const gags = ['kick', 'burn', 'trapdoor', 'rocket'];
    return gags[(roundIndex + index + revealStep) % gags.length];
  }

  function finishReveal() {
    revealHandle = null;
    const score = (roundIndex + 1) * 10;
    for (const result of lastResult.playerResults) {
      const player = players.get(normalizeName(result.name));
      if (!player) continue;
      if (result.correct) {
        player.score += score;
      } else {
        player.alive = false;
      }
    }
    revealComplete = true;
    revealLastVerdictIndex = null;
    revealGag = '';
    SFX.play('finish');
    emit();
  }

  function nextRound() {
    if (phase !== 'reveal' || !revealComplete) return;
    const alive = alivePlayers().length;
    roundIndex += 1;

    if (roundIndex >= config.totalRounds || alive === 0) {
      phase = 'gameover';
      const ranked = [...players.values()].sort((a, b) => b.score - a.score);
      emit();
      return;
    }

    startRound();
  }

  function getState() {
    return {
      phase,
      config,
      players: [...players.values()],
      roundNumber: roundIndex + 1,
      totalRounds: config.totalRounds,
      currentQuestion,
      votes,
      timeLeft,
      sped,
      lastResult,
      revealOrder,
      revealedIndices,
      revealVerdicts,
      revealLastVerdictIndex,
      revealGag,
      revealMode,
      revealComplete
    };
  }

  return {
    onChange,
    setQuestionBank,
    configure,
    resetGame,
    addPlayer,
    startGame,
    handleChatMessage,
    forceEndRound,
    nextRound,
    getState
  };
})();
