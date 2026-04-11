// Stripe billing service. Phase 9 wires the skeleton for subscription
// checkout, customer portal, and webhook handling. The actual Stripe
// integration activates only when STRIPE_SECRET_KEY is set in env;
// without it, the service throws a clear "not configured" error so
// operators running locally without Stripe don't get confusing 500s.
//
// Architecture:
//   1. createCheckoutSession(workspaceId, tier) — starts a Stripe
//      Checkout session for the given plan, returns a URL to redirect
//      the browser to. Success/cancel URLs come from APP_URL.
//   2. createPortalSession(workspaceId) — returns a Stripe Customer
//      Portal URL where the operator can update card, cancel, or
//      change plans outside the app.
//   3. handleWebhook(payload, signature) — verifies SendGrid-style
//      signature, routes events (checkout.session.completed,
//      customer.subscription.updated, invoice.payment_failed) to
//      workspace plan/counter mutations.
//
// IMPORTANT: This skeleton is untested against live Stripe. Activating
// for a real workspace needs (a) STRIPE_SECRET_KEY, (b) the three
// STRIPE_*_PRICE_ID env vars, (c) a STRIPE_WEBHOOK_SECRET, and (d)
// a dry-run against Stripe test mode to validate webhook dispatch.

import Stripe from 'stripe';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import { PLAN_LIMITS, type PlanTier } from '@shared/plans';

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Stripe billing is not configured. Set STRIPE_SECRET_KEY to enable.');
  }
}

export class BillingService {
  private stripe: Stripe | null;
  private enabled: boolean;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      this.stripe = new Stripe(key);
      this.enabled = true;
      logger.info('[billing] stripe enabled');
    } else {
      this.stripe = null;
      this.enabled = false;
      logger.warn('[billing] STRIPE_SECRET_KEY not set — billing is disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Build a Checkout session for a workspace subscribing to a tier.
   * Returns the Stripe-hosted checkout URL to redirect to. Requires
   * the corresponding STRIPE_<TIER>_PRICE_ID env var to be set.
   */
  async createCheckoutSession(
    workspaceId: string,
    tier: Exclude<PlanTier, 'free'>
  ): Promise<{ url: string }> {
    if (!this.stripe) throw new BillingNotConfiguredError();

    const limits = PLAN_LIMITS[tier];
    const priceEnvVar = limits.stripePriceEnvVar;
    if (!priceEnvVar) throw new Error(`Plan ${tier} has no Stripe price env var`);
    const priceId = process.env[priceEnvVar];
    if (!priceId) throw new Error(`${priceEnvVar} not set`);

    const workspace = await storage.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const appUrl = process.env.APP_URL || 'http://localhost:5000';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: workspace.stripeCustomerId ?? undefined,
      customer_email: workspace.stripeCustomerId ? undefined : undefined,
      client_reference_id: workspaceId,
      metadata: { workspaceId, tier },
      success_url: `${appUrl}/?billing=success`,
      cancel_url: `${appUrl}/?billing=cancelled`,
    });

    if (!session.url) throw new Error('Stripe checkout session did not return a URL');
    return { url: session.url };
  }

  /** Return a Customer Portal URL for the workspace's Stripe customer. */
  async createPortalSession(workspaceId: string): Promise<{ url: string }> {
    if (!this.stripe) throw new BillingNotConfiguredError();

    const workspace = await storage.getWorkspace(workspaceId);
    if (!workspace?.stripeCustomerId) {
      throw new Error('Workspace has no Stripe customer ID — complete checkout first');
    }

    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const session = await this.stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: appUrl,
    });
    return { url: session.url };
  }

  /**
   * Verify the webhook signature and route the event. Called from
   * POST /api/webhooks/stripe with the raw body. Returns the event
   * type that was handled so the route can log it.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<string> {
    if (!this.stripe) throw new BillingNotConfiguredError();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${(err as Error).message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.workspaceId;
        const tier = session.metadata?.tier as PlanTier | undefined;
        if (workspaceId && tier) {
          await storage.updateWorkspace(workspaceId, {
            plan: tier,
            stripeCustomerId: (session.customer as string) ?? null,
            stripeSubscriptionId: (session.subscription as string) ?? null,
          });
          logger.info({ workspaceId, tier }, '[billing] checkout completed');
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Phase 9 mapping: if the subscription is cancelled or past_due,
        // downgrade to free; otherwise leave plan alone (actual tier
        // comes from the checkout session metadata above).
        if (sub.status === 'canceled' || sub.status === 'unpaid') {
          const workspaceId = sub.metadata?.workspaceId;
          if (workspaceId) {
            await storage.updateWorkspace(workspaceId, { plan: 'free' });
            logger.info({ workspaceId }, '[billing] subscription cancelled -> free');
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const workspaceId = sub.metadata?.workspaceId;
        if (workspaceId) {
          await storage.updateWorkspace(workspaceId, {
            plan: 'free',
            stripeSubscriptionId: null,
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Phase 11 will turn this into an in-app notification. For now
        // we just log — the subscription.updated event that follows
        // handles the actual plan downgrade.
        const inv = event.data.object as Stripe.Invoice;
        logger.warn({ customerId: inv.customer }, '[billing] payment failed');
        break;
      }
      default:
        // Ignore events we don't handle; Stripe retries on non-2xx.
        break;
    }

    return event.type;
  }
}

export const billingService = new BillingService();
