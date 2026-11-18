import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { PokePauseService } from '../core/poke-pause.service';

/**
 * Pause pokes, a small card (Home and Settings → Notifications → Poke settings): "Pokes are on" with Pause, which opens the choices (an expandable frame, no
 * pop-up): 1 hour, 4 hours, until morning, 24 hours. While paused: "Pokes paused until 18:30" with Resume. It holds for all circles (it is on the account).
 */
@Component({
  selector: 'app-poke-pause',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslocoDirective],
  providers: [provideTranslocoScope('pokePause')],
  host: { style: 'display: block' },
  template: `
    <ng-container *transloco="let t">
      <div class="card" [class.border-warning]="pause.paused()">
        <div class="card-body vstack gap-2 py-2">
          <div class="d-flex align-items-center gap-2">
            <svg class="flex-shrink-0" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 003.4 0" />
              @if (pause.paused()) { <path d="M3 3l18 18" /> }
            </svg>
            <div class="flex-grow-1">
              @if (pause.paused()) {
                <div class="fw-semibold">{{ t('pokePause.pokesPaused') || 'Pokes paused' }}</div>
                <div class="sf-hint">{{ t('pokePause.until', { time: (pause.until() | date: 'shortTime') }) || 'Until ' + (pause.until() | date: 'shortTime') }} · {{ t('pokePause.allCircles') || 'everywhere' }}</div>
              } @else {
                <div class="fw-semibold">{{ t('pokePause.pokesAreOn') || 'Pokes are on' }}</div>
                <div class="sf-hint">{{ t('pokePause.friendsCanRingYou') || 'Friends can ring you' }}</div>
              }
            </div>
            @if (pause.paused()) {
              <button type="button" class="btn btn-sm btn-primary" [disabled]="pause.busy()" (click)="pause.resume()">{{ t('pokePause.resume') || 'Resume' }}</button>
            } @else {
              <button type="button" class="btn btn-sm btn-outline-secondary" [attr.aria-expanded]="open()" (click)="open.set(!open())">{{ t('pokePause.pause') || 'Pause' }}</button>
            }
          </div>
          <div class="sf-expand" [class.open]="open() && !pause.paused()" [attr.inert]="open() && !pause.paused() ? null : ''">
            <div class="sf-expand-inner">
              <div class="vstack gap-2 pt-1">
                <div class="fw-semibold">{{ t('pokePause.pauseFor') || 'Pause pokes for' }}</div>
                <div class="d-flex flex-wrap gap-2">
                  <button type="button" class="btn btn-sm btn-outline-secondary flex-fill" [disabled]="pause.busy()" (click)="start(60)">{{ t('pokePause.oneHour') || '1 hour' }}</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary flex-fill" [disabled]="pause.busy()" (click)="start(240)">{{ t('pokePause.fourHours') || '4 hours' }}</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary flex-fill" [disabled]="pause.busy()" (click)="start(untilMorning())">{{ t('pokePause.untilMorning') || 'Until morning' }}</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary flex-fill" [disabled]="pause.busy()" (click)="start(1440)">{{ t('pokePause.twentyFourHours') || '24 hours' }}</button>
                </div>
                <div class="sf-hint">{{ t('pokePause.explain') || 'Applies everywhere in the app. Messages still arrive normally, and your friends see Silent.' }}</div>
                <div><button type="button" class="btn btn-sm btn-light" (click)="open.set(false)">{{ t('pokePause.cancel') || 'Cancel' }}</button></div>
              </div>
            </div>
          </div>
          @if (pause.error(); as error) { <div class="alert alert-warning m-0" role="alert">{{ error }}</div> }
        </div>
      </div>
    </ng-container>
  `,
})
export class PokePause implements OnInit {
  protected readonly pause = inject(PokePauseService);
  protected readonly open = signal(false);

  ngOnInit(): void {
    void this.pause.load();
  }

  protected untilMorning(): number {
    return PokePauseService.minutesUntilMorning();
  }

  protected async start(minutes: number): Promise<void> {
    await this.pause.pause(minutes);
    if (!this.pause.error()) this.open.set(false);
  }
}
