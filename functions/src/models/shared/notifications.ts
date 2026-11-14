import { Circle } from "./circle";
import { Friend, FriendRequest } from "./friend";
import { Message } from "./message";
import { ProfileDetails } from "./profile";

/** What the Home check returns: invitations that reached me and my unread messages. */
export interface CheckResult {
  requests: FriendRequest[];
  messages: Message[];
}

/** Everything Home shows, in ONE answer (`POST /home`), so the page is complete when it first draws and does not change while it loads. */
export interface HomeResult extends CheckResult {
  /** the circle the app is in (made when it did not exist yet) */
  circle: Circle;
  /** the friends of that circle, as the Friends page lists them */
  friends: Friend[];
  /** my own details (Home warns when none of my email or phone is verified) */
  profile: ProfileDetails;
}
