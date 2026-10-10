import { handleDiscordCallback } from './_discordSync.js';

export default function handler(req, res) {
  return handleDiscordCallback(req, res);
}
