import { BRAND, BRAND_CITY, BRAND_YEAR } from "./brand";

/**
 * ALL visible copy for the site.
 *
 * Two hard rules, enforced by scripts/audit-copy.mjs:
 *   1. No em dash and no en dash anywhere in visible copy.
 *   2. The product is never described as reading anything internal. The
 *      denial in the notMind block below is the only place such wording is
 *      allowed to appear at all, and there it is being refused.
 *
 * Copy is final as written in the build spec. Do not paraphrase it.
 */

export const announcement = {
  text: `Now taking waitlist applications for the first 500 units.`,
  cta: `Join the list`,
};

export const nav = {
  wordmark: BRAND,
  links: [
    { label: "Product", href: "#how-it-works" },
    { label: "Science", href: "#science" },
    { label: "About", href: "#problem" },
    { label: "Waitlist", href: "#waitlist" },
  ],
};

export const hero = {
  headlineLines: ["Earbuds that know", "who you are listening to"],
  /** One flowing sentence pair. Let it wrap; do not hardcode a break. */
  subhead:
    "Your brain already picks one voice out of a crowded room. Ours follows it, and captures what matters with a movement nobody sees.",
  cta: "Join the waitlist",
  interactionCaption: "Move your cursor to shift your attention",
  interactionCaptionTouch: "Drag to shift your attention",
  listenLabel: "Move to listen",
  unmute: "Enable sound",
  mute: "Mute",
  leftVoice: "Voice A",
  rightVoice: "Voice B",
};

/**
 * The pinned scene that follows the hero. Four beats of one continuous take.
 * This is the page's emotional centre: it is where the gesture channel stops
 * being a feature and becomes the reason the product exists.
 */
export const oneClench = {
  eyebrow: "One clench",
  beats: [
    "Someone says a date you need to remember.",
    "You do not reach for your phone.",
    "You clench your jaw once. Nobody at the table notices.",
    "It is in your calendar before they finish the sentence.",
  ],
  /** The confirmation that settles in on the last beat. Built in code. */
  card: {
    day: "Thursday 14 May",
    title: "Design review with Elif",
    time: "15:00",
  },
  videoAlt:
    "A person at a meeting table wearing the earbud, listening to a colleague and making one small jaw clench without breaking eye contact.",
  cardAlt: "A calendar entry for a design review with Elif on Thursday 14 May at 15:00.",
};

export const problem = {
  eyebrow: "The cocktail party problem",
  headlineLines: ["Two people talk at once.", "Your brain solves it. Your earbuds do not."],
  leadSentence:
    "When two voices compete, you lock onto the one you care about and push the other back.",
  leadRest: " This has been understood for seventy years.",
  paragraphs: [
    "Modern earbuds cannot do it. They boost whatever is loudest, or nearest, or in front of you. In a restaurant, in an open office, on a conference floor, that guess is wrong most of the time.",
    "Separating the voices was never the hard part. Knowing which one you wanted is.",
  ],
};

export const howItWorks = {
  eyebrow: "How it works",
  headlineLines: ["Three things happen", "in under two seconds"],
  steps: [
    {
      index: "01",
      title: "You listen",
      body: "When you attend to a voice, your auditory cortex tracks its rhythm more strongly than the voices you are ignoring. The sensors in the eartip pick up that difference.",
      media: "/media/step-01.webp",
      poster: null,
      alt: "A man with grey hair listening closely to someone off camera, wearing the earbud.",
    },
    {
      index: "02",
      title: "It follows",
      body: "The earbud identifies which stream you are on and brings it forward. The rest recede. You did not press anything and you did not turn your head.",
      media: null,
      poster: null,
      alt: "Diagram of two audio streams where the attended stream is brought forward and the other recedes.",
    },
    {
      index: "03",
      title: "You act on it",
      body: "This is the part that changes your day. Hear a date, a name, a task, a number. Clench your jaw once. The assistant already knows which conversation you were in, so it knows what you meant. The thing gets captured, filed, and handed back to you when you need it.",
      media: null,
      poster: null,
      alt: "A date, a name, a task and a number being captured from a conversation and filed where each one belongs.",
    },
  ],
};

