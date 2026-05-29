// The curated war-table reaction set (D4). Six unicode emoji shared by the emoji
// picker (MessageActionsMenu) and the folded ReactionRow under each bubble. Kept
// in one place so the picker and the chips never drift.

export interface ReactionEmoji {
  // stable key for React lists and aria labels.
  key: string;
  // the unicode emoji posted as the kind=5 payload.
  emoji: string;
  // accessible name.
  name: string;
}

export const REACTION_EMOJI: ReactionEmoji[] = [
  { key: "thumbsup", emoji: "\u{1F44D}", name: "thumbs up" },
  { key: "heart", emoji: "❤️", name: "red heart" },
  { key: "fire", emoji: "\u{1F525}", name: "fire" },
  { key: "joy", emoji: "\u{1F602}", name: "face with tears of joy" },
  { key: "open_mouth", emoji: "\u{1F62E}", name: "face with open mouth" },
  { key: "cry", emoji: "\u{1F622}", name: "crying face" },
];
