# Chat millionaire knockout

A free, no-backend Twitch chat trivia game. Chat votes A/B/C/D directly in your
Twitch chat, one wrong or missed answer eliminates you, difficulty climbs each
round, last player standing (highest score) wins. Everything runs in your own
browser tab — no login, no server, no hosting cost.

## Run it locally

Because the app loads `data/questions.json` with `fetch()`, you can't just
double-click `index.html` (the `file://` protocol blocks that request). Serve
the folder instead:

```bash
npx serve .
```

or, if you have Python installed:

```bash
python -m http.server 8080
```

Then open the printed local URL in your browser.

## Using it on stream

1. Open the page, enter your Twitch channel name, then click **Let's play!**.
   This connects anonymously and read-only — no login required. The host does
   not join automatically; anyone who wants to play joins through chat.
2. Put the browser tab in OBS as a **Window Capture** or **Browser Source**
   pointed at the same local URL, or just screen-share the tab.
3. Chat types `!join` during the lobby to enter. Click **Start game** when
   you're ready.
4. Each round, chat votes by typing `A`, `B`, `C`, `D` (or `1`-`4`).
   The live roster shows who is still in and who has locked in a vote without
   exposing their choice. The timer starts at 30 seconds by default and gets a
   little spicy once half of the remaining players
   have voted, and you can hit **Reveal it!** to end voting early.
5. When voting ends, the answer cards reveal in a randomized fake-out sequence.
   Wrong answers turn red, the correct answer is always the final reveal, and
   vote counts plus playful player reactions appear after the reveal. Wrong or
   missed answers eliminate a player. Play continues until the rounds run out;
   if everyone is eliminated, the game ends early.

## Editing the question bank

`data/questions.json` holds 10 rounds of 20 questions each — feel free to add
more, edit, or regenerate with an LLM. See the format:

```json
{
  "id": "r1-001",
  "question": "What is the capital of France?",
  "options": ["Berlin", "Madrid", "Paris", "Rome"],
  "answerIndex": 2
}
```

`answerIndex` is 0-based (0 = A, 1 = B, 2 = C, 3 = D). One question is picked
at random per round per session, so re-running the game gives different
questions each time.

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
- Game state (players, scores, current round) lives only in this browser tab.
  Refreshing the page resets the game — click **Back to lobby** at the end of
  a game to start a new one on the same connection instead.
