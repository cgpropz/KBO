import { discordInviteFromEnv } from './discordInvite';
import './Discord.css';

export default function DiscordInviteLink({ className = 'discord-invite', children }) {
  const href = discordInviteFromEnv();
  if (!href) return null;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children || 'Join our Discord'}
    </a>
  );
}
