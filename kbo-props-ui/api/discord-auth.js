import { handleDiscordAuth } from './_discordSync.js';

export default function handler(req, res) {
  return handleDiscordAuth(req, res);
}
