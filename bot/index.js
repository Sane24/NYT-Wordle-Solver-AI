// Wordle Solver AI - Discord bot.
// Setup: copy .env.example to .env, fill in the token, run
//   npm install && npm run bot:deploy && npm run bot
import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { ANSWERS, ALL_WORDS } from '../core/words.js';
import { computeFeedback, patternToEmoji, stringToPattern, ALL_GREEN } from '../core/feedback.js';
import { EntropySolver, solveWord, guessEntropy } from '../core/entropy.js';
import { OPENERS } from '../core/openers.js';
import { CHAMPION } from '../core/champion.js';
import { AgentSolver, playGame } from '../core/genetic.js';
import { dailyWord, dailyNumber, dateKey } from '../core/daily.js';

const VALID = new Set(ALL_WORDS);
const GREEN_COLOR = 0x538d4e;
const RED_COLOR = 0xd0564f;
const AI_NAMES = { entropy: '🧮 Entropy AI', ga: `🧬 Evolved GA (gen ${CHAMPION.generation})` };

// One active game per user+channel.
const sessions = new Map();
const sessionKey = (i) => `${i.user.id}:${i.channelId}`;

const fmt = (n, d = 2) => Number(n).toFixed(d);

function boardLines(history, { spoiler = false } = {}) {
  if (history.length === 0) return '*no guesses yet*';
  return history
    .map((h) => {
      const word = h.guess.toUpperCase();
      return `${patternToEmoji(h.pattern)} ${spoiler ? `||\`${word}\`||` : `\`${word}\``}`;
    })
    .join('\n');
}

function makeAiSolver(kind, forcedOpener = null) {
  if (kind === 'entropy') {
    const solver = new EntropySolver({ openers: OPENERS });
    return {
      next() {
        if (solver.history.length === 0 && forcedOpener) {
          return { word: forcedOpener, entropy: guessEntropy(forcedOpener, solver.candidates) };
        }
        return solver.best();
      },
      observe: (g, p) => solver.observe(g, p),
      count: () => solver.candidateCount,
      explain(move, before, after) {
        return `expected **${fmt(move.entropy ?? 0)} bits** - candidates ${before} → **${after}**`;
      },
    };
  }
  const solver = new AgentSolver(CHAMPION.genome, { firstGuess: forcedOpener || CHAMPION.opener });
  return {
    next: () => solver.nextGuess(),
    observe: (g, p) => solver.observe(g, p),
    count: () => solver.candidateCount,
    explain(move, before, after) {
      return `${move.committed ? 'committed to a possible answer' : 'probed for information'} - candidates ${before} → **${after}**`;
    },
  };
}

// ------------------------------------------------------------- handlers ---

async function handlePlay(interaction, sourceOverride = null) {
  const opponent = interaction.options?.getString?.('opponent') || 'entropy';
  const source = sourceOverride || interaction.options?.getString?.('source') || 'random';
  const sameOpener = interaction.options?.getBoolean?.('same_opener') || false;

  let target, label;
  if (source === 'daily') {
    target = dailyWord();
    label = `Daily #${dailyNumber()} (${dateKey()})`;
  } else {
    target = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    label = 'Random word';
  }

  sessions.set(sessionKey(interaction), {
    target,
    label,
    opponent,
    sameOpener,
    you: [],
    ai: [],
    aiSolver: sameOpener ? null : makeAiSolver(opponent), // built on first guess if copying opener
    aiDone: false,
    aiTurns: null,
    lastAiNote: sameOpener ? 'AI is waiting to copy your first word.' : 'AI moves right after you.',
  });

  const embed = new EmbedBuilder()
    .setColor(GREEN_COLOR)
    .setTitle('🟩 New Wordle race started!')
    .setDescription(
      `**${label}** - you vs **${AI_NAMES[opponent]}**.\n` +
      `Guess with \`/wordle guess word:crane\`. Six tries. ` +
      (sameOpener ? 'The AI will open with your first word.' : '') +
      `\nThe AI's letters stay behind spoiler tags until the game ends - no cheating!`
    );
  await interaction.reply({ embeds: [embed] });
}

