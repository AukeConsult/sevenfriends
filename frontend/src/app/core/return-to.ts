import { Injectable } from '@angular/core';

/** Where the back arrow of a friend's page leads: Home normally, Home with the sleep list open when the friend was opened from it. */
@Injectable({ providedIn: 'root' })
export class ReturnTo {
  private sleepList = false;

  /** The sleep list opens a friend: the back arrow brings the person back to the list. */
  fromSleepList(): void {
    this.sleepList = true;
  }

  /** Home asks once: true when it must open the sleep list again. */
  takeSleepList(): boolean {
    const was = this.sleepList;
    this.sleepList = false;
    return was;
  }

  /** The person went somewhere else: forget it. */
  clear(): void {
    this.sleepList = false;
  }
}
