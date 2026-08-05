const ChatSupabase = (() => {
  const settings = window.CHATILLIONAIRE_CONFIG;
  const client = window.supabase.createClient(settings.supabaseUrl, settings.supabaseKey);
  let authPromise = null;

  const ROOM_FIELDS = [
    'id', 'code', 'host_user_id', 'phase', 'lobby_stage', 'lobby_deadline', 'round_number',
    'total_rounds', 'timer_seconds', 'speedup_enabled', 'sfx_enabled', 'current_question', 'round_started_at',
    'round_deadline', 'reveal_complete', 'created_at', 'updated_at'
  ].join(',');

  function fail(error) {
    if (error) throw new Error(error.message || 'Supabase request failed.');
  }

  async function ensureAuth() {
    if (!authPromise) {
      authPromise = (async () => {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        fail(sessionError);
        if (sessionData.session?.user) return sessionData.session.user;

        const { data, error } = await client.auth.signInAnonymously();
        fail(error);
        return data.user;
      })();
    }
    return authPromise;
  }

  function randomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  async function createRoom(config) {
    const user = await ensureAuth();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await client.from('rooms').insert({
        code: randomCode(),
        host_user_id: user.id,
        phase: 'lobby',
        lobby_stage: 'waiting',
        lobby_deadline: new Date(Date.now() + 300000).toISOString(),
        total_rounds: config.totalRounds,
        timer_seconds: config.timerSeconds,
        speedup_enabled: config.speedupEnabled,
        sfx_enabled: config.sfxEnabled
      }).select(ROOM_FIELDS).single();
      if (!error) return data;
      if (error.code !== '23505') fail(error);
    }
    throw new Error('Could not create a unique room. Try again.');
  }

  async function getRoomByCode(code) {
    await ensureAuth();
    const { data, error } = await client.from('rooms')
      .select(ROOM_FIELDS)
      .eq('code', String(code).trim().toUpperCase())
      .maybeSingle();
    fail(error);
    return data;
  }

  async function getRoom(roomId) {
    const { data, error } = await client.from('rooms')
      .select(ROOM_FIELDS)
      .eq('id', roomId)
      .single();
    fail(error);
    return data;
  }

  async function updateRoom(roomId, changes) {
    const { data, error } = await client.from('rooms')
      .update(changes)
      .eq('id', roomId)
      .select(ROOM_FIELDS)
      .single();
    fail(error);
    return data;
  }

  async function getPlayers(roomId) {
    const { data, error } = await client.from('players')
      .select('id, room_id, user_id, nickname, alive, score, joined_at')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    fail(error);
    return data || [];
  }

  async function getMyPlayer(roomId) {
    const user = await ensureAuth();
    const { data, error } = await client.from('players')
      .select('id, room_id, user_id, nickname, alive, score, joined_at')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .maybeSingle();
    fail(error);
    return data;
  }

  async function joinRoom(code, nickname) {
    const user = await ensureAuth();
    const room = await getRoomByCode(code);
    if (!room) throw new Error('That room code does not exist.');
    if (room.phase !== 'lobby') throw new Error('This room has already started.');

    const existingPlayer = await getMyPlayer(room.id);
    if (existingPlayer) return { room, player: existingPlayer };

    const cleanName = String(nickname).trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2 || cleanName.length > 18) {
      throw new Error('Pick a nickname between 2 and 18 characters.');
    }

    const { data, error } = await client.from('players').insert({
      room_id: room.id,
      user_id: user.id,
      nickname: cleanName,
      normalized_nickname: cleanName.toLowerCase()
    }).select('id, room_id, user_id, nickname, alive, score, joined_at').single();
    if (error?.code === '23505') throw new Error('That nickname is already taken in this room. Pick another.');
    fail(error);
    return { room, player: data };
  }

  async function getVotes(roomId, roundNumber) {
    const { data, error } = await client.from('votes')
      .select('id, player_id, round_number, option_index, submitted_at')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);
    fail(error);
    return data || [];
  }

  async function getRound(roomId, roundNumber) {
    const { data, error } = await client.from('room_rounds')
      .select('id, room_id, round_number, question_id, question_public, answer_index, started_at, round_deadline')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber)
      .single();
    fail(error);
    return data;
  }

  async function getMyVote(roomId, playerId, roundNumber) {
    const { data, error } = await client.from('votes')
      .select('option_index, submitted_at')
      .eq('room_id', roomId)
      .eq('player_id', playerId)
      .eq('round_number', roundNumber)
      .maybeSingle();
    fail(error);
    return data;
  }

  async function getMyOutcome(roomId, playerId, roundNumber) {
    const { data, error } = await client.from('player_round_results')
      .select('round_number, survived, vote_index, message')
      .eq('room_id', roomId)
      .eq('player_id', playerId)
      .eq('round_number', roundNumber)
      .maybeSingle();
    fail(error);
    return data;
  }

  async function submitVote(roomId, playerId, roundNumber, optionIndex) {
    const user = await ensureAuth();
    const { data, error } = await client.from('votes').insert({
      room_id: roomId,
      player_id: playerId,
      user_id: user.id,
      round_number: roundNumber,
      option_index: optionIndex
    }).select('option_index, submitted_at').single();
    fail(error);
    return data;
  }

  async function createRound(round) {
    const { data, error } = await client.from('room_rounds').insert(round).select('id').single();
    fail(error);
    return data;
  }

  async function createOutcome(outcome) {
    const { data, error } = await client.from('player_round_results')
      .insert(outcome)
      .select('round_number, survived, vote_index, message')
      .single();
    fail(error);
    return data;
  }

  async function getOutcomes(roomId, roundNumber) {
    const { data, error } = await client.from('player_round_results')
      .select('player_id, user_id, round_number, survived, vote_index, message')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber);
    fail(error);
    return data || [];
  }

  async function updatePlayer(playerId, changes) {
    const { data, error } = await client.from('players')
      .update(changes)
      .eq('id', playerId)
      .select('id, room_id, user_id, nickname, alive, score, joined_at')
      .single();
    fail(error);
    return data;
  }

  function subscribeRoom(roomId, callback) {
    const channel = client.channel(`chatillionaire-room-${roomId}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `room_id=eq.${roomId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_round_results', filter: `room_id=eq.${roomId}` }, callback);
    channel.subscribe();
    return channel;
  }

  async function unsubscribe(channel) {
    if (channel) await client.removeChannel(channel);
  }

  return {
    ensureAuth,
    createRoom,
    getRoomByCode,
    getRoom,
    updateRoom,
    getPlayers,
    getMyPlayer,
    joinRoom,
    getVotes,
    getRound,
    getMyVote,
    getMyOutcome,
    submitVote,
    createRound,
    createOutcome,
    getOutcomes,
    updatePlayer,
    subscribeRoom,
    unsubscribe
  };
})();
