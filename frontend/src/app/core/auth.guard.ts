import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { WelcomeService } from './welcome.service';

// Note: inject() only works before the first `await`, so grab dependencies first.

/** Only signed-in users may enter. Signed out: the welcome page (the install step) when it is due, else the sign-in page. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const welcome = inject(WelcomeService);
  await auth.ready;
  return auth.user() ? true : router.createUrlTree([welcome.shouldShow() ? '/welcome' : '/login']);
};

/** Signed-in users skip the login page. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.user() ? router.createUrlTree(['/']) : true;
};
