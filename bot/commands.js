// Slash-command definitions, shared by deploy-commands.js and index.js.
import { SlashCommandBuilder } from 'discord.js';

export const wordleCommand = new SlashCommandBuilder()
  .setName('wordle')
  .setDescription('Wordle Solver AI: play against the AI, get hints, compare solvers')
  .addSubcommand((sc) =>
    sc.setName('play')
      .setDescription('Start a game: you vs the AI on the same secret word')
      .addStringOption((o) =>
        o.setName('opponent').setDescription('Which AI you race against')
          .addChoices(
            { name: 'Entropy AI (information theory)', value: 'entropy' },
            { name: 'Evolved GA champion (genetic algorithm)', value: 'ga' },
          ))
      .addStringOption((o) =>
        o.setName('source').setDescription('Where the secret word comes from')
          .addChoices(
            { name: 'random', value: 'random' },
            { name: 'daily puzzle', value: 'daily' },
          ))
      .addBooleanOption((o) =>
        o.setName('same_opener').setDescription('AI starts with the same first word as you')))
  .addSubcommand((sc) =>
    sc.setName('guess')
      .setDescription('Submit a guess in your active game')
      .addStringOption((o) =>
        o.setName('word').setDescription('Your 5-letter guess').setRequired(true)))
  .addSubcommand((sc) =>
    sc.setName('hint')
      .setDescription('Best next guesses for any Wordle position')
      .addStringOption((o) =>
        o.setName('state')
          .setDescription('Your guesses so far, e.g. "crane=bygyb soils=gybbb" (g=green y=yellow b=gray). Empty = openers')))
  .addSubcommand((sc) =>
    sc.setName('solve')
      .setDescription('Watch the AI solve a specific word')
      .addStringOption((o) =>
        o.setName('word').setDescription('Target 5-letter word').setRequired(true))
      .addStringOption((o) =>
        o.setName('solver').setDescription('Which solver')
          .addChoices(
            { name: 'Entropy AI', value: 'entropy' },
            { name: 'Evolved GA champion', value: 'ga' },
          )))
  .addSubcommand((sc) =>
    sc.setName('compare')
      .setDescription('Race all solvers on the same word, side by side')
      .addStringOption((o) =>
        o.setName('word').setDescription('Target word (omit for a random one)'))
      .addStringOption((o) =>
        o.setName('opener').setDescription('Force every solver to start with this word')))
  .addSubcommand((sc) =>
    sc.setName('daily')
      .setDescription("Today's daily puzzle (deterministic, not the official NYT word)"))
  .addSubcommand((sc) =>
    sc.setName('giveup')
      .setDescription('Abandon your active game and reveal the word'));

export const commandsJson = [wordleCommand.toJSON()];
