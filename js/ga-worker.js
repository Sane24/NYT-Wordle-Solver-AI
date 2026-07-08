// Web worker that runs the genetic algorithm so the visualization stays smooth.
import { GeneticEvolver, describeGenome } from '../core/genetic.js';

let evolver = null;

self.onmessage = (e) => {
  const { type, payload } = e.data;
  try {
    if (type === 'init') {
      evolver = new GeneticEvolver({
        populationSize: payload.populationSize,
        gamesPerAgent: payload.gamesPerAgent,
        seed: payload.seed ?? ((Math.floor(performance.now()) % 100000) + 1),
      });
      self.postMessage({ type: 'ready' });
    } else if (type === 'step') {
      if (!evolver) throw new Error('not initialized');
      const report = evolver.step();
      for (const a of report.agents) a.traits = describeGenome(a.genome);
      report.best.traits = describeGenome(report.best.genome);
      report.champion = {
        ...evolver.champion,
        traits: describeGenome(evolver.champion.genome),
      };
      report.history = evolver.history;
      self.postMessage({ type: 'report', report });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.stack || err) });
  }
};
