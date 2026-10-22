/**
 * The Focus room's three monologues: the web trial's English ones
 * (trial/lib/shared/focus.ts), with the voice and speaking style each is
 * read in. Shared by focus_voices.mjs, which records them, and
 * focus_words.mjs, which times every word of the recordings.
 */
export const MONOLOGUES = [
  {
    file: "emma",
    voice: "coral",
    style: "Warm and lively, telling a close friend about a trip, smiling as she talks.",
    text: "You won't believe it, we were up at four in the morning in Cappadocia. The van picked us up at a quarter to five, and our guide, Hasan, was the sweetest man. The balloon lifted off at exactly six thirty, and as the sun came up behind Uçhisar about a hundred balloons rose at once. They said we got to a thousand meters, I couldn't even look down. When we landed, the pilot opened champagne for everyone and handed out medals, can you imagine, medals! Next time I'm definitely going in October, the weather was perfect. You'll come too, right? This time let's hike Pigeon Valley as well.",
  },
  {
    file: "daniel",
    voice: "onyx",
    style: "Confident and quick, pitching an idea to a friend with real enthusiasm.",
    text: "So here's the idea: you clip a tiny sensor onto your plant pot, and when the soil dries out, your phone gets a notification. That simple. But here's the real thing, the sensor knows the plant, so you don't water basil like a cactus. Twelve hundred people downloaded it in the first month, without a single ad. We're thinking four ninety-nine a month, and the first sensor is free. Next Tuesday I'm meeting an investor, she gave us forty minutes. Before that we need to go through the deck once more, especially the numbers. If we finish the demo video by Thursday, that would be great.",
  },
  {
    file: "barista",
    voice: "verse",
    style: "An upbeat café barista calling out finished orders across a busy counter, loud and friendly.",
    text: "Selin, oat milk latte! Two americanos, one iced, whose was that? Kevin, your filter coffee's on the counter. And a caramel frappé, with the extra syrup you asked for. Folks, croissants are out of the oven in five minutes, almond ones too. If you're paying by card, pick up on this side, please. Ellie, hot chocolate, I put cinnamon on top! Double espresso, no sugar, by the register. One medium chai tea latte, for Ben. Thanks, have a good one!",
  },
];
