const Gags = (() => {
  // vary: "360" any heading + spin | "side" mirrored left/right | "spin" either rotation
  const LIST = [
    { id: 'yeet', label: 'Yeet', shout: 'YEET!', props: ['\u{1F4A8}'], vary: '360',
      lines: ['Launched into the shadow realm.', 'Gone. Reduced to atoms.', 'Hope they packed a lunch.'] },
    { id: 'boulder', label: 'Boulder', shout: 'SPLAT!', props: ['\u{1FAA8}'],
      lines: ['Flattened like a pancake.', 'Now available in 2D.', 'Somebody get a spatula.'] },
    { id: 'kaboom', label: 'Kaboom', shout: 'KABOOM!', props: ['\u{1F4A5}'],
      lines: ['Nothing left to sweep up.', 'That escalated instantly.', 'Cleanup on aisle chat.'] },
    { id: 'toast', label: 'Toasted', shout: 'CRISPY!', props: ['\u{1F525}', '\u{1F525}'],
      lines: ['Served extra crispy.', 'Well done. Literally.', 'Somebody open a window.'] },
    { id: 'trap', label: 'Trapdoor', shout: 'BYE!', props: [],
      lines: ['The floor had opinions.', 'Straight to the basement.', 'No refunds on that one.'] },
    { id: 'vortex', label: 'Vortex', shout: 'SLURP!', props: ['\u{1F300}'], vary: 'spin',
      lines: ['Swirled right down the drain.', 'The spin cycle got them.', 'Circling the drain, literally.'] },
    { id: 'ufo', label: 'Abducted', shout: 'TAKEN!', props: ['\u{1F6F8}', ''],
      lines: ['Beamed up for questioning.', 'They belong to the sky now.', 'Probably fine. Probably.'] },
    { id: 'deflate', label: 'Deflate', shout: 'PFFFT!', props: ['\u{1F4A8}'], vary: 'side',
      lines: ['Flew around the room and gave up.', 'All that air, no answers.', 'Deflated in every sense.'] },
    { id: 'freeze', label: 'Freeze', shout: 'BRRR!', props: ['\u{1F9CA}'],
      lines: ['Iced on the spot.', 'Cold answer, colder ending.', 'Chill out. Permanently.'] },
    { id: 'shrink', label: 'Shrink', shout: 'POOF!', props: ['\u{1F4A8}'],
      lines: ['Shrunk clean out of existence.', 'Blink and you missed them.', 'Small answer, smaller player.'] },
    { id: 'hook', label: 'The hook', shout: 'YOINK!', props: ['\u{1FA9D}'], vary: 'side',
      lines: ['Yanked off stage, vaudeville style.', 'The management has seen enough.', 'Escorted out at high speed.'] },
    { id: 'piano', label: 'Piano', shout: 'CLANG!', props: ['\u{1F3B9}'],
      lines: ['Squashed in B-flat minor.', 'That chord was fatal.', 'Somebody call a tuner.'] },
    { id: 'ghost', label: 'Ghosted', shout: 'SPOOKY!', props: ['\u{1F47B}'], vary: 'side',
      lines: ['They live in the chat logs now.', 'Ascended, unfortunately.', 'Haunting round seven already.'] },
    { id: 'glitch', label: 'Deleted', shout: 'DELETED', props: [],
      lines: ['File not found.', 'Removed from the timeline.', 'Ctrl+Z was not available.'] },
    { id: 'banana', label: 'Banana', shout: 'WHOOPS!', props: ['\u{1F34C}'], vary: 'side',
      lines: ['Slipped straight out of the game.', 'Classic. Absolutely classic.', "Comedy's oldest exit."] },
    { id: 'chomp', label: 'Chomped', shout: 'NOM!', props: ['\u{1F996}'], vary: 'side',
      lines: ['Eaten. No notes.', 'Somebody was hungry.', 'A protein-rich elimination.'] },
    { id: 'blender', label: 'Blender', shout: 'WHIRRR!', props: ['\u{1F32A}'], vary: 'spin',
      lines: ['Liquidised on the spot.', 'Smoothie mode engaged.', 'Now a beverage.'] },
    { id: 'melt', label: 'Melted', shout: 'SPLORT!', props: ['\u{1F4A7}'],
      lines: ['Became a puddle of regret.', 'Room temperature performance.', 'Mop required.'] },
    { id: 'crumple', label: 'Crumpled', shout: 'SCRUNCH!', props: ['\u{1F5D1}'], vary: 'side',
      lines: ['Balled up and binned.', 'Draft rejected.', 'Straight in the recycling.'] },
    { id: 'bowling', label: 'Bowling', shout: 'STRIKE!', props: ['\u{1F3B3}'], vary: 'side',
      lines: ['That was a clean strike.', 'Ten pins, one player.', 'Right down the middle.'] },
    { id: 'spring', label: 'Springboard', shout: 'BOING!', props: ['\u{1FA80}'], vary: 'side',
      lines: ['Boinged into low orbit.', 'Gravity said no thanks.', 'Still going up, honestly.'] },
    { id: 'portal', label: 'Portal', shout: 'WHOOSH!', props: ['\u{1F573}'], vary: 'side',
      lines: ["Filed under 'elsewhere'.", 'Wrong answer, wrong dimension.', 'They exited sideways.'] },
    { id: 'zap', label: 'Zapped', shout: 'ZZZAP!', props: ['\u{26A1}'],
      lines: ['Struck down on the spot.', 'Extremely well grounded now.', 'That was a shocking answer.'] },
    { id: 'sink', label: 'Quicksand', shout: 'GLUG!', props: ['\u{1F573}'], vary: 'side',
      lines: ['Sank without a trace.', 'Struggling only made it worse.', 'Down they go.'] },
    { id: 'spaghetti', label: 'Spaghetti', shout: 'STREEETCH!', props: ['\u{1F573}'],
      lines: ['Stretched into a noodle.', 'Spaghettified. Very physics.', 'Long boy now.'] },
    { id: 'bubble', label: 'Bubble', shout: 'POP!', props: ['\u{1FAE7}'], vary: 'side',
      lines: ['Floated off and popped.', 'Gently removed from play.', 'A soft but final exit.'] },
    { id: 'slots', label: 'Slot reel', shout: 'JACKPOT?', props: ['\u{1F3B0}'],
      lines: ['Spun the reels, got nothing.', 'House always wins.', 'Three lemons, no prize.'] },
    { id: 'swat', label: 'Swatted', shout: 'SWAT!', props: ['\u{1FAB0}'], vary: 'side',
      lines: ['Dealt with like a fly.', 'One clean swat.', 'Should have stayed still.'] },
    { id: 'crt', label: 'No signal', shout: 'NO SIGNAL', props: [],
      lines: ['Powered down to a single dot.', 'Please adjust your antenna.', 'And then there was static.'] },
    { id: 'shred', label: 'Shredder', shout: 'BRRRT!', props: ['\u{1F4C4}'],
      lines: ['Fed straight through the shredder.', 'Confidential, now confetti.', 'Unrecoverable.'] }
  ];

  const CROWN = { id: 'crown', label: 'Big brain', shout: 'GENIUS!', props: ['\u{1F451}', '\u{2728}'],
    lines: ['Absolutely massive brains.', 'Certified big brain behaviour.', 'Look at them. Just look.'] };

  const COMPASS = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const byId = new Map([...LIST, CROWN].map(gag => [gag.id, gag]));

  let bag = [];

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Deals from a shuffled deck so no gag repeats until all 30 have been used.
  function deal() {
    if (!bag.length) bag = shuffle(LIST);
    return bag.pop().id;
  }

  const coin = () => (Math.random() < 0.5 ? 1 : -1);

  // A fresh heading per elimination, so even a repeated gag never looks identical.
  function rollVariant(gagId) {
    const gag = byId.get(gagId);
    if (!gag || !gag.vary) return null;
    if (gag.vary === '360') {
      const angle = Math.random() * Math.PI * 2;
      const turns = 2 + Math.floor(Math.random() * 3);
      return {
        vars: {
          '--dx': (Math.cos(angle) * 145).toFixed(1) + 'vw',
          '--dy': (Math.sin(angle) * 145).toFixed(1) + 'vh',
          '--spin': coin() * turns * 360 + 'deg'
        },
        label: COMPASS[Math.round(angle / (Math.PI / 4)) % 8] + ', ' + turns + ' spins'
      };
    }
    if (gag.vary === 'side') {
      const dir = coin();
      return { vars: { '--dir': dir }, flip: dir === -1, label: dir === 1 ? 'from the right' : 'from the left' };
    }
    const dir = coin();
    return { vars: { '--spin': dir * 1260 + 'deg' }, label: dir === 1 ? 'clockwise' : 'anticlockwise' };
  }

  const get = gagId => byId.get(gagId) || CROWN;
  const line = gagId => {
    const gag = get(gagId);
    return gag.lines[Math.floor(Math.random() * gag.lines.length)];
  };

  return { LIST, CROWN, deal, rollVariant, get, line, count: LIST.length };
})();
