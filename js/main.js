// Entry point: tab routing + lazy tab initialization.
import { initPlay } from './play.js';
import { initAssistant } from './assistant.js';
import { initEvolution } from './evolution.js';
import { initCompare } from './compare.js';

const initializers = {
  play: initPlay,
  assistant: initAssistant,
  evolution: initEvolution,
  compare: initCompare,
};
const initialized = new Set();

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('main .panel').forEach((p) =>
    p.classList.toggle('hidden', p.id !== `panel-${name}`));
  if (!initialized.has(name)) {
    initialized.add(name);
    initializers[name]();
  }
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) showTab(b.dataset.tab);
});

showTab('play');
