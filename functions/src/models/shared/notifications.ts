import { FriendRequest } from "./friend";
import { Message } from "./message";

/** What the Home check returns: invitations that reached me and my unread messages. */
export interface CheckResult {
  requests: FriendRequest[];
  messages: Message[];
}
