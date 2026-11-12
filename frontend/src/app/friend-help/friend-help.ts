import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, output } from '@angular/core';

/** The help under the header of the conversation (the ? in the header opens it, see the expanding frame in `chat.html`): what the icons in the header do, the safebox, and the messages. */
@Component({
  selector: 'app-feed-help',
  imports: [TranslocoDirective],
  templateUrl: './friend-help.html',
  providers: [provideTranslocoScope('friendHelp')],
})
export class FeedHelp {
  /** the button at the end: hide the help */
  readonly closed = output<void>();
  /** the sections: the key of the title, its English title, and the rows (key, picture, English title, English text); the words come from friendHelp.json */
  protected readonly sections = [
    {
      key: "headerTitle",
      title: "The header",
      rows: [
        { key: "picture", icon: "person", title: "Picture, dot and mood", text: "Tap the picture to see the profile of your friend. The small dot shows if your friend is active now, away or offline. The small face shows the mood your friend has set." },
        { key: "send", icon: "send", title: "Send", text: "Write a new message. You can add emojis, pictures, videos and voice messages, and tap a ready-made message to send it." },
        { key: "messages", icon: "messages", title: "Messages", text: "The conversation with your friend. A small dot shows here when there is a new message." },
        { key: "safebox", icon: "safebox", title: "Safebox", text: "The box you share with this friend. See \"The safebox\" below." },
        { key: "helpIcon", icon: "help", title: "Help", text: "Shows or hides this help." },
        { key: "more", icon: "more", title: "More", text: "Show the newest or the oldest messages first. Clean up: delete many messages at once. The tools of the page you are on. The padlock: Locked means new messages and files are locked, and a tap switches it. The other pages of your friend: profile, locking and keys, recovery." },
      ],
    },
    {
      key: "safeboxTitle",
      title: "The safebox",
      rows: [
        { key: "boxWhat", icon: "box", title: "What it is", text: "A box that belongs to you and this friend (or this group) together. It is for the things you want to keep and find again later, so they do not get lost in the conversation." },
        { key: "boxWho", icon: "people", title: "Who can use it", text: "Only the people in the conversation. Each of you can add things, open them, give them a new name and take them out. Every friend and every group has its own box." },
        { key: "boxWhat2", icon: "folder", title: "What goes in", text: "Pictures, videos, voice messages and files. Also notes: secrets, dates, tickets, places, contacts, links and checklists." },
        { key: "boxOrder", icon: "box", title: "Changing the order", text: "In the list, press and drag ⠿ to move an item. In the picture view, press and hold an item, then drag it to a new place." },
        { key: "boxMove", icon: "image", title: "From the conversation", text: "Tap a picture or video in the conversation and choose \"To the safebox\". It moves into the box and leaves the conversation, for both of you." },
        { key: "boxNews", icon: "news", title: "You are told", text: "When someone adds something, a message \"In the safebox\" appears in the conversation, so nobody misses it." },
        { key: "boxLock", icon: "lock", title: "Locked", text: "When you both have a lock key, everything in the box is locked on your devices, so not even we can read it." },
      ],
    },
    {
      key: "feedTitle",
      title: "The messages",
      rows: [
        { key: "sides", icon: "messages", title: "Who wrote what", text: "Your messages are on the right and your friend's messages are on the left. The time under a message shows when it was sent." },
        { key: "pictures", icon: "image", title: "Pictures and videos", text: "Tap a picture to open it in full size. There you can zoom in, download it and give it a new name. A video can be played in the feed or opened in full." },
        { key: "own", icon: "pencil", title: "Change or delete", text: "Tap one of your own messages to edit it, copy it or delete it. A deleted message disappears for both of you." },
        { key: "hide", icon: "eye", title: "Hide", text: "You can hide a picture or video in your feed and show it again." },
      ],
    },
  ];
}
