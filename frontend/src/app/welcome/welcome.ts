import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PageBar } from '../page-bar/page-bar';
import { AuthService } from '../core/auth.service';
import { ActiveCircleService } from '../core/active-circle.service';
import { FriendLinkService } from '../core/friend-link.service';
import { WelcomeService } from '../core/welcome.service';
import { WhyTiles } from '../why-tiles/why-tiles';
import { SeatDots } from '../seat-dots/seat-dots';
import { CIRCLE_PAGES } from '../circle-entry/circle-entry';
import { Inviter } from '../inviter/inviter';

/**
 * The first page for someone who has not signed in (public): the same top for everybody (logo, the promise, the seven
 * seats, three numbers and three reasons). It offers no install: the one way on is to the web app (sign-in) when signed out, or
 * to the home page when signed in. When a friend invitation is waiting, it says so (the inviter's name and hidden address are under the headline, `app-inviter`). See docs/invite-install-login.md.
 */
@Component({
  selector: 'app-welcome',
  imports: [Inviter, PageBar, RouterLink, SeatDots, WhyTiles, TranslocoDirective],
  templateUrl: './welcome.html',
  providers: [provideTranslocoScope('welcome')],
})
export class Welcome {
  private readonly welcome = inject(WelcomeService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  /** /welcome/explain: page 2, only the explanation (the short Friends pages link to it) */
  protected readonly explainOnly = inject(ActivatedRoute).snapshot.data['explain'] === true;
  /** signed in: the page is still shown (it is always open at /welcome), with a way on to the home page */
  protected readonly auth = inject(AuthService);
  private readonly friendLinks = inject(FriendLinkService);
  private readonly active = inject(ActiveCircleService);
  private readonly friend = this.friendLinks.pending;
  protected readonly invited = computed(() => this.friend() !== null);
  /** the ping demo turns round: each scene is three pieces of noise and the one message that matters (words: welcome.json `scene<N>a|b|c|m`) */
  protected readonly scenes = [
    { n: 1, noise: ["47 new posts", "Someone liked…", "Don’t miss out!"], calm: "Mia: Coffee at 5?" },
    { n: 2, noise: ["12 unread newsletters", "Flash sale ends tonight!", "3 new suggestions for you"], calm: "Dad: Dinner on Sunday?" },
    { n: 3, noise: ["Trending now", "Old classmates: 99+ messages", "Sponsored: new shoes"], calm: "Anna: Landed safely ❤️" },
    { n: 4, noise: ["Your story got 3 views", "5 people you may know", "Someone is typing…"], calm: "Tom: Can you call me?" },
    { n: 5, noise: ["Breaking news", "Win a free phone!", "12 people reacted"], calm: "Sara: I’m outside" },
    { n: 6, noise: ["Update available", "Your weekly summary", "Join our community of 2M"], calm: "Mom: Call me when you can ❤️" },
    { n: 7, noise: ["Reply all: 38 people", "Meeting moved again", "#general: 142 unread"], calm: "Jonas: Lunch at 12?" },
    { n: 8, noise: ["Mandatory fun Friday", "Your timesheet is overdue", "Re: Fwd: Fwd: Q3 report"], calm: "Lisa: Need a hand with the deck?" },
  ];
  private readonly turn = signal(0);
  protected readonly scene = computed(() => this.scenes[this.turn() % this.scenes.length]);

  constructor() {
    const timer = setInterval(() => this.turn.update((n) => n + 1), 4500);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    // a link that invites into another circle shows the welcome page of that circle (one of its pages, picked by chance)
    const circle = this.friend()?.circle;
    const pages = circle ? CIRCLE_PAGES[circle] : undefined;
    if (pages && !this.auth.user() && !this.explainOnly) void this.router.navigateByUrl(pages[Math.floor(Math.random() * pages.length)], { replaceUrl: true });
  }

  protected back(): void {
    if (history.length > 1) this.location.back();
    else void this.router.navigateByUrl('/friends1');
  }

  protected continueInBrowser(): void {
    this.welcome.continueInBrowser();
    if (this.friendLinks.enterCircleOf('/login')) return;
    // no link that names a circle: the general welcome page always starts in the Friends circle, whatever circle this browser was in before
    if (!this.friend()?.circle) this.active.choose('default', '/login');
    else void this.router.navigateByUrl('/login');
  }

  /** the explanation under the button: key, English title and text (the words come from welcome.json, these are the fallback) */
  protected readonly explain = [
    { key: "seats", icon: "🪑", title: "Seven seats", text: "One seat for each of your closest friends. When all seven are taken, you free one before you add someone new, so the people who matter never get buried." },
    { key: "circles", icon: "⭕", title: "Four separate circles", text: "There are four circles: Friends, Work, Buddies and Family. Each circle has its own seven seats, its own chats and its own safebox, so what you share in one never shows up in another. The same person can be in more than one circle, and you switch between your circles whenever you like." },
    { key: "calm", icon: "🌙", title: "No noise", text: "No feed, no ads and no strangers. Nobody reaches you unless you let them in." },
    { key: "sleep", icon: "😴", title: "You decide who reaches you", text: "Need a break from someone? Put them on your sleep list: you stay friends, but you stop hearing from them. If something cannot wait, a ping still gets through." },
    { key: "safebox", icon: "📦", title: "A room for every friend", text: "Each friend and each small group has a room of its own, with a safebox for pictures, files, notes, tickets, places and more. Only the people in it share it." },
    { key: "lock", icon: "🔒", title: "Built to be private", text: "Your messages are locked on your own phone before they leave it, so the app is built to keep them unreadable even for us." },
  ];
  /** the four circles, under the chapter that explains them (words: welcome.json `circles<Name>`; the names of the circles come from the same file, in the language of the page) */
  protected readonly circleItems = [
    { key: "circlesFriends", text: "Friends: the people closest to you." },
    { key: "circlesWork", text: "Work: the people you work with." },
    { key: "circlesBuddies", text: "Buddies: your mates and the people you share a hobby with." },
    { key: "circlesFamily", text: "Family: the people at home and your relatives." },
  ];
  protected readonly steps = [
    { key: "start1", text: "Make your account. It takes a minute." },
    { key: "start2", text: "Write your name, so your friends know who you are." },
    { key: "start3", text: "Press an empty seat to add a friend. Send a friend request, or share a link with them." },
    { key: "start4", text: "Your friend says yes, and a private room opens, just for the two of you. Say hi." },
  ];
}
