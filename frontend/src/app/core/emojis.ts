/** A group of emojis, named like the groups on a phone keyboard. */
export interface EmojiGroup {
  name: string;
  /** the emoji on the tab of the group */
  icon: string;
  emojis: string[];
}

/** The emojis offered in the message feed, in the usual groups (a message can also hold any emoji typed or pasted from the device's own keyboard). */
export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😜', '🤗', '🤔', '😐', '😏', '🙄', '😬', '😌', '😔', '😴', '🤒', '🤯', '🥳', '😎', '😮', '😳', '🥺', '😢', '😭', '😱', '😤', '😡', '🙈',
    ],
  },
  {
    name: 'People',
    icon: '👍',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤙', '👋', '🤝', '👏', '🙌', '🙏', '💪', '👀', '🤷', '🤦', '🙋',
    ],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💖', '💯', '💋',
    ],
  },
  {
    name: 'Animals',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐯', '🦁', '🐷', '🐸', '🐵', '🐧', '🦄', '🐝', '🦋', '🌹', '🌻', '🌈', '🌞', '⭐', '🔥',
    ],
  },
  {
    name: 'Food',
    icon: '🍎',
    emojis: [
      '🍎', '🍌', '🍉', '🍓', '🍒', '🥑', '🍞', '🧀', '🍔', '🍟', '🍕', '🌮', '🍣', '🍰', '🎂', '🍫', '🍦', '☕', '🍺', '🍷', '🥂',
    ],
  },
  {
    name: 'Activities',
    icon: '⚽',
    emojis: [
      '⚽', '🏀', '🎾', '🏃', '🚴', '🏆', '🥇', '🎮', '🎯', '🎵', '🎶', '🎤', '🎧', '🎬', '🎉', '🎊', '🎁', '🎈',
    ],
  },
  {
    name: 'Travel',
    icon: '🚗',
    emojis: [
      '🚗', '🚲', '🚂', '✈️', '🚀', '🚢', '🏠', '🏖️', '🏔️', '🌅', '🧳', '⛺', '🌍',
    ],
  },
  {
    name: 'Objects',
    icon: '💡',
    emojis: [
      '📱', '💻', '📷', '📞', '💡', '🔑', '🔒', '📚', '📝', '💰', '⏰', '📅', '✉️', '📦', '🔔',
    ],
  },
  {
    name: 'Symbols',
    icon: '✅',
    emojis: ['✅', '❌', '❓', '❗', '‼️', '⚠️', '➕', '➖', '✔️', '💤', '💬', '💭', '🔥', '✨', '⚡', '💥', '💫', '🎵', '♻️', '🆗', '🆒', '🔴', '🟡', '🟢', '🔵'],
  },
];
