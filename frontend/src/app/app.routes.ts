import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { AddFriend } from './add-friend/add-friend';
import { AddMedia } from './add-media/add-media';
import { Chat } from './chat/chat';
import { DeleteAccount } from './delete-account/delete-account';
import { Friends } from './friends/friends';
import { Sleeping } from './sleeping/sleeping';
import { FriendJoin } from './friend-join/friend-join';
import { InstallApp } from './install-app/install-app';
import { InstallDevice } from './install-device/install-device';
import { Privacy } from './privacy/privacy';
import { Terms } from './terms/terms';
import { About } from './about/about';
import { Login } from './login/login';
import { Welcome } from './welcome/welcome';
import { LoginEmail } from './login-email/login-email';
import { LoginLink } from './login-link/login-link';
import { MediaViewer } from './media-viewer/media-viewer';
import { PhoneAuth } from './phone-auth/phone-auth';
import { Notifications } from './notifications/notifications';
import { Pending } from './pending/pending';
import { Profile } from './profile/profile';
import { ProfilePicturePage } from './profile-picture/profile-picture';
import { Settings } from './settings/settings';
import { Setup } from './setup/setup';
import { SettingsShell } from './settings-shell/settings-shell';
import { SoundPicker } from './sound-picker/sound-picker';

export const routes: Routes = [
  { path: '', component: Notifications, canActivate: [authGuard], title: 'Notifications – Seven Friends' },
  { path: 'friends', component: Friends, canActivate: [authGuard], title: 'Friends – Seven Friends' },
  { path: 'friends/sleeping', component: Sleeping, canActivate: [authGuard], title: 'Sleep list – Seven Friends' },
  { path: 'friends/join', component: FriendJoin, canActivate: [authGuard], title: 'Friend request – Seven Friends' },
  { path: 'friends/add', component: AddFriend, canActivate: [authGuard], title: 'Add a friend – Seven Friends' },
  { path: 'friends/:id/image', component: AddMedia, data: { kind: 'image' }, canActivate: [authGuard], title: 'Send an image – Seven Friends' },
  { path: 'friends/:id/audio', component: AddMedia, data: { kind: 'audio' }, canActivate: [authGuard], title: 'Send a voice message – Seven Friends' },
  { path: 'friends/:id/video', component: AddMedia, data: { kind: 'video' }, canActivate: [authGuard], title: 'Send a video – Seven Friends' },
  { path: 'friends/:id/safebox', loadComponent: () => import('./safebox/safebox').then((m) => m.Safebox), canActivate: [authGuard], title: 'Safebox – Seven Friends' },
  { path: 'friends/:id', component: Chat, canActivate: [authGuard], title: 'Conversation – Seven Friends' },
  { path: 'media/:ownerId/:objectId', component: MediaViewer, canActivate: [authGuard], title: 'Image – Seven Friends' },
  { path: 'setup', component: Setup, canActivate: [authGuard], title: 'Set up – Seven Friends' },
  { path: 'pending', component: Pending, canActivate: [authGuard], title: 'Waiting – Seven Friends' },
  { path: 'profile', component: Profile, canActivate: [authGuard], title: 'Profile – Seven Friends' },
  { path: 'profile/picture', component: ProfilePicturePage, canActivate: [authGuard], title: 'Your picture – Seven Friends' },
  // Settings: ONE page with a tab for each part (the tab is the child route)
  {
    path: 'settings',
    component: SettingsShell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'preferences' },
      { path: 'preferences', component: Settings, data: { section: 'preferences' }, title: 'Preferences – Seven Friends' },
      { path: 'sounds', component: Settings, data: { section: 'sounds' }, title: 'Sounds – Seven Friends' },
      { path: 'sounds/:event', component: SoundPicker, title: 'Choose a sound – Seven Friends' },
      { path: 'notifications', component: Settings, data: { section: 'notifications' }, title: 'Notifications – Seven Friends' },
      { path: 'install', component: InstallApp, title: 'Install the app – Seven Friends' },
      // the same three pages without the tabs, for someone who is not signed in (the sign-in page links to them)
  { path: 'privacy', component: Privacy, title: 'Your data and privacy – Seven Friends' },
      { path: 'terms', component: Terms, title: 'Terms of use – Seven Friends' },
      { path: 'about', component: About, title: 'About – Seven Friends' },
    ],
  },
  // the earlier address of the settings page (a saved link, a notification that was shown before)
  { path: 'sound-and-notifications', redirectTo: 'settings/sounds' },
  { path: 'sound-and-notifications/:event', redirectTo: 'settings/sounds/:event' },
  { path: 'privacy', component: Privacy, title: 'Your data and privacy – Seven Friends' },
  { path: 'terms', component: Terms, title: 'Terms of use – Seven Friends' },
  { path: 'about', component: About, title: 'About – Seven Friends' },
  // one install page for each kind of device (public: the welcome page links here)
  { path: 'install/android', component: InstallDevice, data: { device: 'android' }, title: 'Get the Android app – Seven Friends' },
  { path: 'install/iphone', component: InstallDevice, data: { device: 'iphone' }, title: 'Add to your home screen – Seven Friends' },
  { path: 'install/windows', component: InstallDevice, data: { device: 'windows' }, title: 'Install the app – Seven Friends' },
  { path: 'install-app', component: InstallApp, title: 'Install the app – Seven Friends' },
  { path: 'welcome', component: Welcome, canActivate: [guestGuard], title: 'Welcome – Seven Friends' },
  { path: 'login', component: Login, canActivate: [guestGuard], title: 'Sign in – Seven Friends' },
  { path: 'login/email', component: LoginEmail, canActivate: [guestGuard], title: 'Email link – Seven Friends' },
  { path: 'login/phone', component: PhoneAuth, canActivate: [guestGuard], data: { mode: 'login' }, title: 'Phone sign-in – Seven Friends' },
  { path: 'login/link', component: LoginLink, title: 'Signing in – Seven Friends' },
  { path: 'verify-phone', component: PhoneAuth, canActivate: [authGuard], data: { mode: 'link' }, title: 'Verify phone – Seven Friends' },
  { path: 'delete-account', component: DeleteAccount, canActivate: [authGuard], title: 'Delete my account – Seven Friends' },
  { path: '**', redirectTo: '' },
];
