const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { throw new Error(message); };

for (const asset of ['assets/favicon.svg', 'assets/share-card.svg']) {
  if (!fs.existsSync(path.join(root, asset))) fail(`Missing launch asset: ${asset}`);
}

const host = read('index.html');
const join = read('join.html');
for (const page of [host, join]) {
  for (const required of ['rel="canonical"', 'property="og:image"', 'name="twitter:card"', 'assets/favicon.svg']) {
    if (!page.includes(required)) fail(`Page metadata is missing: ${required}`);
  }
}

if (host.indexOf('js/gags.js') > host.indexOf('js/game.js')) {
  fail('The gag module must load before game.js.');
}
if (!read('js/supabase-client.js').includes('The game service did not load.')) {
  fail('Supabase dependency fallback is missing.');
}
if (!read('README.md').includes('https://some-guy-john.github.io/CHATillionaire/')) {
  fail('README is missing the live site URL.');
}

console.log('Launch checks passed.');
