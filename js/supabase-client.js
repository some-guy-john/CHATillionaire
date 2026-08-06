const ChatSupabase = (() => {
  const settings = window.CHATILLIONAIRE_CONFIG || {};
  let client = null;
  try {
    if (window.supabase?.createClient && settings.supabaseUrl && settings.supabaseKey) {
      client = window.supabase.createClient(settings.supabaseUrl, settings.supabaseKey);
    }
  } catch {
    client = null;
  }
  let authPromise = null;
  const RPC_TIMEOUT_MS = 12000;

  function fail(error) {
    if (error) throw new Error(error.message || 'Supabase request failed.');
  }

  function ensureReady() {
    if (!client) {
      throw new Error('The game service did not load. Refresh the page and try again.');
    }
  }

  async function ensureAuth() {
    ensureReady();
    if (!authPromise) {
      authPromise = (async () => {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        fail(sessionError);
        if (sessionData.session?.user) return sessionData.session.user;
        const { data, error } = await client.auth.signInAnonymously();
        fail(error);
        return data.user;
      })().finally(() => { authPromise = null; });
    }
    return authPromise;
  }

  async function rpc(name, parameters = {}) {
    await ensureAuth();
    const request = client.rpc(name, parameters);
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('The server took too long to respond.')), RPC_TIMEOUT_MS);
    });
    const { data, error } = await Promise.race([request, timeout]);
    fail(error);
    return data;
  }

  function createRoom(config, creationToken) {
    return rpc('create_room', {
      p_total_rounds: config.totalRounds,
      p_timer_seconds: config.timerSeconds,
      p_speedup_enabled: config.speedupEnabled,
      p_sfx_enabled: config.sfxEnabled,
      p_creation_token: creationToken
    });
  }

  function getHostState(roomId) {
    return rpc('get_host_state', { p_room_id: roomId });
  }

  function joinRoom(code, nickname, hostJoin = false) {
    return rpc('join_room', {
      p_code: String(code).trim().toUpperCase(),
      p_nickname: nickname,
      p_host_join: hostJoin
    });
  }

  function getPlayerState(code) {
    return rpc('get_player_state', { p_code: String(code).trim().toUpperCase() });
  }

  function tickRoom(roomId) {
    return rpc('room_tick', { p_room_id: roomId });
  }

  function submitVote(roomId, optionIndex) {
    return rpc('submit_vote', { p_room_id: roomId, p_option_index: optionIndex });
  }

  function forceCloseRound(roomId) {
    return rpc('force_close_round', { p_room_id: roomId });
  }

  function finishReveal(roomId) {
    return rpc('finish_reveal', { p_room_id: roomId });
  }

  function endRoom(roomId) {
    return rpc('end_room', { p_room_id: roomId });
  }

  return {
    ensureAuth,
    createRoom,
    getHostState,
    joinRoom,
    getPlayerState,
    tickRoom,
    submitVote,
    forceCloseRound,
    finishReveal,
    endRoom
  };
})();
