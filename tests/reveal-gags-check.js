const fs = require('fs');
const vm = require('vm');

const screen = { innerHTML: '' };
const nodes = {
  screen,
  'conn-status': { classList: { toggle() {} } },
  'conn-label': { textContent: '' }
};
const context = {
  console,
  document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [] },
  window: {},
  Game: {
    onChange() {},
    restoreRoom: () => ({ then() {} }),
    getState: () => ({ phase: 'setup', connection: 'offline' })
  },
  SFX: { setEnabled() {}, play() {} },
  Date,
  Math,
  Set,
  Map
};

const source = `${fs.readFileSync('js/gags.js', 'utf8')}
${fs.readFileSync('js/main.js', 'utf8')}
globalThis.__renderReveal = renderReveal;`;
vm.runInNewContext(source, context);

const players = Array.from({ length: 8 }, (_, index) => ({
  name: `Player ${index + 1}`,
  score: index * 10,
  alive: index === 0
}));
const state = {
  phase: 'reveal',
  roundNumber: 1,
  totalRounds: 3,
  players,
  votes: new Map(),
  currentQuestion: null,
  revealComplete: false,
  revealMode: 'crowd favorite',
  revealGag: 'chomp',
  revealVariant: { vars: { '--dir': -1 }, flip: true, label: 'from the left' },
  revealLine: 'Eaten. No notes.',
  revealLastVerdictIndex: 1,
  revealedIndices: new Set([0, 1, 2, 3]),
  revealVerdicts: new Set([0, 1]),
  autoNextAt: null,
  lastResult: {
    question: { question: 'Which answer?', options: ['A', 'B', 'C', 'D'] },
    correctIndex: 0,
    eliminated: players.slice(1),
    voteCounts: [0, 8, 0, 0],
    playerResults: players.map(player => ({ name: player.name, vote: 1, correct: false }))
  }
};

context.__renderReveal(state);
const html = screen.innerHTML;
const victimCount = (html.match(/class="victim gag-chomp flip"/g) || []).length;

if (victimCount !== 6) throw new Error(`Expected six visible victim cards, got ${victimCount}.`);
if (!html.includes('+2 more')) throw new Error('Overflow voters were not summarized.');
if (!html.includes('--dir:-1')) throw new Error('Rolled gag direction was not rendered.');
if (!html.includes('Eaten. No notes.')) throw new Error('Gag punchline was not rendered.');
if (html.includes('undefined')) throw new Error('Reveal markup contains undefined values.');

console.log('Reveal gag rendering checks passed.');
