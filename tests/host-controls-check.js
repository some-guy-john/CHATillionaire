const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('js/main.js');
const game = read('js/game.js');
const client = read('js/supabase-client.js');
const schema = read('supabase/schema.sql');

for (const required of [
  'btn-start-game',
  'host-play-mode',
  'play-separate',
  'data-host-option',
  'host-board-answer',
  'renderPlayerRoster(state, finished, state.kickEnabled)'
]) {
  if (!main.includes(required)) throw new Error(`Host control is missing: ${required}`);
}

if (main.includes('host-answer-card')) throw new Error('Host answers still use a separate answer card.');

for (const required of ['startGame', 'submitHostVote', 'joinAsHostPlayer', 'tickPlayer']) {
  if (!game.includes(required) && !client.includes(required)) throw new Error(`Host API is missing: ${required}`);
}

for (const required of [
  'create or replace function public.start_game',
  'create or replace function public.player_tick',
  "v_room.phase not in ('lobby', 'voting', 'reveal')",
  'removed_at = now()'
]) {
  if (!schema.includes(required)) throw new Error(`Database control is missing: ${required}`);
}

console.log('Host control checks passed.');
