import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { PokeAlarmService } from '../core/poke-alarm.service';

/**
 * The band at the top of the page while a poke rings in a browser (see `PokeAlarmService`): who is poking, their text, **Stop** and **Open**. It is part of the page (sticky
 * at the top), not a pop-up.
 */
@Component({
  selector: 'app-poke-alarm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('pokeAlarm')],
  host: { style: 'display: contents' },
  template: `
    @if (alarm.ringing(); as poke) {
      <div class="sf-poke-alarm" role="alert" *transloco="let t">
        <div class="sf-poke-alarm-text">
          <strong>🔔 {{ t('pokeAlarm.pokeFrom', { name: poke.name }) || 'Poke from ' + poke.name }}</strong>
          @if (poke.text) { <span>{{ poke.text }}</span> }
        </div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-sm btn-light" (click)="alarm.stop()">{{ t('pokeAlarm.stop') || 'Stop' }}</button>
          <button type="button" class="btn btn-sm btn-light" (click)="open(poke.url)">{{ t('pokeAlarm.open') || 'Open' }}</button>
        </div>
      </div>
    }
  `,
})
export class PokeAlarmBand {
  protected readonly alarm = inject(PokeAlarmService);
  private readonly router = inject(Router);

  protected open(url: string): void {
    this.alarm.stop();
    void this.router.navigateByUrl(url);
  }
}
