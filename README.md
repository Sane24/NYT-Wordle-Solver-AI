# Wordle Solver AI - Evolution vs Information Theory

One puzzle, two kinds of intelligence. This project solves Wordle with:

- **🧮 An information-theory solver** - picks the guess with the highest *entropy*: the one whose feedback pattern is expected to shrink the space of possible answers the most. It reasons in bits.
- **🧬 A genetic-algorithm solver** - a population of 100+ agents, each with a genome of strategy weights (positional letter frequency, 50/50 split-seeking, when to stop probing and commit…). Every generation the agents play real Wordle games; the weakest half dies, elites survive, parents crossbreed, children mutate. No entropy math is hard-coded - good strategy *evolves*.

It ships as an **interactive website** (play against the AI, watch evolution live, get hints) and a **Discord bot**.

Measured on the full 2,315-answer list:

| Solver | Avg guesses | Solve rate |
|---|---|---|
| Entropy AI | ~3.49 | 100% |
| Evolved GA champion | ~3.65 | ~99% |
| Random consistent guesser | ~5+ | ~85% |

## Quick start

```bash
npm install          # only needed for the Discord bot
npm run serve        # website at http://localhost:8917  (any static server works)
```

The website is pure static ES modules - no build step, no framework. It needs to be served over HTTP (not opened as a `file://`) because it uses module web workers.

### Website tour

- **🎮 Play vs AI** - race the entropy AI, the evolved GA champion, or both at once on the same secret word (random, daily, or custom). Options: *AI copies your first word*, *hide AI letters until game over* (colors stay visible, letters don't spoil). An explanation panel narrates every AI guess.
- **🧭 Solver Assistant** - mirror any Wordle-like game (including today's real NYT puzzle): type your guess, click the tiles to set the colors you got, and watch the candidate list collapse. Shows remaining candidates, bits of uncertainty left, and the top guesses ranked by expected information.
- **🧬 Evolution Lab** - natural selection, live. A 10x10 arena at the top shows the current population all playing the same rotating target word, cell by cell. Below it, each dot is an agent; each generation it plays real games (the solve-rate axis is zoomed above 75% so the leaders stay spread apart). Weak agents fall off the chart and die, elites get gold rings, children spawn between their parents. Line charts track best/mean performance across generations, a leaderboard ranks strategies with each agent's opener, typical second guess, and human-readable trait descriptions, and the all-time champion's genome is shown as gene bars.
- **⚔️ Compare Solvers** - same target word, every strategy side by side, with per-turn reasoning (bits expected vs. gained for entropy; probe/commit decisions for the GA) and a "fastest" badge. Optionally force all solvers to use the same opener.

### Discord bot

```bash
cp bot/.env.example bot/.env   # fill in DISCORD_TOKEN + CLIENT_ID (+ GUILD_ID for instant dev registration)
npm run bot:deploy             # register the /wordle slash command
npm run bot
```

Create the token at the [Discord developer portal](https://discord.com/developers/applications) (New Application → Bot → Reset Token; invite it with the `applications.commands` + `bot` scopes).

| Command | What it does |
|---|---|
| `/wordle play [opponent] [source] [same_opener]` | Race the AI on a random or daily word. AI letters stay behind spoiler tags until the end. |
| `/wordle guess word:crane` | Play your next guess in the active game. |
| `/wordle hint state:"crane=bygyb soils=gybbb"` | Best next guesses for any position (g=green, y=yellow, b=gray). Empty state → best openers. |
| `/wordle solve word:point [solver]` | Watch a solver's full reasoning trace. |
| `/wordle compare word:point [opener]` | Entropy vs GA on the same word, side by side. |
| `/wordle daily` | Play today's daily puzzle vs the AI. |
| `/wordle giveup` | Reveal the word and end your game. |

### Offline scripts

```bash
npm run precompute   # rebuild core/openers.js (entropy of all 12,972 first guesses)
npm run evolve       # evolve a fresh champion → core/champion.js (args: generations pop games)
npm run benchmark    # entropy vs champion head-to-head (--full = all 2,315 answers)
```

## How it works

```
core/            shared solver library (plain ESM - runs in Node and the browser)
  words.js       2,315 answers + 12,972 legal guesses (public Wordle lists)
  feedback.js    green/yellow/gray logic incl. duplicate letters; base-3 pattern codes
  tables.js      cached pattern rows: feedback(guess, every answer) as a Uint8Array
  entropy.js     entropy ranking, stateful EntropySolver, full-game traces
  genetic.js     genomes, agent solver, fitness evaluation, GeneticEvolver
  daily.js       deterministic daily word from the date - no NYT scraping
  openers.js     precomputed: top openers by entropy (soare = 5.886 bits)
  champion.js    best genome from offline evolution
js/              website (static ES modules; solvers run in web workers)
bot/             discord.js v14 bot sharing the same core/
scripts/         precompute / evolve / benchmark
```

**Entropy solver.** For guess *G* over candidate set *C*, the 243 possible feedback patterns partition *C*. The expected information is `H(G) = log2|C| − (1/|C|) Σ n_b·log2(n_b)`. The solver plays the max-entropy guess, tie-breaking toward words that could be the answer (they can win outright). First-move entropies over the whole dictionary are precomputed.

**Genetic solver.** A genome is 7 genes: weights for positional frequency, letter frequency, split-seeking (prefer letters near 50/50 presence - information theory rediscovered by evolution), unique letters, answer bias, plus *commit threshold* and *commit turn* (when to stop probing). Fitness = penalty-adjusted average guesses over a fresh sample of real games each generation. Selection is tournament-based with elitism, uniform/blend crossover, Gaussian mutation, and a few random immigrants per generation for diversity.

**Fairness note.** The GA never touches the entropy code - it evolves from random weights. That the champion converges on openers like *alter*/*arose* and a probe-then-commit rhythm is the point of the exhibit: two different kinds of intelligence arriving at similar behavior.

## Notes

- The daily puzzle is a deterministic hash of the date over the public answer list - it is **not** the official NYT word, so nothing here scrapes or spoils the real game.
- Custom words outside the official answer list work everywhere: solvers detect the situation and fall back to the full legal-guess dictionary.
