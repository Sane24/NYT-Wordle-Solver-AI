# Wordle Solver AI

Interactive website at https://sane24.github.io/NYT-Wordle-Solver-AI/ where you can play against the AI, watch evolution and the genetic algorithm live, get hints using information theory.

One puzzle, solved with two kinds of intelligence. This project solves Wordle with:

1. An information-theory solver - picks the guess with the highest entropy: the one whose feedback pattern is expected to shrink the space of possible answers the most. It reasons in information bits.
2. A genetic-algorithm solver - a population of 100+ agents, each with a genome of strategy weights (positional letter frequency, 50/50 split-seeking, when to stop probing and commit…). Every generation the agents play real Wordle games; the weakest half dies, elites survive, parents crossbreed, children mutate. No entropy math is hard-coded - good strategy evolves.

![Racing the evolved GA champion on the same secret word — it finds BRAIN a turn faster](assets/play.png)

## Watching evolution happen live

The Evolution Lab runs a real genetic algorithm in your browser. A population of ~100 agents plays actual Wordle games every generation; the weakest half dies, elites survive, parents crossbreed, children mutate. Below is generation 12 solving a shared target — every one of the 100 agents lands the word within four guesses. Ten generations earlier, most of them couldn't solve it at all.

![100 evolved agents solving PULSE together, 100/100 by turn 4](assets/evolution-lab.gif)

Each dot in the population view is one agent, plotted by average guesses vs. solve rate. You can watch the cloud drift toward the top-left corner as better strategies take over:

![Population scatter, fitness chart, and the current champion genome](assets/evolution.png)

## Results

Measured on the full 2,315-word answer list:

| Solver | Avg guesses | Solve rate |
|---|---|---|
| Entropy AI | 3.46 | 100% |
| Evolved GA champion | 3.65 | 99.2% |
| Random consistent guesser | ~5 | ~85% |

The gap between the two is the interesting number: evolution gets within ~0.2 guesses of the information-theoretic approach purely by selection pressure, with no entropy math anywhere in its genome.

## How the two solvers work

### The entropy solver

For a guess *G* over a candidate set *C*, the 243 possible green/yellow/gray feedback patterns partition *C* into buckets. The expected information of the guess is

```
H(G) = log2|C| − (1/|C|) · Σ n_b · log2(n_b)
```

The solver plays the guess with the highest H, tie-breaking toward words that could themselves be the answer (they can win outright). This is why it opens with strange words like SOARE — it's not trying to *guess* the answer early, it's trying to *learn* the most. First-move entropies over the whole dictionary are precomputed so the site loads fast.

### The genetic solver

An agent's genome is just 7 numbers: weights for positional letter frequency, overall letter frequency, split-seeking (preferring letters that appear in ~50% of remaining candidates), unique letters, answer bias — plus a *commit threshold* and *commit turn* that decide when to stop probing for information and start actually trying to win.

Fitness is the penalty-adjusted average guess count over a fresh sample of real games each generation. Selection is tournament-based with elitism, uniform/blend crossover, Gaussian mutation, and a few random immigrants per generation to keep the gene pool from stagnating.

My favorite result: high split-seeking weights keep winning, generation after generation. That's the 50/50 partition idea at the heart of information theory — rediscovered by evolution, without anyone writing down a logarithm.

## Other features

**A solver assistant** for your own games. Mirror any Wordle (including the real NYT one) by typing your guess and clicking the tiles to match the colors you got. The engine tells you how many answers remain, how many bits of uncertainty are left, and the best next guesses, ranked by expected information:

![The assistant narrowing 2,315 candidates down to 49 after one guess](assets/assistant.png)

**A head-to-head mode** that races every solver on the same word and shows their full reasoning traces side by side. Watching the entropy solver nail MOUSE in 3, the GA champion probe its way there in 4, and the random baseline run out of turns entirely tells you more about the three strategies than any chart:

![Entropy AI vs GA champion vs random baseline on MOUSE](assets/compare.png)

**A Discord bot** ([`bot/`](bot/)) that wraps the same solver core in slash commands: `/wordle play` to race the AI, `/wordle hint` for help with any position, `/wordle solve`, `/wordle compare`, and a `/wordle daily` puzzle.


For the Discord bot, copy [`bot/.env.example`](bot/.env.example) to `bot/.env`, fill in your bot token, then:

```bash
npm run bot:deploy   # register the slash commands once
npm run bot
```

## Project layout

```
core/       solver engine (JS, no DOM/Node deps)
  feedback.js    pattern encoding: 5 tiles → one byte, base 3
  entropy.js     information-theory solver
  genetic.js     genomes, fitness, selection, crossover, mutation
  tables.js      typed-array lookup tables for the hot path
  daily.js       deterministic daily word
js/         website: tab router, boards, workers
scripts/    offline evolve / benchmark / precompute
bot/        Discord bot (discord.js)
```

## Notes

- Word lists are the public Wordle answer list (2,315 words) and legal-guess list (12,972). The daily word here is intentionally **not** the official NYT word, so nothing gets spoiled.
- Custom words outside the answer list work everywhere — the solvers detect it and fall back to the full legal-guess dictionary.
