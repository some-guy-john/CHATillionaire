const fs = require('fs');
const vm = require('vm');

const gagsSource = `${fs.readFileSync('js/gags.js', 'utf8')};globalThis.__Gags = Gags;`;
const context = { Math, console };
vm.runInNewContext(gagsSource, context);

const gags = context.__Gags;
if (!gags || gags.count !== 30) throw new Error(`Expected 30 elimination gags, got ${gags?.count}.`);

const ids = gags.LIST.map(gag => gag.id);
if (new Set(ids).size !== ids.length) throw new Error('Gag IDs must be unique.');

const dealt = new Set(Array.from({ length: gags.count }, () => gags.deal()));
if (dealt.size !== gags.count) throw new Error('Shuffle bag repeated a gag before being emptied.');
if (!ids.every(id => dealt.has(id))) throw new Error('Shuffle bag did not deal every gag.');

const css = fs.readFileSync('css/style.css', 'utf8');
for (const id of ids) {
  if (!css.includes(`.victim.gag-${id}`)) throw new Error(`Missing CSS animation for gag: ${id}`);
  const gag = gags.get(id);
  if (!gag.shout || !gag.lines.length) throw new Error(`Gag is missing copy: ${id}`);
}

for (const id of ids) {
  const variant = gags.rollVariant(id);
  if (variant && (!variant.vars || typeof variant.label !== 'string')) {
    throw new Error(`Invalid variant for gag: ${id}`);
  }
}

console.log('Gag integration checks passed.');