async function handleGuess(interaction) {
  const session = sessions.get(sessionKey(interaction));
  if (!session) {
    return interaction.reply({ content: 'No active game here. Start one with `/wordle play`.', flags: MessageFlags.Ephemeral });
  }
  const word = interaction.options.getString('word').trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(word) || (!VALID.has(word) && word !== session.target)) {
    return interaction.reply({ content: `\`${word.toUpperCase()}\` isn't a legal Wordle guess.`, flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();

  const pattern = computeFeedback(word, session.target);
  session.you.push({ guess: word, pattern });
  const youWon = pattern === ALL_GREEN;
  const youOut = session.you.length >= 6 && !youWon;

  if (!session.aiSolver) {
    session.aiSolver = makeAiSolver(session.opponent, session.sameOpener ? word : null);
  }
  const aiPlaysTo = youWon || youOut ? 6 : session.you.length;
  while (!session.aiDone && session.ai.length < aiPlaysTo) {
    const before = session.aiSolver.count();
    const move = session.aiSolver.next();
    const p = computeFeedback(move.word, session.target);
    session.aiSolver.observe(move.word, p);
    session.ai.push({ guess: move.word, pattern: p });
    session.lastAiNote = `Turn ${session.ai.length}: ${session.aiSolver.explain(move, before, session.aiSolver.count())}`;
    if (p === ALL_GREEN) { session.aiDone = true; session.aiTurns = session.ai.length; }
    else if (session.ai.length >= 6) session.aiDone = true;
  }

  const over = youWon || youOut;
  const embed = new EmbedBuilder().setColor(youWon ? GREEN_COLOR : over ? RED_COLOR : 0x2f2f31);

  if (over) {
    const youScore = youWon ? session.you.length : null;
    const aiScore = session.aiTurns;
    let verdict;
    if (youScore && (!aiScore || youScore < aiScore)) verdict = '🏆 **You beat the AI!**';
    else if (youScore && youScore === aiScore) verdict = '🤝 **Tie!**';
    else if (youScore) verdict = '🤖 **The AI takes it.**';
    else verdict = aiScore ? '🤖 **The AI solved it, you did not.**' : '💀 **Nobody solved it.**';
    embed
      .setTitle(`${verdict.replaceAll('*', '')} - the word was ${session.target.toUpperCase()}`)
      .addFields(
        { name: `You - ${youScore ? youScore + '/6' : 'X/6'}`, value: boardLines(session.you), inline: true },
        { name: `${AI_NAMES[session.opponent]} - ${aiScore ? aiScore + '/6' : 'X/6'}`, value: boardLines(session.ai), inline: true },
      )
      .setFooter({ text: 'Rematch: /wordle play' });
    sessions.delete(sessionKey(interaction));
  } else {
    embed
      .setTitle(`Turn ${session.you.length}/6 - ${session.label}`)
      .addFields(
        { name: 'You', value: boardLines(session.you), inline: true },
        { name: AI_NAMES[session.opponent], value: boardLines(session.ai, { spoiler: true }), inline: true },
        { name: 'AI reasoning', value: session.lastAiNote },
      );
  }
  await interaction.editReply({ embeds: [embed] });
}

function parseState(state) {
  if (!state || !state.trim()) return [];
  const history = [];
  for (const tok of state.trim().split(/[\s,;]+/)) {
    const m = tok.match(/^([a-zA-Z]{5})[=:\/]([gybxGYBX\-012]{5})$/);
    if (!m) throw new Error(`Can't parse \`${tok}\`. Use word=colors like \`crane=bygyb\`.`);
    const pattern = stringToPattern(m[2]);
    if (pattern === null) throw new Error(`Bad colors in \`${tok}\` (use g/y/b).`);
    history.push({ guess: m[1].toLowerCase(), pattern });
  }
  return history;
}

async function handleHint(interaction) {
  let history;
  try {
    history = parseState(interaction.options.getString('state'));
  } catch (err) {
    return interaction.reply({ content: String(err.message), flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply();

  const solver = new EntropySolver({ openers: OPENERS });
  for (const h of history) solver.observe(h.guess, h.pattern);
  const n = solver.candidateCount;

  if (n === 0) {
    return interaction.editReply('⚠️ No word matches that feedback. Double-check the colors.');
  }

  const top = solver.rank(5);
  const lines = top.map((s, i) =>
    `${i === 0 ? '★' : `${i + 1}.`} **${s.word.toUpperCase()}** - ${fmt(s.entropy)} bits` +
    `${s.isCandidate ? ` · ${fmt((s.winChance ?? 0) * 100, 1)}% to win now` : ' · probe'}`
  );
  const cands = solver.topCandidates(12).map((w) => `\`${w}\``).join(' ');

  const embed = new EmbedBuilder()
    .setColor(GREEN_COLOR)
    .setTitle(history.length ? `🧭 ${n} possible answer${n === 1 ? '' : 's'} remain` : '🧭 Best opening words')
    .setDescription(
      (history.length ? boardLines(history) + '\n\n' : '') +
      `**Top guesses by expected information:**\n${lines.join('\n')}\n\n` +
      (n <= 200 ? `**Possible answers:** ${cands}${n > 12 ? ` … +${n - 12} more` : ''}` :
        `*(${n} candidates - ${fmt(Math.log2(n))} bits of uncertainty left)*`)
    );
  await interaction.editReply({ embeds: [embed] });
}

function traceLines(trace, noteFn) {
  return trace.map((t, i) =>
    `${patternToEmoji(t.pattern)} \`${t.guess.toUpperCase()}\` - ${noteFn(t, i)}`
  ).join('\n');
}

async function handleSolve(interaction) {
  const word = interaction.options.getString('word').trim().toLowerCase();
  const solverKind = interaction.options.getString('solver') || 'entropy';
  if (!/^[a-z]{5}$/.test(word)) {
    return interaction.reply({ content: 'The target must be exactly 5 letters.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply();

  let embed;
  if (solverKind === 'entropy') {
    const trace = solveWord(word, { openers: OPENERS });
    const solved = trace[trace.length - 1].pattern === ALL_GREEN && trace.length <= 6;
    embed = new EmbedBuilder()
      .setColor(solved ? GREEN_COLOR : RED_COLOR)
      .setTitle(`${AI_NAMES.entropy} solves ${word.toUpperCase()} in ${trace.length} ${solved ? '✓' : '✗'}`)
      .setDescription(traceLines(trace, (t) =>
        `${fmt(t.entropy ?? 0)} bits expected · ${t.candidatesBefore} → ${t.candidatesAfter} left`));
  } else {
    const r = playGame(CHAMPION.genome, word, { firstGuess: CHAMPION.opener, withTrace: true });
    embed = new EmbedBuilder()
      .setColor(r.solved ? GREEN_COLOR : RED_COLOR)
      .setTitle(`${AI_NAMES.ga} solves ${word.toUpperCase()} in ${r.turns} ${r.solved ? '✓' : '✗'}`)
      .setDescription(
        `Champion traits: *${CHAMPION.traits}*\n\n` +
        traceLines(r.trace, (t) =>
          `${t.committed ? 'commit' : 'probe'} · ${t.candidatesBefore} → ${t.candidatesAfter} left`));
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleCompare(interaction) {
  let word = (interaction.options.getString('word') || '').trim().toLowerCase();
  if (!word) word = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
  if (!/^[a-z]{5}$/.test(word)) {
    return interaction.reply({ content: 'The target must be exactly 5 letters.', flags: MessageFlags.Ephemeral });
  }
  const opener = (interaction.options.getString('opener') || '').trim().toLowerCase() || null;
  if (opener && !VALID.has(opener)) {
    return interaction.reply({ content: `Opener \`${opener.toUpperCase()}\` isn't a legal guess.`, flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply();

  const eTrace = solveWord(word, { openers: OPENERS, firstGuess: opener });
  const eSolved = eTrace[eTrace.length - 1].pattern === ALL_GREEN && eTrace.length <= 6;
  const g = playGame(CHAMPION.genome, word, { firstGuess: opener || CHAMPION.opener, withTrace: true });

  const eScore = eSolved ? eTrace.length : null;
  const gScore = g.solved ? g.turns : null;
  let verdict;
  if (eScore && (!gScore || eScore < gScore)) verdict = `${AI_NAMES.entropy} wins!`;
  else if (gScore && (!eScore || gScore < eScore)) verdict = `${AI_NAMES.ga} wins!`;
  else if (eScore && eScore === gScore) verdict = "It's a tie!";
  else verdict = 'Neither solver got it (rare!).';

  const embed = new EmbedBuilder()
    .setColor(GREEN_COLOR)
    .setTitle(`⚔️ ${word.toUpperCase()} - ${verdict}`)
    .setDescription(opener ? `Both forced to open with **${opener.toUpperCase()}**.` : 'Each solver uses its own opener.')
    .addFields(
      {
        name: `${AI_NAMES.entropy} - ${eScore ? eScore + '/6' : 'X/6'}`,
        value: traceLines(eTrace, (t) => `${fmt(t.entropy ?? 0)}b · ${t.candidatesAfter} left`),
        inline: true,
      },
      {
        name: `${AI_NAMES.ga} - ${gScore ? gScore + '/6' : 'X/6'}`,
        value: traceLines(g.trace, (t) => `${t.committed ? 'commit' : 'probe'} · ${t.candidatesAfter} left`),
        inline: true,
      },
    )
    .setFooter({ text: `GA champion: ${CHAMPION.traits} · avg ${fmt(CHAMPION.avgGuesses)} vs entropy ~3.49 over all answers` });
  await interaction.editReply({ embeds: [embed] });
}

async function handleDaily(interaction) {
  await handlePlay(interaction, 'daily');
}

async function handleGiveup(interaction) {
  const session = sessions.get(sessionKey(interaction));
  if (!session) {
    return interaction.reply({ content: 'No active game to give up.', flags: MessageFlags.Ephemeral });
  }
  sessions.delete(sessionKey(interaction));
  await interaction.reply(
    `🏳️ Game over - the word was **${session.target.toUpperCase()}**.\n` +
    `Your board:\n${boardLines(session.you)}\n${AI_NAMES[session.opponent]}:\n${boardLines(session.ai)}`
  );
}

// --------------------------------------------------------------- wiring ---

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}. Champion opener: ${CHAMPION.opener}.`);
});
client.once('ready', () => { /* discord.js v14 compat */ });

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'wordle') return;
  const sub = interaction.options.getSubcommand();
  const handlers = {
    play: handlePlay, guess: handleGuess, hint: handleHint,
    solve: handleSolve, compare: handleCompare, daily: handleDaily, giveup: handleGiveup,
  };
  try {
    await handlers[sub](interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong: ' + err.message, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN - copy bot/.env.example to bot/.env and fill it in.');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
