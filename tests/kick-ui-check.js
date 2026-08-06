const fs = require('fs');
const vm = require('vm');

const nodes = {
  screen: { innerHTML: '', removeAttribute() {} },
  'conn-status': { classList: { toggle() {} } },
  'conn-label': { textContent: '' }
};
const context = {
  console,
  document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [] },
  window: {},
  Game: { onChange() {}, restoreRoom: () => ({ then() {} }), getState: () => ({ phase: 'setup', connection: 'offline' }) },
  SFX: { setEnabled() {}, play() {} },
  Date,
  Math,
  Set,
  Map
};

const source = `${fs.readFileSync('js/gags.js', 'utf8')}
${fs.readFileSync('js/main.js', 'utf8')}
globalThis.__renderPlayerRoster = renderPlayerRoster;`;
vm.runInNewContext(source, context);

const html = context.__renderPlayerRoster({
  phase: 'lobby',
  players: [
    { id: 'host-id', name: 'Host', alive: true, score: 0, is_host_player: true },
    { id: 'viewer-id', name: 'Viewer', alive: true, score: 0, is_host_player: false }
  ],
  votes: new Map()
}, false, true);

if (html.includes('data-kick-player="host-id"')) throw new Error('Host player received a kick button.');
if (!html.includes('data-kick-player="viewer-id"')) throw new Error('Viewer did not receive a kick button.');
if ((html.match(/class="kick-player"/g) || []).length !== 1) throw new Error('Unexpected kick button count.');

console.log('Kick UI checks passed.');
