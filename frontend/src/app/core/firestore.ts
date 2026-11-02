import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { firebaseApp } from './firebase';

// Only loaded on demand (import('./firestore')), so the Firestore SDK stays out of the first download.
export const db = getFirestore(firebaseApp);

if (environment.useEmulators) {
  connectFirestoreEmulator(db, 'localhost', 8080);
}
