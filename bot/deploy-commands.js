// Registers the /wordle slash command. Run once (and after any command edits):
//   npm run bot:deploy
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandsJson } from './commands.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID in bot/.env (see bot/.env.example).');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) // instant, one server
  : Routes.applicationCommands(CLIENT_ID);               // global, ~1h to propagate

const data = await rest.put(route, { body: commandsJson });
console.log(`Registered ${data.length} command(s) ${GUILD_ID ? `in guild ${GUILD_ID}` : 'globally'}.`);
