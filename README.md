# Wordle Solver AI - Evolution and Information Theory
Interactive website at https://sane24.github.io/NYT-Wordle-AI/
where you can play against the AI, watch evolution and the genetic algorithm live, get hints using information theory.

One puzzle, solved with two kinds of intelligence. 
This project solves Wordle with:
- **An information-theory solver** - picks the guess with the highest *entropy*: the one whose feedback pattern is expected to shrink the space of possible answers the most. It reasons in information bits.
- **A genetic-algorithm solver** - a population of 100+ agents, each with a genome of strategy weights (positional letter frequency, 50/50 split-seeking, when to stop probing and commit…). Every generation the agents play real Wordle games; the weakest half dies, elites survive, parents crossbreed, children mutate. No entropy math is hard-coded - good strategy *evolves*.


Measured on the full 2,315 answer list:

| Solver | Avg guesses | Solve rate |
|---|---|---|
| Entropy AI | ~3.49 | 100% |
| Evolved GA champion | ~3.65 | ~99% |
| Random consistent guesser | ~5+ | ~85% |


**Entropy solver.** For guess *G* over candidate set *C*, the 243 possible feedback patterns partition *C*. The expected information is `H(G) = log2|C| − (1/|C|) Σ n_b·log2(n_b)`. The solver plays the max-entropy guess, tie-breaking toward words that could be the answer (they can win outright). First-move entropies over the whole dictionary are precomputed.

**Genetic solver.** A genome is 7 genes: weights for positional frequency, letter frequency, split-seeking (prefer letters near 50/50 presence - information theory rediscovered by evolution), unique letters, answer bias, plus *commit threshold* and *commit turn* (when to stop probing). Fitness = penalty-adjusted average guesses over a fresh sample of real games each generation. Selection is tournament-based with elitism, uniform/blend crossover, Gaussian mutation, and a few random immigrants per generation for diversity.

## Notes

- The daily puzzle is a deterministic hash of the date over the public answer list, it is not the official NYT word, so nothing here scrapes or spoils the real game.
- Custom words outside the official answer list work everywhere: solvers detect the situation and fall back to the full legal-guess dictionary.
