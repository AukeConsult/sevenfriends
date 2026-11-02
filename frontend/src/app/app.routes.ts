import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { AddFriend } from './add-friend/add-friend';
import { Chat } from './chat/chat';
import { Friends } from './friends/friends';
import { Login } from './login/login';
import { LoginEmail } from './login-email/login-email';
import { LoginLink } from './login-link/login-link';
import { PhoneAuth } from './phone-auth/phone-auth';
import { Notifications } from './notifications/notifications';
import { Pending } from './pending/pending';
import { Profile } from './profile/profile';

export const routes: Routes = [
  { path: '', component: Notifications, canActivate: [authGuard], title: 'Notifications – Seven Friends' },
  { path: 'friends', component: Friends, canActivate: [authGuard], title: 'Friends – Seven Friends' },
  { path: 'friends/add', component: AddFriend, canActivate: [authGuard], title: 'Add a friend – Seven Friends' },
  { path: 'friends/:id', component: Chat, canActivate: [authGuard], title: 'Conversation – Seven Friends' },
  { path: 'pending', component: Pending, canActivate: [authGuard], title: 'Waiting – Seven Friends' },
  { path: 'profile', component: Profile, canActivate: [authGuard], title: 'Profile – Seven Friends' },
  { path: 'login', component: Login, canActivate: [guestGuard], title: 'Sign in – Seven Friends' },
  { path: 'login/email', component: LoginEmail, canActivate: [guestGuard], title: 'Email link – Seven Friends' },
  { path: 'login/phone', component: PhoneAuth, canActivate: [guestGuard], data: { mode: 'login' }, title: 'Phone sign-in – Seven Friends' },
  { path: 'login/link', component: LoginLink, title: 'Signing in – Seven Friends' },
  { path: 'verify-phone', component: PhoneAuth, canActivate: [authGuard], data: { mode: 'link' }, title: 'Verify phone – Seven Friends' },
  { path: '**', redirectTo: '' },
];