/**
 * The largest section on the page, and the argument the whole product rests on.
 * Three subsections: the vocabulary, why three gestures are enough, and what
 * happens to what you capture.
 */
/**
 * The scrubbed turntable between how it works and the argument for it. The
 * rotation reveals the contact rings on the eartip, so the copy is about why
 * the sensor is there and not somewhere more obvious.
 *
 * Deliberately says nothing about how many sensors there are. The science
 * section states the design target, and two visible rings is not the same
 * claim, so this block stays away from counting.
 */
export const eartip = {
  eyebrow: "The eartip",
  headlineLines: ["The sensor is the part", "you already put in your ear"],
  paragraphs: [
    "The contact rings sit flush in the silicone. Nothing clips on, nothing rests against your scalp, and nothing about it reads as equipment.",
    "The ear is the only place on the body worn all day, millimetres from the auditory cortex, that nobody looks at twice.",
  ],
  figureAlt:
    "An earbud rotating slowly to reveal the two concentric contact rings set into its eartip.",
};

export const thePoint = {
  eyebrow: "The point",
  headlineLines: ["Every assistant needs you to", "stop what you are doing"],
  paragraphs: [
    "Talking to an assistant in public does not work. Typing means leaving the conversation. That is why the most capable AI ever built sits unused in your pocket during exactly the moments you could use it.",
    "A single jaw clench is invisible and unambiguous. It takes no hands, no screen, and no pause in what you were doing.",
  ],

  /** Subsection A. Three gestures, each with its resulting action. */
  vocabularyHeading: "The vocabulary",
  vocabulary: [
    {
      label: "Single",
      title: "Capture this",
      body: "Marks the last thirty seconds. Dates go to your calendar, names go to your contacts, tasks go to your list.",
    },
    {
      label: "Double",
      title: "Undo that",
      body: "Wrong moment, wrong thing. Take it back without opening anything.",
    },
    {
      label: "Hold",
      title: "Ask something",
      body: "Open a question to the assistant, answered in your ear, still without speaking.",
    },
  ],

  /** Subsection B. Why the vocabulary does not need to be any larger. */
  context: {
    headlineLines: [
      "Three gestures cover everything",
      "because it knows where you are",
    ],
    body: "The same double clench means skip while you are listening to music and take that back while you are listening to a person. Attention supplies the context, so the gesture does not have to carry it. This is why we do not need a menu, a wake word, or a vocabulary you have to memorise.",
  },

  /** Subsection C. Where a captured thing actually ends up. */
  destinationsHeading: "Where it goes",
  destinations: [
    { label: "A date", body: "Goes to your calendar with the context around it" },
    { label: "A name", body: "Goes to your contacts with where you met" },
    { label: "A task", body: "Goes to your list in the words they used" },
    { label: "A number", body: "Goes to your notes with what it referred to" },
  ],
};

export const useCases = {
  eyebrow: "Where it earns its place",
  headline: "Four rooms your earbuds get wrong",
  cards: [
    {
      kicker: "The meeting",
      title: "Follow one person, keep every action item",
      body: "Six people, one table. Their voice stays forward, and everything assigned to you is on your list before you stand up.",
      image: "/media/card-1.webp",
      alt: "A woman at an office meeting table listening across it, wearing the earbud, her pen resting untouched.",
    },
    {
      kicker: "The restaurant",
      title: "Hear the person across from you",
      body: "The hardest listening environment there is, and the one every pair of earbuds fails in.",
      image: "/media/card-2.webp",
      alt: "Two people talking at a small table in a busy warm lit restaurant in the evening.",
    },
    {
      kicker: "The handover",
      title: "Capture a number without breaking eye contact",
      body: "An address, a flight time, a dosage, a part number. One clench and it is written down correctly.",
      image: "/media/card-3.webp",
      alt: "Two people talking across a workshop counter, the listener wearing the earbud with their hands empty on the counter.",
    },
    {
      kicker: "The race",
      title: "Take a call at kilometre thirty",
      body: "Sweat, wind, breathing hard. It stays in and it stays working.",
      image: "/media/card-4.webp",
      alt: "An endurance athlete running on a coastal road during a race in bright midday sun.",
    },
  ],
  expand: "Read more",
  collapse: "Close",
  prev: "Previous use case",
  next: "Next use case",
};

