import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
  imports: [Inviter, RouterLink, SeatDots, WhyTiles, TranslocoDirective],
  templateUrl: './welcome.html',
  providers: [provideTranslocoScope('welcome')],
})
export class Welcome {
  private readonly welcome = inject(WelcomeService);
  private readonly router = inject(Router);
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
    if (pages && !this.auth.user()) void this.router.navigateByUrl(pages[Math.floor(Math.random() * pages.length)], { replaceUrl: true });
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
    { key: "what", icon: "👋", title: "What is Seven Friends?", text: "It is an app for talking to the few people you care about most. Think of a small table with seven chairs. You choose who sits there. Nobody else gets in." },
    { key: "seats", icon: "🪑", title: "Seven seats", text: "Each friend takes one seat. When all seven are taken, you free a seat before you add someone new. This keeps your circle small and close. Work, buddies and family can each have their own circle with their own seven seats." },
    { key: "send", icon: "💬", title: "Share anything with your friends", text: "Send text, pictures, videos and voice messages. Open a friend and write in the box at the bottom, like a normal chat." },
    { key: "safebox", icon: "📦", title: "A shared safebox for each friend and group", text: "Each friend and each small group has a safebox that only the people in it share. Everyone in it can add, open and take out things: pictures, videos, files, notes, secrets, dates, tickets, places, contacts and checklists. A new item shows up in your chat. Everything is locked on your device, so not even we can read it." },
    { key: "lock", icon: "🔒", title: "Fully locked and secured", text: "Everything you send is locked on your own phone or computer before it leaves it. Think of a letter in a box with a padlock. Only you and your friend have the key. Our server only sees scrambled nonsense and has no key, so it cannot open your messages. Nobody who broke into it could either." },
    { key: "lockWhat", icon: "🔑", title: "What is locked?", text: "The text you write, and also every picture, video and voice message. Safebox items are locked the same way. Each friend, and each small group, has its own locked room." },
    { key: "calm", icon: "🌙", title: "Calm, but you can still reach people", text: "No big feed, no strangers and no advertisements. If something cannot wait, send a ping. If you need a break from someone, put them on your sleep list: you stay friends, but you stop hearing from them until you wake them up again." },
    { key: "free", icon: "🎁", title: "Is it free?", text: "Yes. There is nothing to pay, there are no advertisements, and your information is not sold." },
  ];
  protected readonly steps = [
    { key: "start1", text: "Make your account. It takes a minute." },
    { key: "start2", text: "Write your name, so your friends know who you are." },
    { key: "start3", text: "Press an empty seat to add a friend. Send a friend request, or share a link with them." },
    { key: "start4", text: "When your friend says yes, you are friends in the app. Now you can write to each other." },
  ];
}
