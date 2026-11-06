import { Component } from '@angular/core';
import { SeatDots } from '../seat-dots/seat-dots';

/** The top of the sign-in and welcome pages: the 7 logo, the name, the slogan and the seven dots. */
@Component({
  selector: 'app-hero',
  imports: [SeatDots],
  template: `
    <div class="sf-hero text-center">
      <div class="sf-logo sf-logo-lg">7</div>
      <h1 class="mt-3 mb-2">Seven Friends</h1>
      <p class="sf-hero-tag m-0">Stay close to the friends who matter most.</p>
      <app-seat-dots [blink]="true" />
    </div>
  `,
})
export class Hero {}
