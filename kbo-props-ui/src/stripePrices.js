/*
 * Live Stripe price and product ids shared by the site and the API.
 *
 * Server env vars may point checkout at a replacement id; the defaults stay
 * recognized so an override cannot drop access for someone who already paid.
 *
 * LEGACY_LIFETIME_PRICE_ID is the archived $99.99 one-time lifetime price.
 * Nothing sells it any more. It stays here only so past buyers of that
 * price keep All-Access when their purchase is looked up.
 */

export const LEGACY_LIFETIME_PRICE_ID = 'price_1THZjaPwL0k9PEMvARtuGG1F';
export const DEFAULT_LIFETIME_PRICE_ID = 'price_1UPJ78PwL0k9PEMvnZPU3k5a';
export const DEFAULT_LIFETIME_PRODUCT_ID = 'prod_UG5v4BQ2Mo0wie';
export const DEFAULT_YEARLY_PRICE_ID = 'price_1UPJ7DPwL0k9PEMv2Z9Ca8B5';
export const DEFAULT_YEARLY_PRODUCT_ID = 'prod_VQ9PL4yWUC4l6Z';

export const YEARLY_PAYMENT_LINK = 'https://buy.stripe.com/9B63cxb0jdeCcDw1eM5Ne0a';
