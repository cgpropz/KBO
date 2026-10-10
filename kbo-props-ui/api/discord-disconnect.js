import { handleDiscordDisconnect } from './_discordSync.js';

export default function handler(req, res) {
  return handleDiscordDisconnect(req, res);
}
