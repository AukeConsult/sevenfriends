import { ChatItem } from './message-lock.service';

/**
 * The list of the feed with a message of mine that the server has already answered (an image, a video, a voice message sent from the card in the writing frame).
 * It goes last, and only once: when the feed already has it (a refresh was faster than the answer, or the live change arrived first) the list stays as it is.
 */
export function withSent(list: ChatItem[], item: ChatItem): ChatItem[] {
  return list.some((m) => m.id === item.id) ? list : [...list, item];
}
