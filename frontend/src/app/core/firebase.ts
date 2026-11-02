import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { environment } from '../../environments/environment';

export const firebaseApp = initializeApp(environment.firebase);
export const auth = getAuth(firebaseApp);

if (environment.useEmulators) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  auth.settings.appVerificationDisabledForTesting = true; // phone sign-in without the reCAPTCHA check (the emulator prints the SMS code)
}
