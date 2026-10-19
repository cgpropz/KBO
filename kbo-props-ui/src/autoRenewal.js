// One auto-renewal sentence for pricing, checkout, and the terms page.
// Prices come from the same plan list the buy buttons use.

import { TIERS, discordPlanCards } from './pricingTiers.js';

function tier(id) {
  return TIERS.find((item) => item.id === id);
}

export function autoRenewalStatement(env) {
  const weekly = tier('weekly');
  const monthly = tier('combined');
  const yearly = tier('yearly');
  const lifetime = tier('lifetime');
  const discord = discordPlanCards(env);
  const discordWeekly = discord.find((plan) => plan.plan === 'weekly');
  const discordMonthly = discord.find((plan) => plan.plan === 'monthly');
  return [
    `Weekly All-Access renews automatically at ${weekly.price} every week until you cancel.`,
    `When the XWEEK code applies, the first week is $4.99 and each later week renews at ${weekly.price} until you cancel.`,
    `Monthly All-Access renews automatically at ${monthly.price} every month until you cancel.`,
    `Yearly All-Access renews automatically at ${yearly.price} every year until you cancel.`,
    `Discord Only Weekly renews automatically at ${discordWeekly.price} every week until you cancel.`,
    `Discord Only Monthly renews automatically at ${discordMonthly.price} every month until you cancel.`,
    `Lifetime All-Access is a one-time payment of ${lifetime.price} and does not renew.`,
    'You can cancel anytime. Access continues until the end of the current billing period.',
  ].join(' ');
}
