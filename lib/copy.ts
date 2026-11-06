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
 *
 * The evidence pass (branch "evidence", November 2026) changes the lines the
 * research contradicts, and only those: the two second claim, the contacts in
 * the eartip, and the single clench as the capture. Each change names its
 * measurement in research/ or hardware/SPEC.md.
 */

export const announcement = {
  text: `Now taking waitlist applications for the first 500 units.`,
  cta: `Join the list`,
};

export const nav = {
  wordmark: BRAND,
  links: [
    { label: "Product", href: "#how-it-works" },
    { label: "Features", href: "/features" },
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
 * The room at the top of the page: three people talking at once around a
 * listener, and the one the listener turns to comes forward. The pointer, a
 * drag or the arrow keys stand in for turning; J or the button stands in for
 * the clench, which plays back the last ten seconds of the person faced, in
 * their own voice, with their words on screen. The words come with the
 * recordings (public/media/focus/words.json), like captions.
 */
export const focusRoom = {
  label:
    "Three people talking around you. Move the pointer across the room, drag, or use the arrow keys to turn toward one of them, then clench to hear their last 10 seconds again.",
  speakers: [
    { name: "Emma", topic: "A trip to Cappadocia" },
    { name: "Daniel", topic: "A startup idea" },
    { name: "Barista", topic: "Orders up" },
  ],
  forward: "Forward",
  replaying: "Replaying",
  turnTo: "Turn to",
  clench: "Clench to replay",
  clenchHint: "J or this button stands in for the clench: it plays back the last 10 seconds of the person you face.",
  clenchHintTouch: "This button stands in for the clench: it plays back the last 10 seconds of the person you face.",
  loading: "Loading voices",
  soundError: "Sound could not start. Tap to try again.",
  replayHeading: "Last 10 seconds",
  close: "Close",
  aiVoices: "Voices are AI generated.",
};

/**
 * The pinned scene that follows the hero. Four beats of one continuous take.
 * This is the page's emotional centre: it is where the gesture channel stops
 * being a feature and becomes the reason the product exists.
 */
export const oneClench = {
  eyebrow: "A double clench",
  beats: [
    "Someone says a date you need to remember.",
    "You do not reach for your phone.",
    "You clench your jaw twice. Nobody at the table notices.",
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
    "Modern earbuds cannot do it. They boost whatever is loudest, or nearest, or in front of you, and they let go the moment you look away. In a restaurant, in an open office, on a conference floor, you look away all the time.",
    "Separating the voices was never the hard part. Knowing which one you wanted is.",
  ],
};

export const howItWorks = {
  eyebrow: "How it works",
  /** Labels for the filing figure under step 03. Not a section of their own. */
  destinations: [
    { label: "A date", body: "Goes to your calendar with the context around it" },
    { label: "A name", body: "Goes to your contacts with where you met" },
    { label: "A task", body: "Goes to your list in the words they used" },
    { label: "A number", body: "Goes to your notes with what it referred to" },
  ],
  headlineLines: ["Three signals,", "each at its own speed"],
  steps: [
    {
      index: "01",
      title: "You turn",
      body: "Turn toward someone and their voice comes forward within a fraction of a second. The motion sensor in each earbud knows where you face, so this part never waits for anything else.",
      media: "/media/step-01.webp",
      poster: null,
      alt: "A man with grey hair listening closely to someone off camera, wearing the earbud.",
    },
    {
      index: "02",
      title: "It holds",
      body: "Look down at your plate, your phone, the person beside you. When you follow a voice, your auditory cortex tracks its rhythm more strongly than the others, and contacts around your ear pick up that difference. Over a minute or two they settle on the voice you keep coming back to, and it stays forward while you look away.",
      media: null,
      poster: null,
      alt: "Diagram of two audio streams where the attended stream is brought forward and the other recedes.",
    },
    {
      index: "03",
      title: "You act on it",
      body: "This is the part that changes your day. Hear a date, a name, a task, a number. Clench your jaw twice. The assistant already knows which conversation you were in, so it knows what you meant. The thing gets captured, filed, and handed back to you when you need it.",
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

/**
 * Where the contacts go. Takes the place of the eartip rotation: Ear-SAAD
 * recorded 15 people in the ear canal and around the ear at the same moments,
 * and calibration free, with each ear referenced to itself, the canal
 * contacts decoded at chance (research/ext/README.md). HW-EEG-02.
 */
export const whereSignal = {
  eyebrow: "Around the ear",
  headlineLines: ["The signal is around your ear,", "not inside it"],
  paragraphs: [
    "Before building anything, we asked where an earbud's contacts have to sit. On public recordings of 15 people, made in the ear canal and around the ear at the same moments, the contacts in the canal named the voice a person followed no more often than a coin flip. The ones around the ear did.",
    "So ours reach around the ear: four contacts per ear on a slim arc that rests behind it. The same contacts feel the clench, which is strongest there too.",
  ],
  figureAlt:
    "Side view of an ear wearing the earbud, with a slim dark arc running over the top of the ear and resting behind it.",
  figureCaption: "Concept render, not a product photograph.",
  stats: [
    {
      value: "48%",
      body: "In the ear canal: one minute decisions on people the decoder never saw. A coin flip is 50%.",
      qualifier: "Public research recordings of 15 people, not a Signalive product measurement",
    },
    {
      value: "61%",
      body: "Around the ear: the same people, at the same moments, by the same decoder",
      qualifier: "Public research recordings of 15 people, not a Signalive product measurement",
    },
    {
      value: "77%",
      body: "Around the ear, eight contacts, on 36 other people with no calibration",
      qualifier: "Public research recordings of 36 people, not a Signalive product measurement",
    },
  ],
  researchLink: "How we measured it, in research note 01",
};

export const thePoint = {
  eyebrow: "The point",
  headlineLines: ["Every assistant needs you to", "stop what you are doing"],
  paragraphs: [
    "Talking to an assistant in public does not work. Typing means leaving the conversation. That is why the most capable AI ever built sits unused in your pocket during exactly the moments you could use it.",
    "A double jaw clench is invisible, and it almost never happens by accident. It takes no hands, no screen, and no pause in what you were doing.",
  ],

  /** Subsection A. Three gestures, each with its resulting action. */
  vocabularyHeading: "The vocabulary",
  vocabulary: [
    {
      label: "Single",
      title: "Replay that",
      body: "Plays back the last ten seconds of the person you face. The thing you missed, again, without asking them to repeat it.",
    },
    {
      label: "Double",
      title: "Keep this",
      body: "Marks the last thirty seconds. Dates go to your calendar, names go to your contacts, tasks go to your list.",
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
    body: "The same double clench keeps the moment while you are listening to a person and skips the track while you are listening to music. Attention supplies the context, so the gesture does not have to carry it. This is why we do not need a menu, a wake word, or a vocabulary you have to memorise.",
  },

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
    "We measured all three on public recordings before building anything: eight contacts around the ears are enough, no calibration is needed, and a decision takes about a minute. So a turn of the head steers, and the contacts hold.",
  ],
  stats: [
    {
      value: "77%",
      body: "Of one minute decisions name the voice a person follows, from eight contacts around the ears, on people our decoder never saw",
      /** Guards against this being shortened into a product claim. Spec 3.9. */
      qualifier: "Public research recordings of 36 people, not a Signalive product measurement",
    },
    {
      value: "~1 min",
      body: "What a decision takes. A turn of the head steers at once; the contacts hold the choice while you look away",
      qualifier: "Measured on the same recordings",
    },
    {
      value: "4",
      body: "Contacts per ear our design targets, around the ear rather than in the canal",
      qualifier: "Design target",
    },
  ],
  figureCaption: "Two competing talkers, one followed voice, named from a minute of signal.",
  /** Leads to /research, where the decoder runs on public recordings. */
  researchLink: "We ran our decoder on 36 people's ear EEG. Read research note 01",
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
        { label: "Try the features", href: "/features" },
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

/**
 * /features. What the web trial lets anyone try today, with the earbuds they
 * already own. Every item says what in the trial stands in for the hardware,
 * so nothing on that page reads as a measurement of the product. The gesture
 * channel comes first, as on the home page.
 */
export const features = {
  meta: {
    title: `${BRAND} features. What it already does with the earbuds you own.`,
    description:
      "Rewind, Focus, a voice assistant, notes and a whisper lab, already running in a browser with any earbuds while the hardware is on its way. Join the waitlist on the page.",
  },
  eyebrow: "The web trial",
  /** While the trial is not public: what it does, and the waitlist right here. */
  headlineLines: ["Five things it does today,", "with the earbuds you own"],
  lead: "The earbuds are not shipping yet. The software already runs in a browser, with any pair of earbuds. Here is what it does. Join the waitlist below and be first in line.",
  /** Once the trial is public. */
  headlineLinesOpen: ["Try it today,", "with the earbuds you own"],
  leadOpen:
    "The earbuds are not shipping yet. The software is. Open the trial in a browser, put in any pair of earbuds, and try the five things it already does.",
  openTrial: "Open the trial",
  joinWaitlist: "Join the waitlist",
  inTheTrial: "In the trial",
  tryPrefix: "Try",
  indexLabel: "On this page",
  channels: [
    {
      id: "rewind",
      index: "01",
      kind: "Gesture",
      name: "Rewind",
      headlineLines: ["Clench,", "and hear it again"],
      body: [
        "Missed what was just said? The last thirty seconds stay in memory on your device, overwritten as they go.",
        "One clench plays the moment back in your ear, then tells you in a sentence what was said.",
      ],
      note: "A button or the J key stands in for the clench. The seconds you rewind are sent once, to be transcribed and summed up, and they are not kept.",
      path: "/rewind",
      figureLabel:
        "The last thirty seconds as a line of speech over a timeline. The latest seconds are marked, and a playhead runs back to where they start, then forward again.",
      ago: "30 s ago",
      now: "Now",
      recapLabel: "What was said",
      recap: "Someone asked if the review can move to Friday at three.",
    },
    {
      id: "focus",
      index: "02",
      kind: "Attention",
      name: "Focus",
      headlineLines: ["Turn to a voice,", "and it comes forward"],
      body: [
        "Three people talk at once around you. The one you turn to comes forward and the others step back.",
        "Clench to hold on to that voice wherever you look, and ask what anyone said, even the voice you were not following.",
      ],
      note: "Your head direction, read by the camera on your own device, stands in for the earbud's attention signal. The three voices are separate recordings placed around you.",
      path: "/focus",
      figureLabel: "Three voices drawn as traces. One at a time comes forward while the other two recede.",
      voices: ["Emma", "Daniel", "Barista"],
    },
  ],
  moreEyebrow: "And three more",
  moreHeadlineLines: ["Everything else", "it already does"],
  more: [
    {
      id: "assistant",
      index: "03",
      name: "Assistant",
      title: "Ask out loud, or in a whisper",
      body: "Hold to talk, or leave it listening. Answers come back in your ear a sentence at a time, in Turkish or English, and can draw on your own notes. Whisper mode keeps them short and quiet.",
      note: "Every stage is timed, so you can see how long the first word takes on your earbuds.",
      path: "/assistant",
      figureLabel: "A spoken question, then the answer coming back one sentence at a time.",
    },
    {
      id: "notes",
      index: "04",
      name: "Notes",
      title: "Talk, and it becomes notes",
      body: "Record a meeting and it turns into notes: a summary, action items, topics and the people mentioned. Mark the moment that matters with a double clench, then search by the words or by what they meant.",
      note: "An earbud double tap or the K key stands in for the double clench. Raw audio is kept only if you choose to keep it.",
      path: "/recorder",
      figureLabel: "Lines of a transcript with one moment marked, turning into a note with action items.",
    },
    {
      id: "lab",
      index: "05",
      name: "Lab",
      title: "Measured, not promised",
      body: "Read short phrases in a whisper, in wind, on a street or in a cafe. Each take runs through four processing chains and is scored by word error rate, with confidence intervals and a CSV you can check.",
      note: "The numbers describe your device and your room. They are not a claim about the earbuds.",
      path: "/lab",
      figureLabel: "Error rates for four processing chains, each with its confidence interval.",
    },
  ],
  privacyEyebrow: "Privacy",
  privacyHeadlineLines: ["What leaves", "your device"],
  privacy: [
    {
      label: "Audio",
      body: "The microphone stays in the browser until you start something: a question, a rewind, a recording or a lab take. Raw audio is kept only if you opt in, and then it expires.",
    },
    {
      label: "Camera",
      body: "Used only by Focus, and only after you choose it. Frames become a head direction on your device and go nowhere else.",
    },
    {
      label: "Everything else",
      body: "Export all of it whenever you like, or delete all of it. Deleting removes your notes, transcripts and any stored audio.",
    },
  ],
  closingLines: ["The earbuds come later.", "You can start today."],
};

/**
 * /research. The decoder run on public ear EEG from 36 people, what it can
 * tell, how fast, and what that decides about the earbuds. Every number on the
 * page comes from public/research/results.json, written by research/aad; the
 * copy carries words only, and "{n}" marks where a number is filled in.
 *
 * These are published research recordings, so nothing here may read as a
 * Signalive product measurement, and the limits section says so in plain words.
 */
export const research = {
  meta: {
    title: `${BRAND} research. 36 people, two stories, one question for the earbuds.`,
    description:
      "We ran our decoding pipeline on public EEG recorded around the ears of 36 people listening to two stories at once: what it can tell, how fast, with how many electrodes, and what that decides about the earbuds.",
    ogAlt: "Research note 01: 79% of one minute decisions name the followed story with the learned decoder, 1.6 points lost without a wire between the ears, no calibration.",
  },
  eyebrow: "Research note 01",
  date: "November 2026",
  headlineLines: ["We ran the decoder on", "36 people's ear EEG"],
  lead: "The questions the earbuds depend on can be asked of real recordings before a single earbud exists. Electrodes around the ear, two stories at once, and the same code the earbuds will run.",
  stats: {
    accuracy: {
      label: "of one minute decisions name the story a person was following",
      sub: "The learned decoder, four electrodes per ear, two separate earbuds, no calibration. The linear one: {n}. A coin flip scores 50%.",
    },
    wireless: {
      label: "lost by cutting the wire between the ears",
      sub: "Each earbud referenced to itself, against one reference shared across the head.",
    },
    calibration: {
      label: "minutes of calibration needed",
      sub: "A decoder trained on 35 other people matches one trained on 20 minutes of a person's own data.",
    },
    speed: {
      label: "for the EEG alone to follow a switch of attention",
      sub: "Median expected switch duration with the learned decoder; {n} s with the linear one. Enough to confirm, too slow to steer. So the head steers.",
    },
  },
  points: "points",
  minutes: "min",
  seconds: "s",

  replay: {
    eyebrow: "Live, in your browser",
    headlineLines: ["Watch it decide"],
    body: "A real recording: three minutes of EEG from electrodes around one person's ears while two stories played, one on each side. Your browser runs it through the earbud pipeline, filtering, resampling and decoding, with the linear decoder trained on the other 35 people that has never seen this one.",
    pick: "Whose recording",
    people: {
      clearest: "Clearest of 36",
      typical: "Typical",
      hardest: "Hardest of 36",
    },
    personNote: "{n}% of one minute decisions right over all 30 minutes",
    play: "Play",
    pause: "Pause",
    restart: "Start over",
    speed: "Speed",
    followed: "Story they followed",
    other: "Other story",
    recon: "Rebuilt from their EEG",
    laneLeft: "Left",
    laneRight: "Right",
    eegLane: "EEG",
    pending: "Waiting for 10 seconds of story",
    verdictLabel: "Last 10 seconds point to",
    truthLabel: "They were told to follow",
    leftStory: "The left story",
    rightStory: "The right story",
    tally: "{n} of {m} verdicts right",
    warming: "Settling the filters",
    elapsed: "Recording time",
    timelineLabel: "All 30 minutes of this person, one mark per minute",
    timelineRight: "Right",
    timelineWrong: "Wrong",
    loading: "Loading the recording",
    error: "The recording could not load. Reload to try again.",
    noAudio: "No sound: the data set keeps how loud each story was from moment to moment, not the stories themselves.",
    canvasLabel: "The two stories' loudness over time and the version rebuilt from EEG, scrolling as the recording plays.",
  },

  findingsEyebrow: "What the recordings say",
  findings: {
    window: {
      index: "01",
      headlineLines: ["Longer windows,", "clearer answers"],
      body: "How often a decision names the followed story, by how much EEG it may use, from one second to ten minutes. Four electrodes per ear on two separate earbuds, against all eighteen around both ears on a wire, and one earbud alone. Over five minutes, the two earbuds get it right {n} of the time.",
      chartLabel: "Share of decisions right by decision window, 36 people, decoders that never saw the person",
      x: "Decision window, seconds",
      series: {
        wireless: "4 per ear, wireless",
        wired: "All 18, wired",
        one: "One earbud, 4",
      },
      chance: "Chance for one person",
    },
    electrodes: {
      index: "02",
      headlineLines: ["A few electrodes", "go most of the way"],
      body: "One minute decisions on two separate earbuds, by electrodes per ear, each ear referenced to its own. Two per ear already reach {n}. Every electrode around both ears adds about {m} points, less than the spread between people.",
      chartLabel: "Share of one minute decisions right by electrodes per ear, wireless, 36 people",
      x: "Electrodes per ear",
      all: "All",
      mapLabel: "Where the four sit",
      mapNote: "Positions on a cEEGrid, the arc of electrodes around each ear used in the recordings, seen from the side with the face toward the outer edge. Filled: the four per ear the decoder leaned on most.",
      left: "Left ear",
      right: "Right ear",
    },
    calibration: {
      index: "03",
      headlineLines: ["No calibration", "to start"],
      body: "One minute decisions by how much of a person's own data trained the decoder. A few minutes of it does worse than a decoder trained on other people, which needs none, and 20 minutes only edges past it.",
      chartLabel: "Share of one minute decisions right by minutes of the person's own data, 4 per ear, wireless",
      x: "Minutes of the person's own data",
      personal: "Trained on their data only",
      generic: "Trained on 35 other people, none of theirs",
    },
    people: {
      index: "04",
      headlineLines: ["Most people,", "not everyone"],
      body: "One dot per person, one minute decisions over 30 minutes, 4 per ear, wireless, no calibration. {n} of 36 clear the bar a single person needs to beat chance, and {m} sit at or below a coin flip.",
      chartLabel: "Share of one minute decisions right per person",
      bar: "Beats chance for one person",
      ringed: "Ringed: the three recordings in the replay",
    },
    learned: {
      index: "05",
      headlineLines: ["A learned decoder,", "the same 36 people"],
      body: "The linear decoder rebuilds a story's loudness from the EEG through one fixed filter. The learned one trains two small networks together, one reading the electrodes and one reading each story, until the EEG's reading moves with the followed story's. Trained only on other people, scaled from the wearer's first two minutes, each window judged on its own samples. One minute decisions go from {n} to {m}.",
      check: "The check: the same stories, played out of step with the EEG. A network that had learned to tell the two voices apart and read something else in the EEG, such as where the eyes were turned, would keep scoring. This one falls to {n}, a coin flip, so what it follows is the speech.",
      splits: "Three different splits of the 36 people into training and testing, five networks each, trained on every recorded block and chosen on validation people alone: one minute decisions from {n} to {m} per split.",
      chartLabel: "Share of decisions right by decision window, 36 people, the learned and the linear decoder on people they never saw, and the learned one with the stories out of step",
      series: {
        learned: "Learned decoder",
        linear: "Linear decoder",
        control: "Learned, stories out of step",
      },
      scaling: {
        title: "Trained on more people",
        chartLabel: "One minute decisions right by how many people the decoder was trained on: the learned decoder and the linear one",
        people: "{n} people",
        series: {
          learned: "Learned,",
          learnedNote: "one network per fold",
          linear: "Linear,",
          linearNote: "{n} trained on all 35",
        },
        decides: "The linear decoder stops improving at about fifteen people. The learned one was still climbing at twenty five, the most a fold could train on: every person it learns from makes it better for the next one.",
      },
    },
    trust: {
      index: "06",
      headlineLines: ["What a decision", "is worth"],
      body: "On the phone, a ten second decision moves the estimate of who is being listened to by how clearly it was won. How far was set by hand. Measured on people the decoders never saw, it was three times too far for the linear decoder: when the fusion was {n} sure, those decisions were right {m} of the time. Each decoder now ships with the weight its decisions earned, so a decision moves the estimate exactly as far as it deserves.",
      chartLabel: "How sure the fusion was of a ten second decision against how often such decisions were right, on people the decoders never saw",
      x: "How sure the fusion was",
      diagonal: "Sure as often as right",
      linearHand: "Linear, weight set by hand ({n})",
      linearFit: "Linear, weight fitted ({n})",
      learnedFit: "Learned, weight fitted ({n})",
      point: "Sure {n}, right {m}",
      series: "Decoder and weight",
    },
    belief: {
      index: "07",
      headlineLines: ["Weak alone,", "strong together"],
      body: "A ten second decision is right {n} of the time with the learned decoder: too weak to act on, so the phone acts on none of them alone. It keeps a belief about who is being listened to, adds every decision by what it is worth, and allows that attention may have moved since the last one. After the first minute the belief names the followed story {m} of the time, and after a switch it comes over in a median {k} seconds.",
      tradeoff: "How readily the belief lets go is one number, the chance per decision that attention moved. Higher follows a switch sooner and wavers more. The phone uses {n}%, ringed.",
      chartLabel: "Share of the time the belief names the followed story against the median time to come over after a switch, for each setting, learned and linear decoder",
      x: "Seconds to come over after a switch",
      learned: "Learned decoder",
      linear: "Linear decoder",
      point: "{n} s to come over, right {m} of the time",
      table: {
        hazard: "Chance attention moved, per decision",
        learnedSteady: "Learned, names the story",
        learnedSwitch: "Learned, to come over",
        linearSteady: "Linear, names the story",
        linearSwitch: "Linear, to come over",
        beyond: "over 5 min",
      },
      stats: {
        decision: "of single ten second decisions right",
        belief: "of the time the belief names the followed story",
        switch: "to come over after a switch",
      },
    },
  },
  beyond: {
    eyebrow: "Before the hardware",
    headlineLines: ["What other people's", "recordings say"],
    body: "The questions above were asked of one public data set. These ask others, with the phone's own code unchanged: whether the decoder holds on speech and studies it never met, whether its contacts can sit in the ear, and whether a real clench is caught while everything else is left alone.",
    heldOut: {
      index: "08",
      headlineLines: ["Speech it never heard,", "a study it never saw"],
      body: "Everyone in these recordings heard the same two stories, so a decoder tested only on new people could have learned the stories instead of the listening. So every test block is also scored by networks trained without any block of the same part of the stories, from anyone, and by networks trained on one source study and tested on the other. One minute decisions: {std} with the stories shared, {content} on speech never heard, {study} across studies.",
      decides: "So the learned decoder follows speech, not these two stories: what a product needs, since every conversation is new. Held out by person, speech and study, with the stories out of step falling to a coin flip ({ctl}), it is above every around the ear result we found published (research/LITERATURE.md).",
      chartLabel: "Share of decisions right by decision window, 36 people, one learned network per fold: the stories shared, story content held out, and the source study held out",
      x: "Decision window (s)",
      series: { standard: "Stories shared", content: "Speech never heard", study: "Study never seen" },
      chance: "Chance for one person",
    },
    inEar: {
      index: "09",
      headlineLines: ["In the ear,", "or around it"],
      body: "Fifteen other people listening to two lectures in Danish, recorded at once by dry electrodes inside each ear, wet ones around it and a scalp cap (Ear-SAAD). Each ear referenced to itself and no calibration, as two earbuds would decode: one minute decisions reach {around} around the ear and {inear} inside it, a coin flip.",
      decides: "So the earbud's contacts cannot all sit in the canal. Some must reach around or behind the ear, where the signal is, and that shapes the product before anything else does. The learned decoder beats the linear one wherever there is signal to find.",
      chartLabel: "Share of one minute decisions right, learned decoder, 15 people, each ear referenced to itself, no calibration, by where the electrodes sit",
      y: "Decisions right",
      x: "Electrodes",
      systems: { inear: "In the ear", aroundear: "Around it", both: "Both", scalp: "Scalp" },
      table: { system: "Electrodes", linear: "Linear, 1 min", learned: "Learned, 1 min", learned5: "Learned, 5 min" },
    },
    hold: {
      index: "11",
      headlineLines: ["What holding", "the voice is worth"],
      body: "The real ten second decisions of people the decoder never saw, replayed under a head that looks away a quarter of the time, half of that at the other talker, in looks of about twenty seconds. How often each way of choosing brings the followed voice forward:",
      chartLabel: "Share of time the followed voice is brought forward, by how the voice is chosen, with the head looking away a quarter of the time",
      y: "Followed voice forward",
      policies: {
        face: "The voice you face",
        face_hold: "Face, holding the last",
        face_dwell: "Face for 20 s first",
        EEG: "Contacts alone",
        fused: "Head and contacts, as shipped",
        fused_k1: "Head and contacts, head weighed less",
      },
      stats: {
        nobody: "looking away only at nothing: the head alone, holding the last voice, is enough",
        other: "looking at someone else while following: head and contacts, against {n} for the head alone",
        covert: "attention moves and the head does not: head and contacts follow it, against {n} as shipped and {m} for the head alone",
      },
      decides: "So the contacts earn their place in two moments, and only two: when you look at someone other than the person you follow, and when your attention moves while your head does not. And the phone trusted the head too much: with its weight halved, a glance no longer outweighs a minute of evidence, and a real turn still comes through in about {n} seconds.",
      note: "The decisions are real; the head is simulated. How often and where a listener looks is an assumption, swept in research/aad/hold_value.json.",
      play: {
        title: "Try it: one listener, thirty minutes, your head",
        look: { label: "Look at", followed: "The voice they follow", down: "Down at the plate", other: "The other voice" },
        wander: "Let the head wander",
        voices: { followed: "Followed", other: "Other" },
        panels: { face: "The voice you face", fused: "Head and contacts" },
        play: "Play",
        pause: "Pause",
        again: "Again",
        minutes: "min",
        belief: "contacts sure of the followed voice",
        note: "The real ten second decisions of one person the decoder never saw ({acc} of their one minute decisions right), in order, twenty two times faster; the head is yours. Head and contacts is the phone's fusion with the head weighed half, as above. Each square is ten seconds, lit when the followed voice was the one brought forward; scores count from the second minute.",
      },
    },
    hardware: {
      index: "12",
      headlineLines: ["What the electronics", "may add"],
      body: "The raw recordings of every held out person, degraded as cheaper or harsher electronics would degrade them, then through the whole chain and the decoder that never saw them. Where one minute decisions start to fall is the bar each part of the earbud has to clear.",
      table: { what: "What is degraded", holds: "Within a point of clean", breaks: "Three points lost at" },
      under: "under",
      downTo: "down to",
      never: "not within the range tried",
      movement: { head: "200 \u00b5V jolts a minute", ungated: "Ungated", gated: "Gated, as the phone now does" },
      kinds: {
        noise: { label: "White noise at every electrode", unit: "nV/\u221aHz" },
        pink: { label: "1/f noise in the decoder's band", unit: "\u00b5Vrms" },
        lsb: { label: "One converter step", unit: "\u00b5V" },
        rate: { label: "Sampling rate", unit: "Hz" },
        skew: { label: "Clock offset between the earbuds", unit: "ms" },
        loss: { label: "Frames lost one at a time", unit: "of frames" },
        burst: { label: "Frames lost in 200 ms bursts", unit: "of frames" },
        artifacts: { label: "Movement jolts, ungated", unit: "a minute" },
        gated: { label: "Movement jolts, gated", unit: "a minute" },
        gatedc: { label: "Movement jolts, gated as the phone does", unit: "a minute" },
        mains: { label: "50 Hz mains at 1% imbalance", unit: "\u00b5V" },
        envlag: { label: "Speech envelopes late or early", unit: "ms" },
        crosstalk: { label: "The other voice in each envelope", unit: "mixed in" },
      },
      decides: "So the amplifier is not the limit, and neither is the radio: noise, resolution, sampling and the clocks of two earbuds all leave wide margins, and a tenth of all frames can go missing one at a time. What the decoder does not forgive is a speech envelope out of step with the EEG (25 ms late already costs two points, so the microphones' envelopes must share the electrodes' clock to about 10 ms) and movement: two jolts a minute cost five points, and a gate that blanks half a second from each one, now in the phone's chain, wins most of them back while costing nothing at rest. Separation can be rough: each envelope may carry 70% of the other voice.",
    },
    clench: {
      index: "10",
      headlineLines: ["A clench,", "in real life"],
      body: "The phone's clench detector, unchanged, on four public sets of recordings: cued clenches around the ear and on a consumer headband, and everyday movements labelled one by one. At its shipped setting it caught {n} of cued clenches around the ear and stayed almost silent at rest. What sets it off is swallowing, half the time, and raised eyebrows, a third; talking barely does.",
      decides: "A double clench almost never happens by itself: in quiet listening {n} an hour, against {m} for singles and holds. So keeping a moment belongs on the double clench, and a swallow is what the earbud must learn to ignore. The electrodes cannot do that alone: described by everything the detector can measure as it goes, swallows and clench bursts overlap (AUC 0.62 on people left out), so the earbud listens for a swallow with the microphone that faces the ear canal. For a third of people the clench is too weak at these sites for the shipped setting, which the first dev kit study measures on the earbud's own contacts.",
      chartLabel: "Share of each labelled movement during which the clench detector reported a gesture, 12 people, temporal scalp electrodes at 1000 Hz",
      x: "Movement",
      y: "Set the detector off",
      movements: {
        swallow: "Swallowing",
        eyebrow: "Raised brows",
        ver_headm: "Nodding",
        blink: "Blinking",
        tongue: "Tongue, as in speech",
        hor_headm: "Turning the head",
        eyes: "Moving the eyes",
      },
      movementsNote: "Share of each labelled movement during which the detector reported a gesture, 12 people. Cued clenches in the same recordings: 99% of blocks caught.",
      table: {
        recording: "Recording",
        people: "People",
        caught: "Cued clenches caught",
        falsePerHour: "False reports an hour",
      },
      datasets: {
        around: "Around the ear, 250 Hz",
        headband: "Consumer headband, 256 Hz",
        scalp: "Temporal scalp, 1000 Hz",
        listening: "Quiet listening, around the ear, 500 Hz",
      },
      perHour: "{n} an hour",
      blocks: "{n} of clench blocks",
      stats: {
        caught: "of cued clenches caught around the ear, at the shipped setting",
        swallow: "of swallows set off a false clench",
        doubles: "false double clenches an hour in quiet listening",
      },
    },
  },
  explorer: {
    eyebrow: "Try a design",
    headlineLines: ["Pick an earbud,", "see what the data says"],
    body: "Every configuration here was run on the same 36 people and held out the same way, with the linear decoder. Choose how many electrodes each earbud carries, whether the two share a wire, and whether the decoder learns the wearer.",
    electrodes: "Electrodes per ear",
    all: "All",
    form: "Form",
    forms: {
      wireless: "Two earbuds, no wire",
      wired: "Two earbuds, wired",
      right: "Right earbud only",
      left: "Left earbud only",
    },
    decoder: "Decoder",
    decoders: {
      generic: "No calibration",
      personal: "20 minutes of the wearer",
    },
    at: "Decisions right at {n} s",
    switch: "To follow a switch",
    switchValue: "{n} s",
    people: "People who beat chance on their own",
    peopleValue: "{n} of 36",
    allOneEar: "All the electrodes are measured for two earbuds; one earbud alone tops out at 8 here.",
  },
  axisRight: "Decisions right",
  tableToggle: "Show the numbers",

  meaning: {
    eyebrow: "What it decides about the earbuds",
    headlineLines: ["The head steers.", "The EEG confirms."],
    items: [
      {
        title: "True wireless works",
        body: "Two earbuds share no electrical reference, so each has to measure against itself. That costs about a point and a half here. No neckband, no wire.",
      },
      {
        title: "Four electrodes per ear",
        body: "Two per ear reach most of what every electrode does, so four leave room for contact lost to movement and sweat. The ranking says where they should touch.",
      },
      {
        title: "Wear it and go",
        body: "A decoder trained on other people works from the start, and the earbud scales it to the wearer from two minutes of wear without asking anything.",
      },
      {
        title: "EEG is the slow channel",
        body: "Two second decisions are barely better than a coin flip; with the learned decoder one minute decisions are right nearly four times in five, five minute ones {n} of the time. Turning toward someone steers in a fraction of a second, a clench is the explicit command, and the EEG's running belief tells, over a minute or two, who a person keeps coming back to: what it adds is holding the voice while you look at someone else, and noticing when your attention moves and your head does not.",
      },
    ],
  },

  built: {
    eyebrow: "What is already built",
    headlineLines: ["Everything but", "the hardware"],
    lead: "The earbud's job is small on purpose: sample the electrodes, the motion sensor and the microphones, stamp the time, send frames. Everything after that is software, and it is written and tested.",
    items: [
      {
        name: "Decoding pipeline",
        path: "lib/sense",
        body: "Filtering, resampling, the linear and the learned attention decoders, the running belief, head and EEG fusion, clench detection. TypeScript, matched against the research code sample for sample.",
      },
      {
        name: "Wire protocol",
        path: "hardware/PROTOCOL.md",
        body: "One frame per Bluetooth notification. A C encoder for the firmware writes the exact bytes the app reads, checked in both directions.",
      },
      {
        name: "Digital twin",
        path: "lib/sense/twin.ts",
        body: "A pair of virtual earbuds streaming real recordings, head motion and jaw clenches as frames, so the whole app runs end to end today.",
      },
      {
        name: "Dev kit bridge",
        path: "lib/sense/transport.ts",
        body: "An OpenBCI board over USB, or Signalive earbuds over Bluetooth, behind the same interface as the twin.",
      },
      {
        name: "Hardware spec",
        path: "hardware/SPEC.md",
        body: "What the earbud must provide, each requirement with its reason and its test: electrodes, front end, referencing, radio, power.",
      },
      {
        name: "Research code",
        path: "research/aad",
        body: "Everything on this page, rebuilt from the public data with three commands.",
      },
    ],
    open: "Open on GitHub",
  },

  console: {
    eyebrow: "The earbuds, emulated",
    headlineLines: ["Plug in the hardware.", "Nothing else changes."],
    body: "Two virtual earbuds stream the same recording as Bluetooth frames, each with its own clock and motion sensor, and the left one sends how loud each voice around it is. The phone side decodes the frames exactly as it will decode the real ones, weighs head and EEG, and sends the earbuds a direction to bring forward. Clench, and the detector has to find it in the raw signal.",
    start: "Start the earbuds",
    starting: "Loading the recording",
    stop: "Stop",
    error: "The recording could not load. Reload to try again.",
    clench: "Clench",
    double: "Clench twice",
    hold: "Hold a clench",
    turn: "Turn the head",
    turnValue: "{n} degrees",
    sides: { left: "Left earbud", right: "Right earbud" },
    frames: "Frames",
    lost: "Lost",
    rate: "Samples a second",
    drift: "Clock drift",
    driftValue: "{n} ppm",
    battery: "Battery",
    phone: "On the phone",
    attention: "Which voice, head and EEG together",
    leftVoice: "Left voice",
    rightVoice: "Right voice",
    headYaw: "Head, from the motion sensor",
    eegVerdict: "EEG, last 10 seconds",
    eegPending: "Gathering 10 seconds",
    steering: "Sent back to the earbuds",
    steerValue: "Bring forward the voice {n} degrees from straight ahead, {m} dB",
    steerNone: "Nothing yet",
    heard: "Clenches detected",
    none: "Nothing yet",
    kinds: { single: "Clench", double: "Double clench", hold: "Held clench" },
    latency: "{n} ms after it began",
    note: "Clenches here are synthetic jaw muscle activity added to the recording; on the earbuds they come from the same electrodes. The recording is the clearest one from the replay.",
  },

  method: {
    eyebrow: "Method and limits",
    items: [
      {
        label: "Data",
        body: "Attended speaker paradigm (cEEGrid data), OpenNeuro ds004015, released under CC0 by Holtze, Rosenkranz, Jaeger, Debener and Mirkovic (Frontiers in Neuroscience, 2022). 36 people, electrode arcs around both ears, two audiobooks at once from left and right, each person told to follow one side. Three 10 minute blocks per person in which both stories were equally loud.",
      },
      {
        label: "Pipeline",
        body: "A causal band pass from 1 to 9 Hz, resampling to 64 Hz, and a linear decoder over half a second of EEG that rebuilds the followed story's loudness over time. A window's verdict is the story whose loudness matches the rebuilt one best.",
      },
      {
        label: "Testing",
        body: "Personal decoders were tested on a 10 minute block they never saw; generic ones on a person they never saw, scaled with that person's first two minutes and no labels. The electrode ranking was chosen on the whole group, which can flatter the per ear counts slightly.",
      },
      {
        label: "Switch time",
        body: "Minimal expected switch duration (Geirnaert, Francart and Bertrand): the attended voice held in the top 35% of the gain range 80% of the time, with at least five gain steps.",
      },
      {
        label: "Learned decoder",
        body: "Two networks of one dimensional convolutions, about 16,000 weights each: one over the eight electrode channels, one over each story's loudness, trained on 5 second crops so that the followed story's embedding moves with the EEG's. Six folds by person, five more people held back to stop training, five networks per fold from different starting points, trained on every recorded block, three different splits of the 36 people. The settings were chosen among thirteen variants on validation people only, by a rule fixed before the runs. The EEG is scaled from the person's first two minutes and each story by its own running spread; nothing reaches more than 0.44 s ahead. The control rotates both stories 97 s out of step with the EEG.",
      },
      {
        label: "Trust and belief",
        body: "Each decoder's ten second decisions on people it never saw fit the weight a decision's margin earns, by maximum likelihood. The belief is a hidden Markov model over the two stories, filtered forward one decision at a time. Its steadiness counts from the second minute of each block; its switch times come from switches simulated halfway through each block, the later decisions counting for the other story.",
      },
      {
        label: "Limits",
        body: "Electrode arcs around the ear are not earbuds. Attention here was instructed and held for whole blocks, never switched. A quiet room and people sitting still. These are published research recordings, not Signalive product measurements.",
      },
    ],
    reproduce: "Reproduce it",
    commands: [
      "python3 research/aad/preprocess.py",
      "python3 research/aad/analyze.py",
      "python3 research/aad/export.py",
      "python3 research/aad/calibrate.py",
      "for s in 7 11 23; do AAD_SEED=$s AAD_ENSEMBLE=3 python3 research/aad/deep.py; done",
      "python3 research/aad/belief.py",
      "python3 research/aad/deep_export.py",
    ],
    sourceLabel: "The data set",
    paperLabel: "The study",
  },
};

export const stickyCta = {
  label: "Join the waitlist",
};

export const meta = {
  title: `${BRAND}. Earbuds that know who you are listening to.`,
  description:
    "Earbuds that follow the voice you are listening to and capture what matters with a jaw clench. No screen, no wake word, no pause in the conversation.",
};

export const a11y = {
  skipToContent: "Skip to main content",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  dismissAnnouncement: "Dismiss announcement",
  heroVideoAlt:
    "Extreme macro view of the earbud surface, with a soft highlight travelling along its titanium ring.",
};
