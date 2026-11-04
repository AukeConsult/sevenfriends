import { Injectable } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';

/** What changed on one of the person's devices (or on a friend's), told by the backend through Firestore. */
export type LiveChange =
  | { type: 'profile' } // my mood, name, picture, icon ... were saved
  | { type: 'sounds' } // my sound choices were saved
  | { type: 'feed'; connectionId: string }; // the messages of this friendship changed (written, edited or deleted)

/**
 * The ONE channel for live changes. `RealtimeService` is the only one that listens to Firestore and emits here;
 * every service or page that must follow a change subscribes to its own kind with `on(type)` and reloads its own data.
 * (A separate service, so a service that RealtimeService itself uses, like the sounds, can listen without a circle.)
 */
@Injectable({ providedIn: 'root' })
export class LiveChanges {
  private readonly subject = new Subject<LiveChange>();

  emit(change: LiveChange): void {
    this.subject.next(change);
  }

  on<T extends LiveChange['type']>(type: T): Observable<Extract<LiveChange, { type: T }>> {
    return this.subject.pipe(filter((change): change is Extract<LiveChange, { type: T }> => change.type === type));
  }
}
