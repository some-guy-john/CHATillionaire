# CHATillionaire

A free multiplayer trivia knockout game. Viewers join from their own phones,
answer privately, and watch the host page run the colorful reveal. One wrong or
missed answer eliminates you, and the last player standing wins.

## Run it locally

The app uses browser modules, authentication, and network requests, so serve the
folder rather than opening `index.html` directly with the `file://` protocol:

```bash
npx serve .
```

or, if you have Python installed:

```bash
python -m http.server 8080
```

Then open the printed local URL in your browser.

## Supabase setup

1. Create a free Supabase project and enable **Authentication → Providers →
   Anonymous sign-ins**.
2. Open **SQL Editor**, paste `supabase/schema.sql`, and run it. This pre-launch
   migration deletes any existing prototype rooms and replaces the permissive
   policies with an RPC-only security model.
3. Paste the local, Git-ignored `supabase/questions-seed.sql` into SQL Editor and
   run it. Keep a private backup; it contains the correct answers and must never
   be committed or deployed through GitHub Pages.
4. The public project URL and publishable key are in `js/config.js`. The
   publishable key is safe to ship in a static frontend; never put a secret or
   `service_role` key there.

## Using it on stream

1. Open `index.html` through a local server or the GitHub Pages URL and click
   **Make a room!**.
2. Copy the generated player link and post it in chat. Viewers open the link,
   choose a nickname, and answer from their own device. The lobby also shows a
   QR code for phones and a **Play on this device** link for the streamer.
3. Put the host page in OBS as a **Window Capture** or **Browser Source**. The
   host page owns the colorful reveal; viewer pages tell players to watch the
   stream for the result.
4. The lobby waits up to five minutes. As soon as player two joins, a 30-second
   countdown starts. If only one player is present when the five-minute lobby
   expires, the game starts solo.
5. Questions use a 30-second timer by default. A round ends when every alive
   player votes or when the timer runs out. The next round starts automatically
   four seconds after the reveal.
6. Wrong answers turn red, the correct answer is always the final reveal, and
   the host page runs the playful voter spotlight animations. Wrong or missed
   answers eliminate a player.

The streamer control page and player page are intentionally separate. To play
as a contestant, open the generated **Play on this device** link in another
tab, a private window, or on a phone. The explicit player link is required so
the host does not accidentally join while managing the room.

## Editing the question bank

Questions live in the private `private.questions` Supabase table. Correct
answers must not be stored in any file committed to this repository. Add or edit
questions through a private SQL seed using this shape:

```json
{
  "id": "r1-001",
  "question": "What is the capital of France?",
  "options": ["Berlin", "Madrid", "Paris", "Rome"],
  "answer_index": 2,
  "difficulty": 1
}
```

`answer_index` is 0-based (0 = A, 1 = B, 2 = C, 3 = D). The database picks a
random question for the current difficulty without returning the answer to
players.

## Deploying to GitHub Pages (free hosting)

1. Create a new GitHub repository and push this folder to it.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick your main branch and the `/ (root)` folder, then save.
4. GitHub gives you a URL like `https://yourusername.github.io/reponame/` —
   open that instead of localhost when you're live.

No build step, no server, no cost.

## Notes

- Optional goofy game-show sound effects use the browser's Web Audio API and do
  not load any external audio files.
- Rooms, players, votes, scores, and phase transitions are synchronized through
  transactional Supabase RPCs. The host room is remembered in that browser so
  refreshing the host page can restore it.
- Browser clients have no direct table access. Questions and answers remain in
  the private schema; only the active question text and options are returned.
