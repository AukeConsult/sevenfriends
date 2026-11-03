import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { AddFriend } from './add-friend/add-friend';
import { AddMedia } from './add-media/add-media';
import { Chat } from './chat/chat';
import { DeleteAccount } from './delete-account/delete-account';
import { Friends } from './friends/friends';
import { Sleeping } from './sleeping/sleeping';
import { InviteFriend } from './invite-friend/invite-friend';
import { Login } from './login/login';
import { LoginEmail } from './login-email/login-email';
import { LoginLink } from './login-link/login-link';
import { MediaViewer } from './media-viewer/media-viewer';
import { PhoneAuth } from './phone-auth/phone-auth';
import { Notifications } from './notifications/notifications';
import { Pending } from './pending/pending';
import { Profile } from './profile/profile';
import { ProfilePicturePage } from './profile-picture/profile-picture';
import { Settings } from './settings/settings';
import { SoundPicker } from './sound-picker/sound-picker';

export const routes: Routes = [
  { path: '', component: Notifications, canActivate: [authGuard], title: 'Notifications – Seven Friends' },
  { path: 'friends', component: Friends, canActivate: [authGuard], title: 'Friends – Seven Friends' },
  { path: 'friends/sleeping', component: Sleeping, canActivate: [authGuard], title: 'Sleep list – Seven Friends' },
  { path: 'friends/add', component: AddFriend, canActivate: [authGuard], title: 'Add a friend – Seven Friends' },
  { path: 'friends/:id/invite', component: InviteFriend, canActivate: [authGuard], title: 'Invite a friend – Seven Friends' },
  { path: 'friends/:id/image', component: AddMedia, data: { kind: 'image' }, canActivate: [authGuard], title: 'Send an image – Seven Friends' },
  { path: 'friends/:id/audio', component: AddMedia, data: { kind: 'audio' }, canActivate: [authGuard], title: 'Send a voice message – Seven Friends' },
  { path: 'friends/:id/video', component: AddMedia, data: { kind: 'video' }, canActivate: [authGuard], title: 'Send a video – Seven Friends' },
  { path: 'friends/:id', component: Chat, canActivate: [authGuard], title: 'Conversation – Seven Friends' },
  { path: 'media/:ownerId/:objectId', component: MediaViewer, canActivate: [authGuard], title: 'Image – Seven Friends' },
  { path: 'pending', component: Pending, canActivate: [authGuard], title: 'Waiting – Seven Friends' },
  { path: 'profile', component: Profile, canActivate: [authGuard], title: 'Profile – Seven Friends' },
  { path: 'profile/picture', component: ProfilePicturePage, canActivate: [authGuard], title: 'Your picture – Seven Friends' },
  { path: 'sound-and-notifications', component: Settings, canActivate: [authGuard], title: 'Sound and notifications – Seven Friends' },
  { path: 'sound-and-notifications/:event', component: SoundPicker, canActivate: [authGuard], title: 'Choose a sound – Seven Friends' },
  { path: 'login', component: Login, canActivate: [guestGuard], title: 'Sign in – Seven Friends' },
  { path: 'login/email', component: LoginEmail, canActivate: [guestGuard], title: 'Email link – Seven Friends' },
  { path: 'login/phone', component: PhoneAuth, canActivate: [guestGuard], data: { mode: 'login' }, title: 'Phone sign-in – Seven Friends' },
  { path: 'login/link', component: LoginLink, title: 'Signing in – Seven Friends' },
  { path: 'verify-phone', component: PhoneAuth, canActivate: [authGuard], data: { mode: 'link' }, title: 'Verify phone – Seven Friends' },
  { path: 'delete-account', component: DeleteAccount, canActivate: [authGuard], title: 'Delete my account – Seven Friends' },
  { path: '**', redirectTo: '' },
];
