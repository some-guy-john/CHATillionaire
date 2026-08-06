const fs = require('fs');
const vm = require('vm');

const source = `${fs.readFileSync('js/game.js', 'utf8')};globalThis.__Game=Game;`;
const payload = {
  room: {
    id: 'room-1', code: 'A1B2C3D4', phase: 'voting', lobby_stage: 'waiting',
    round_number: 1, total_rounds: 3, timer_seconds: 30,
    speedup_enabled: true, sfx_enabled: false,
    current_question: { question: 'Test question?', options: ['A', 'B', 'C', 'D'] },
    round_deadline: new Date(Date.now() + 30000).toISOString(),
    reveal_complete: false, next_round_at: null
  },
  players: [{ id: 'p1', nickname: 'Player', alive: true, score: 0, has_voted: false }],
  reveal: null
};

const storage = new Map([['chatillionaire-host-room', JSON.stringify({ id: 'room-1' })]]);
const context = {
  window: { location: { href: 'https://example.test/CHATillionaire/' } },
  URL,
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  },
  ChatSupabase: {
    getHostState: async () => payload,
    tickRoom: async () => payload
  },
  SFX: { setEnabled() {}, play() {} },
  setTimeout: () => 1,
  clearTimeout() {},
  Date,
  Math,
  console
};

vm.runInNewContext(source, context);
let renders = 0;
context.__Game.onChange(() => { renders += 1; });

context.__Game.restoreRoom().then(restored => {
  const state = context.__Game.getState();
  if (!restored) throw new Error(`Room did not restore: ${state.error}`);
  if (state.phase !== 'voting') throw new Error(`Expected voting, got ${state.phase}`);
  if (!state.currentQuestion?.question) throw new Error('Question was missing after restore.');
  if (renders !== 1) throw new Error(`Expected one complete render, got ${renders}`);
  console.log('Host restore regression check passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