export const notMind = {
  eyebrow: "Plainly",
  headline: "It does not read your mind",
  paragraphs: [
    "It cannot, and neither can anything else you can wear without surgery. Two things go into this device. Which sound you are attending to, and a small movement you make on purpose. Nothing you think is measured, transmitted, or stored.",
    "It is also not a hearing aid, and we make no medical claims about it.",
    "We would rather tell you this on the first page than have you find out later.",
  ],
};

export const science = {
  eyebrow: "The science",
  headlineLines: ["Fifteen years of published work,", "finally small enough to wear"],
  paragraphs: [
    "Auditory attention decoding is an established research field. The open questions were never whether the signal exists. They were signal quality in a device this small, decision speed, and how much calibration each person needs.",
    "That is what we work on.",
  ],
  stats: [
    {
      value: "~83%",
      body: "Attention decoding accuracy reported in laboratory conditions using full scalp sensors",
      /** Guards against this being shortened into a product claim. Spec 3.9. */
      qualifier: "Published laboratory reference, not a Signalive product measurement",
    },
    {
      value: "<2 sec",
      body: "The decision window a wearable product has to work within",
      qualifier: "Design target",
    },
    {
      value: "4",
      body: "Sensors per ear our design targets",
      qualifier: "Design target",
    },
  ],
  figureCaption: "Two competing talkers, one attended stream, decoded inside a two second window.",
};

export const waitlist = {
  headline: "The first five hundred",
  body: "We are building a small first run for people who spend their day in noise. Tell us where you spend yours.",
  emailLabel: "Email address",
  emailPlaceholder: "you@example.com",
  contextLabel: "Where do you struggle to hear?",
  contextOptions: [
    "Meetings",
    "Restaurants",
    "Open office",
    "Learning a language",
    "Training and racing",
    "Other",
  ],
  submit: "Join the waitlist",
  submitting: "Joining",
  footnote: "No spam. One email when units are ready.",
  successHeading: "You are on the list",
  successBody:
    "We will write to you once, when the first units are ready. Nothing before that.",
  errors: {
    email: "Enter an email address we can reach you at.",
    context: "Pick the place you struggle with most.",
    server: "That did not go through. Try again in a moment.",
  },
};

export const footer = {
  wordmark: BRAND,
  positioning: "Attention as an input. Starting at the ear.",
  columns: [
    {
      heading: "Product",
      links: [
        { label: "One clench", href: "#one-clench" },
        { label: "How it works", href: "#how-it-works" },
        { label: "The point", href: "#the-point" },
        { label: "Use cases", href: "#use-cases" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "The science", href: "#science" },
        { label: "What it is not", href: "#plainly" },
        { label: "Waitlist", href: "#waitlist" },
      ],
    },
  ],
  finePrint: [
    `${BRAND} is a general wellness product. It is not a medical device. It is not intended to diagnose, treat, cure, or prevent any disease, and it is not a substitute for a hearing aid or for professional medical advice.`,
    "Attention decoding performance varies between individuals and environments.",
  ],
  legal: `(c) ${BRAND_YEAR} ${BRAND}. ${BRAND_CITY}.`,
};

export const stickyCta = {
  label: "Join the waitlist",
};

export const meta = {
  title: `${BRAND}. Earbuds that know who you are listening to.`,
  description:
    "Earbuds that follow the voice you are listening to and capture what matters with a single jaw clench. No screen, no wake word, no pause in the conversation.",
};

export const a11y = {
  skipToContent: "Skip to main content",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  dismissAnnouncement: "Dismiss announcement",
  heroVideoAlt:
    "Extreme macro view of the earbud surface, with a soft highlight travelling along its titanium ring.",
};
