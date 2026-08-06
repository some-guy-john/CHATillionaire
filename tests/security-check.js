const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { throw new Error(message); };

if (fs.existsSync(path.join(root, 'data', 'questions.json'))) {
  fail('Public question bank must not exist.');
}

const ignored = read('.gitignore');
if (!ignored.includes('/supabase/questions-seed.sql')) {
  fail('Private question seed is not ignored.');
}

const client = read('js/supabase-client.js');
if (/\.from\s*\(/.test(client)) {
  fail('Frontend must not use direct table access.');
}

const schema = read('supabase/schema.sql');
for (const required of [
  'create schema private',
  'create table if not exists private.questions',
  'create or replace function public.join_room',
  'create or replace function public.submit_vote',
  'create or replace function public.finish_reveal',
  'revoke all on public.rooms, public.players, public.votes, public.player_round_results from public, anon, authenticated',
  'revoke usage on schema private from public, anon, authenticated'
]) {
  if (!schema.includes(required)) fail(`Schema is missing: ${required}`);
}

for (const forbidden of [
  'create policy "rooms are readable"',
  'create policy "players are readable"',
  'alter publication supabase_realtime add table'
]) {
  if (schema.includes(forbidden)) fail(`Insecure schema fragment remains: ${forbidden}`);
}

const rpcCalls = [...client.matchAll(/rpc\('([a-z_]+)'/g)].map(match => match[1]);
for (const rpc of rpcCalls) {
  if (!schema.includes(`function public.${rpc}`)) fail(`Client RPC has no schema function: ${rpc}`);
}

if (!schema.includes('public.create_room(integer, integer, boolean, boolean, uuid)')) {
  fail('Idempotent room creation signature is missing.');
}

console.log('Security regression checks passed.');
