import { DatePipe } from '@angular/common';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, ElementRef, OnInit, effect, inject, signal, viewChild } from '@angular/core';
import { loadStripe, Stripe, StripeElements } from '@stripe/stripe-js';
import { ApiService } from '../core/api.service';
import { tr } from '../core/i18n';

/** One donation as the backend lists it (the amount is in the smallest unit of the currency). */
interface Donation {
  id: string;
  amount: number;
  currency: string;
  status: 'completed' | 'refunded';
  paidAt: number;
}

/** What can be donated (smallest unit of the currency). */
interface Limits {
  currency: string;
  min: number;
  max: number;
  suggested: number;
}

/**
 * Donations. Step 1: the person chooses the amount (the least is set by the backend, 5.00 by default). Step 2: the Stripe Payment Element sits in the page and
 * Donate pays. A person can donate as often as they like, and every donation made is listed with its amount and date.
 * A donation counts when Stripe's webhook reaches the backend, so after paying the list is asked again until the new donation is in it.
 */
@Component({
  selector: 'app-support',
  imports: [TranslocoDirective, DatePipe],
  templateUrl: './support.html',
  providers: [provideTranslocoScope('support')],
})
export class Support implements OnInit {
  private readonly api = inject(ApiService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('element');
  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private mounted = false;

  protected readonly state = signal<'loading' | 'amount' | 'preparing' | 'ready' | 'paying' | 'done' | 'unavailable'>('loading');
  protected readonly error = signal('');
  protected readonly enabled = signal(false);
  protected readonly limits = signal<Limits | null>(null);
  protected readonly donations = signal<Donation[]>([]);
  /** the amount in the field, as text in whole units of the currency (for example "5" or "12.50") */
  protected readonly amountText = signal('');
  /** the amount that is being paid, shown above the card form */
  protected readonly price = signal('');

  constructor() {
    // the container only exists after the page has drawn the 'ready' state: mount the Payment Element then, once for each new payment
    effect(() => {
      const host = this.host();
      if (host && this.elements && !this.mounted) {
        this.mounted = true;
        this.elements.create('payment').mount(host.nativeElement);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.chooseAmount();
  }

  /** Step 1: asks for the donations made and what can be donated. */
  protected async chooseAmount(): Promise<void> {
    this.state.set('loading');
    this.error.set('');
    this.mounted = false;
    this.elements = null;
    try {
      await this.loadDonations();
    } catch {
      this.state.set('unavailable');
      return;
    }
    const limits = this.limits();
    if (!this.enabled() || !limits) {
      this.state.set('unavailable');
      return;
    }
    this.amountText.set(String(limits.suggested / 100));
    this.state.set('amount');
  }

  private async loadDonations(): Promise<number> {
    const status = await this.api.request<{ enabled: boolean; limits: Limits | null; donations: Donation[] }>('/payments/status');
    this.enabled.set(status.enabled);
    this.limits.set(status.limits);
    this.donations.set(status.donations);
    return status.donations.length;
  }

  protected money(amount: number, currency: string): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: amount % 100 === 0 ? 0 : 2 }).format(amount / 100);
  }

  /** the amounts to tap: a few round ones inside what can be donated */
  protected choices(): number[] {
    const limits = this.limits();
    return limits ? [500, 1000, 2500, 5000].filter((a) => a >= limits.min && a <= limits.max) : [];
  }

  protected pick(amount: number): void {
    this.amountText.set(String(amount / 100));
    this.error.set('');
  }

  /** the field as an amount in the smallest unit (null when it is not a number) */
  private chosen(): number | null {
    const value = Number(this.amountText().replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  }

  /** Step 2: makes the payment for the chosen amount and shows the card form. */
  protected async next(): Promise<void> {
    const limits = this.limits();
    const amount = this.chosen();
    if (!limits) return;
    if (amount === null || amount < limits.min || amount > limits.max) {
      this.error.set(
        tr('support.amountRange', 'Choose an amount from {{ min }} to {{ max }}.')
          .replace('{{ min }}', this.money(limits.min, limits.currency))
          .replace('{{ max }}', this.money(limits.max, limits.currency)),
      );
      return;
    }
    this.error.set('');
    this.state.set('preparing');
    try {
      const intent = await this.api.request<{ clientSecret: string; publishableKey: string; amount: number; currency: string }>('/payments/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      this.price.set(this.money(intent.amount, intent.currency));
      this.stripe = await loadStripe(intent.publishableKey);
      if (!this.stripe) throw new Error('Stripe did not load');
      this.mounted = false;
      this.elements = this.stripe.elements({ clientSecret: intent.clientSecret });
      this.state.set('ready');
    } catch {
      this.error.set(tr('support.failed', 'The payment did not go through.'));
      this.state.set('amount');
    }
  }

  protected async pay(): Promise<void> {
    if (!this.stripe || !this.elements) return;
    this.error.set('');
    this.state.set('paying');
    let result;
    try {
      result = await this.stripe.confirmPayment({
        elements: this.elements,
        redirect: 'if_required',
        confirmParams: { return_url: `${location.origin}/settings/support` },
      });
    } catch {
      this.error.set(tr('support.failed', 'The payment did not go through.'));
      this.state.set('ready');
      return;
    }
    if (result.error) {
      this.error.set(result.error.message ?? tr('support.failed', 'The payment did not go through.'));
      this.state.set('ready');
    } else {
      this.state.set('done');
      void this.waitForWebhook();
    }
  }

  /** The donation counts when Stripe's webhook reaches the backend, a moment after the payment: ask every 2 seconds (at most 30 seconds) until the list has the new one. */
  private async waitForWebhook(): Promise<void> {
    const before = this.donations().length;
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        if ((await this.loadDonations()) > before) return;
      } catch {
        // try again
      }
    }
  }
}
