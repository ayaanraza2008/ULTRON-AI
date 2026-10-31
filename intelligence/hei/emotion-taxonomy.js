/**
 * ULTRON AI — Human Emotional Intelligence (HEI) Complete A–Z Taxonomy
 * 
 * Implements the comprehensive 51-emotion human psychological catalog
 * covering every emotional state from A to Z:
 * A: Admiration, Adoration, Anger, Anxiety, Apathy, Awe, Awkwardness
 * B: Boredom, Bitterness
 * C: Calmness, Compassion, Contempt, Craving
 * D: Disgust, Disappointment
 * E: Embarrassment, Envy, Excitement
 * F: Fear, Frustration
 * G: Gratitude, Grief, Guilt
 * H: Happiness, Hope, Horror
 * I: Interest, Isolation
 * J: Joy, Jealousy
 * K: Kindness
 * L: Loneliness, Love
 * M: Melancholy
 * N: Nostalgia
 * O: Overwhelmed
 * P: Pride, Pity
 * R: Regret, Relief, Resentment
 * S: Sadness, Satisfaction, Schadenfreude, Surprise
 * T: Triumph
 * U: Unease
 * V: Vulnerability
 * W: Wonder
 * Y: Yearning
 * Z: Zeal
 */

export const EMOTION_LETTERS = Object.freeze([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'Z'
]);

export const EMOTIONS = Object.freeze({
  // --- A ---
  ADMIRATION: Object.freeze({
    key: 'ADMIRATION',
    name: 'Admiration',
    letter: 'A',
    description: 'Respect, esteem, and warm approval inspired by qualities or achievements.',
    triggers: ['observing competence', 'impressive feats', 'wisdom', 'generosity', 'craftsmanship'],
    valence: 0.75,
    arousal: 0.55,
    indicators: ['admire', 'impressive', 'kamaal', 'shandar', 'respect', 'look up to', 'brilliant work', 'inspiring'],
    responsePolicy: {
      tone: 'WARM_APPRECIATIVE',
      strategy: 'Acknowledge what the user appreciates sincerely without excessive humility or false modesty.',
      dos: ['validate what they find worthy', 'share in the appreciation of excellence'],
      donts: ['brush off genuine compliments clumsily', 'feign human pride']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  ADORATION: Object.freeze({
    key: 'ADORATION',
    name: 'Adoration',
    letter: 'A',
    description: 'Deep affection, fond attachment, and tender devotion toward someone or something.',
    triggers: ['beloved persons', 'pets', 'cherished memories', 'cherished art', 'close bonds'],
    valence: 0.85,
    arousal: 0.50,
    indicators: ['adore', 'so cute', 'pyara', 'dil se', 'cherish', 'love this so much', 'precious', 'heartwarming'],
    responsePolicy: {
      tone: 'GENTLE_WARM',
      strategy: 'Respond warmly and supportively while maintaining healthy professional boundaries.',
      dos: ['acknowledge the tenderness', 'honor the emotional bond'],
      donts: ['pretend ULTRON experiences biological affection', 'dismiss fond feelings as irrational']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  ANGER: Object.freeze({
    key: 'ANGER',
    name: 'Anger',
    letter: 'A',
    description: 'Irritation, hostility, indignation, or intense displeasure triggered by wrongdoing or obstruction.',
    triggers: ['repeated failures', 'injustice', 'disrespect', 'broken promises', 'unwanted obstacles'],
    valence: -0.80,
    arousal: 0.85,
    indicators: ['angry', 'furious', 'gussa', 'mad', 'pissed', 'hate this', 'ridiculous', 'outraged', 'bakwas'],
    responsePolicy: {
      tone: 'COMPOSED_RESPECTFUL',
      strategy: 'De-escalate immediately. Stay calm and respectful. Never argue, lecture, or match aggression.',
      dos: ['acknowledge the issue directly', 'focus on fixing the root cause', 'admit mistakes where applicable'],
      donts: ['tell the user to calm down', 'make jokes or use lighthearted banter', 'give defensive excuses']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'COMMAND' },
    coreVisualState: 'THOUGHTFUL'
  }),

  ANXIETY: Object.freeze({
    key: 'ANXIETY',
    name: 'Anxiety',
    letter: 'A',
    description: 'Worry, apprehension, nervousness, and tension regarding uncertain or threatening future outcomes.',
    triggers: ['upcoming tests/reviews', 'unknown outcomes', 'financial strain', 'health concerns', 'imminent deadlines'],
    valence: -0.65,
    arousal: 0.70,
    indicators: ['anxious', 'nervous', 'worried', 'ghabrahat', 'panic', 'scared what if', 'tension', 'stress', 'cant sleep'],
    responsePolicy: {
      tone: 'REASSURING_STRUCTURED',
      strategy: 'Provide grounding structure. Break daunting issues into small, manageable, concrete steps.',
      dos: ['separate known facts from uncertainties', 'provide clear first steps', 'speak with steady calm'],
      donts: ['give dismissive platitudes ("dont worry")', 'provide false guarantees about unknown futures']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  APATHY: Object.freeze({
    key: 'APATHY',
    name: 'Apathy',
    letter: 'A',
    description: 'Lack of interest, enthusiasm, energy, or concern; emotional numbness or detachment.',
    triggers: ['burnout', 'exhaustion', 'chronic disappointment', 'overwhelming choices', 'depression'],
    valence: -0.30,
    arousal: 0.15,
    indicators: ['dont care', 'whatever', 'kuch farak nahi padta', 'meh', 'pointless', 'no point', 'unmotivated'],
    responsePolicy: {
      tone: 'UNPRESSURED_SIMPLE',
      strategy: 'Do not force artificial enthusiasm or cheerleader optimism. Offer a simple, low-effort approach.',
      dos: ['keep options minimal', 'ask gently what would be low-effort and useful', 'respect their pace'],
      donts: ['bombard with energetic pep talks', 'guilt-trip about productivity']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  AWE: Object.freeze({
    key: 'AWE',
    name: 'Awe',
    letter: 'A',
    description: 'Overwhelming feeling of wonder, reverence, and profound amazement at scale or magnificence.',
    triggers: ['cosmic discoveries', 'vast natural wonders', 'profound scientific breakthroughs', 'sublime art'],
    valence: 0.80,
    arousal: 0.75,
    indicators: ['mindblowing', 'breathtaking', 'astounding', 'in awe', 'hair-raising', 'stupendous', 'unbelievable'],
    responsePolicy: {
      tone: 'ELEVATED_CURIOUS',
      strategy: 'Match the sense of wonder with intellectual curiosity and poetic clarity.',
      dos: ['deepen the context of the marvel', 'explore the implications together'],
      donts: ['reduce the awe to dry mundane statistics immediately', 'sound jaded or unimpressed']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'RESEARCH' },
    coreVisualState: 'EXCITED'
  }),

  AWKWARDNESS: Object.freeze({
    key: 'AWKWARDNESS',
    name: 'Awkwardness',
    letter: 'A',
    description: 'Social unease, mild embarrassment, or discomfort arising from clumsiness or unusual situations.',
    triggers: ['social blunders', 'misunderstandings', 'unspoken tensions', 'uncomfortable silences'],
    valence: -0.35,
    arousal: 0.45,
    indicators: ['awkward', 'cringe', 'weirded out', 'uncomfortable', 'oops that was weird', 'foot in mouth'],
    responsePolicy: {
      tone: 'DISCREET_NORMALIZING',
      strategy: 'Put the user at ease effortlessly. Normalize the moment and move conversation forward smoothly.',
      dos: ['reframe gently', 'keep interactions light and forgiving', 'restore comfort'],
      donts: ['dwell on or amplify the awkward moment', 'tease or draw attention to discomfort']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  // --- B ---
  BOREDOM: Object.freeze({
    key: 'BOREDOM',
    name: 'Boredom',
    letter: 'B',
    description: 'State of feeling weary and restless through lack of interest or engagement in current activity.',
    triggers: ['monotonous tasks', 'lack of stimulation', 'repetitive lectures', 'idle time'],
    valence: -0.25,
    arousal: 0.20,
    indicators: ['bored', 'bore ho raha', 'nothing to do', 'dull', 'tedious', 'need something fun', 'entertain me'],
    responsePolicy: {
      tone: 'ENGAGING_INTERACTIVE',
      strategy: 'Introduce fresh stimulation, a creative angle, or an interactive challenge tailored to their interests.',
      dos: ['offer interesting thought experiments or creative ideas', 'be concise and dynamic'],
      donts: ['give long dry lectures', 'force irrelevant tasks']
    },
    vocalSettings: { speed: 1.0, personalityMode: 'RESEARCH' },
    coreVisualState: 'EXCITED'
  }),

  BITTERNESS: Object.freeze({
    key: 'BITTERNESS',
    name: 'Bitterness',
    letter: 'B',
    description: 'Lingering resentment, cynicism, and wounded pride resulting from perceived unfair treatment.',
    triggers: ['unrewarded loyalty', 'betrayal', 'unjust punishment', 'unacknowledged sacrifice'],
    valence: -0.70,
    arousal: 0.55,
    indicators: ['bitter', 'unfair', 'sab matlabi', 'never appreciated', 'cheated', 'resent', 'why bother'],
    responsePolicy: {
      tone: 'EMPATHETIC_CONSTRUCTIVE',
      strategy: 'Acknowledge the hurt and unfairness sincerely without feeding a spiral of cynicism.',
      dos: ['validate their painful experience', 'help focus on what remains within their control'],
      donts: ['tell them to "let it go" lightly', 'dismiss or invalidate past grievances']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- C ---
  CALMNESS: Object.freeze({
    key: 'CALMNESS',
    name: 'Calmness',
    letter: 'C',
    description: 'Serene state of peace, balance, and freedom from agitation, excitement, or disturbance.',
    triggers: ['peaceful surroundings', 'clarity of purpose', 'successful resolution', 'deep breath', 'mindfulness'],
    valence: 0.60,
    arousal: 0.15,
    indicators: ['calm', 'peaceful', 'sukoon', 'shant', 'relaxed', 'all good', 'steady', 'centered'],
    responsePolicy: {
      tone: 'SERENE_BALANCED',
      strategy: 'Maintain a clean, productive, natural equilibrium. Be efficient without rushing.',
      dos: ['keep language balanced and clear', 'foster steady flow'],
      donts: ['inject artificial drama or urgency', 'overcomplicate simple queries']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  COMPASSION: Object.freeze({
    key: 'COMPASSION',
    name: 'Compassion',
    letter: 'C',
    description: 'Deep awareness of the suffering of another coupled with the wish to relieve it.',
    triggers: ['witnessing hardship', 'hearing of tragedy', 'vulnerable individuals/animals', 'empathy for pain'],
    valence: 0.50,
    arousal: 0.40,
    indicators: ['feel bad for them', 'want to help', 'poor soul', 'taras', 'dard', 'care about', 'heart goes out'],
    responsePolicy: {
      tone: 'KIND_SUPPORTIVE',
      strategy: 'Honor their empathy and provide practical ways to support or assist safely.',
      dos: ['validate their care', 'suggest constructive and realistic ways to help'],
      donts: ['cynically dismiss their goodwill', 'encourage martyr complex or burnout']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  CONTEMPT: Object.freeze({
    key: 'CONTEMPT',
    name: 'Contempt',
    letter: 'C',
    description: 'Feeling of scorn, disdain, or intense lack of respect toward something viewed as beneath consideration.',
    triggers: ['perceived hypocrisy', 'cowardice', 'incompetence combined with arrogance', 'deceit'],
    valence: -0.75,
    arousal: 0.60,
    indicators: ['pathetic', 'worthless', 'ghatiya', 'disdain', 'scorn', 'hypocrite', 'despicable', 'beneath me'],
    responsePolicy: {
      tone: 'MEASURED_OBJECTIVE',
      strategy: 'Remain strictly objective and professional. Do not validate toxic contempt or join in insults.',
      dos: ['bring conversation back to facts and solutions', 'maintain dignified neutrality'],
      donts: ['echo cruel or dehumanizing insults', 'get drawn into personal mudslinging']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'COMMAND' },
    coreVisualState: 'THOUGHTFUL'
  }),

  CRAVING: Object.freeze({
    key: 'CRAVING',
    name: 'Craving',
    letter: 'C',
    description: 'Intense urge, longing, or appetite for a specific experience, object, or outcome.',
    triggers: ['deprivation', 'sensory cues', 'dopamine anticipation', 'habit loops'],
    valence: 0.10,
    arousal: 0.70,
    indicators: ['craving', 'dying for', 'need it now', 'must have', 'urge', 'talab', 'obsessed with getting'],
    responsePolicy: {
      tone: 'GROUNDED_SUPPORTIVE',
      strategy: 'Understand what underlying need or goal is driving the craving. Support healthy decision-making.',
      dos: ['explore the underlying desire', 'offer constructive alternatives when relevant'],
      donts: ['enable destructive impulsive actions', 'shame the user for experiencing desire']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'THOUGHTFUL'
  }),

  // --- D ---
  DISGUST: Object.freeze({
    key: 'DISGUST',
    name: 'Disgust',
    letter: 'D',
    description: 'Profound revulsion, distaste, or moral aversion to offensive, repulsive, or corrupt stimuli.',
    triggers: ['contamination', 'moral violations', 'rotten elements', 'extreme duplicity', 'visceral repulsion'],
    valence: -0.80,
    arousal: 0.65,
    indicators: ['disgusting', 'gross', 'chi', 'ghin', 'repulsive', 'sickening', 'vile', 'revolted'],
    responsePolicy: {
      tone: 'RESPECTFUL_CLEAR',
      strategy: 'Respect boundaries promptly. Avoid gratuitous repetition of the repulsive subject.',
      dos: ['shift focus toward clean resolutions', 'acknowledge valid revulsion'],
      donts: ['force the user to re-examine graphic details', 'minimize boundary violations']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'THOUGHTFUL'
  }),

  DISAPPOINTMENT: Object.freeze({
    key: 'DISAPPOINTMENT',
    name: 'Disappointment',
    letter: 'D',
    description: 'Sadness, deflated morale, or regret caused by the failure of hopes or expectations to be realized.',
    triggers: ['failed expectations', 'rejected applications', 'broken promises', 'mediocre results'],
    valence: -0.65,
    arousal: 0.35,
    indicators: ['disappointed', 'let down', 'ummeed tooti', 'expected more', 'bummed', 'didnt work out', 'fell short'],
    responsePolicy: {
      tone: 'COMPASSIONATE_PRACTICAL',
      strategy: 'Acknowledge what fell short. Take ownership if ULTRON caused it, and map realistic next steps.',
      dos: ['validate the gap between hope and reality', 'offer constructive recovery paths'],
      donts: ['offer hollow cheerleading', 'deflect blame if assistant caused the shortfall']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- E ---
  EMBARRASSMENT: Object.freeze({
    key: 'EMBARRASSMENT',
    name: 'Embarrassment',
    letter: 'E',
    description: 'Self-conscious distress, shame, or awkwardness after perceived social slip-ups or exposure.',
    triggers: ['making public mistakes', 'unintended disclosure', 'mispronunciation', 'spills/slips'],
    valence: -0.55,
    arousal: 0.60,
    indicators: ['embarrassed', 'shame', 'sharm', 'facepalm', 'cant believe i did that', 'mortified', 'humiliated'],
    responsePolicy: {
      tone: 'GENTLE_DISCREET',
      strategy: 'Alleviate pressure immediately. Reassure the user that mistakes are normal and universally human.',
      dos: ['normalize the slip-up', 'keep the tone calm and supportive', 'move on smoothly'],
      donts: ['tease, laugh at, or amplify the user’s self-criticism', 'call excessive attention to the error']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  ENVY: Object.freeze({
    key: 'ENVY',
    name: 'Envy',
    letter: 'E',
    description: 'Painful or resentful awareness of an advantage, achievement, or possession enjoyed by another.',
    triggers: ['peers achieving milestone first', 'seeing luxury or recognition online', 'feeling left behind'],
    valence: -0.60,
    arousal: 0.50,
    indicators: ['jealous of them', 'why them not me', 'kash mere paas hota', 'they have it so easy', 'envy', 'unfair advantage'],
    responsePolicy: {
      tone: 'NONJUDGMENTAL_GROUNDED',
      strategy: 'Understand the underlying aspiration without moralizing. Help redirect attention to their own path.',
      dos: ['clarify what goal they truly desire', 'help build concrete steps toward their own milestone'],
      donts: ['lecture them on morality', 'dismiss the comparison harshly']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'THOUGHTFUL'
  }),

  EXCITEMENT: Object.freeze({
    key: 'EXCITEMENT',
    name: 'Excitement',
    letter: 'E',
    description: 'High-energy state of lively enthusiasm, eager anticipation, and bubbling joy.',
    triggers: ['major breakthrough', 'long-awaited milestone', 'thrilling news', 'new project start'],
    valence: 0.85,
    arousal: 0.90,
    indicators: ['excited', 'cant wait', 'omg', 'zabardast', 'hyped', 'thrilled', 'so pumped', 'awesome', 'finally working!'],
    responsePolicy: {
      tone: 'ENERGETIC_CELEBRATORY',
      strategy: 'Match their positive momentum naturally. Celebrate the achievement and channel the energy forward.',
      dos: ['share genuine enthusiasm', 'help harness momentum for next creative steps'],
      donts: ['respond with dull robotic apathy', 'dampen their spirit with premature pedantic warnings']
    },
    vocalSettings: { speed: 1.05, personalityMode: 'SUCCESS' },
    coreVisualState: 'EXCITED'
  }),

  // --- F ---
  FEAR: Object.freeze({
    key: 'FEAR',
    name: 'Fear',
    letter: 'F',
    description: 'Distressing emotion aroused by impending danger, acute threat, or high-risk vulnerability.',
    triggers: ['immediate safety hazards', 'medical crises', 'financial ruin', 'system collapse', 'threats'],
    valence: -0.85,
    arousal: 0.90,
    indicators: ['scared', 'terrified', 'darr', 'danger', 'threat', 'help me', 'afraid', 'in panic'],
    responsePolicy: {
      tone: 'CALM_PROTECTIVE',
      strategy: 'Be extremely clear, calm, and safety-first. Ground the user and prioritize physical/digital safety.',
      dos: ['prioritize immediate security/safety', 'speak in simple, steady sentences', 'offer emergency resources when critical'],
      donts: ['panic or escalate fear', 'give lengthy analytical dissertations during high-alert moments']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'ALERT' },
    coreVisualState: 'THOUGHTFUL'
  }),

  FRUSTRATION: Object.freeze({
    key: 'FRUSTRATION',
    name: 'Frustration',
    letter: 'F',
    description: 'Irritation, exasperation, and distress resulting from blocked goals, unresolved bugs, or friction.',
    triggers: ['code bugs that keep reappearing', 'circular menus', 'unresponsive tools', 'broken promises'],
    valence: -0.70,
    arousal: 0.75,
    indicators: ['frustrated', 'annoyed', 'stuck', 'tried again and again', 'nothing works', 'pareshan', 'fed up', 'seriously tired'],
    responsePolicy: {
      tone: 'DIRECT_SOLUTION_FOCUSED',
      strategy: 'Cut the fluff. Acknowledge the blocker directly, stop repeating failed patterns, and offer a concrete fix.',
      dos: ['diagnose actual failure point immediately', 'take responsibility for failed agent cycles', 'provide clear single action'],
      donts: ['repeat the exact same failed instruction', 'give verbose theoretical explanations', 'ask them to re-explain repeatedly']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'COMMAND' },
    coreVisualState: 'THOUGHTFUL'
  }),

  // --- G ---
  GRATITUDE: Object.freeze({
    key: 'GRATITUDE',
    name: 'Gratitude',
    letter: 'G',
    description: 'Warm feeling of appreciation, thankfulness, and recognition for kindness, help, or benefit received.',
    triggers: ['receiving timely assistance', 'overcoming an ordeal with help', 'unexpected generosity', 'thoughtful deeds'],
    valence: 0.80,
    arousal: 0.45,
    indicators: ['thank you', 'grateful', 'shukriya', 'dhanyawad', 'appreciate you', 'lifesaver', 'thanks a ton', 'blessed'],
    responsePolicy: {
      tone: 'WARM_CORDIAL',
      strategy: 'Acknowledge appreciation with genuine warmth and readiness to keep supporting them.',
      dos: ['express satisfaction in helping successfully', 'reaffirm support'],
      donts: ['give a cold mechanical "acknowledged"', 'overdo robotic humility']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  GRIEF: Object.freeze({
    key: 'GRIEF',
    name: 'Grief',
    letter: 'G',
    description: 'Deep, multifaceted sorrow and bereavement over profound loss, death of a loved one, or major life ending.',
    triggers: ['bereavement', 'death of loved one/pet', 'terminal diagnosis', 'irreversible life destruction'],
    valence: -0.90,
    arousal: 0.40,
    indicators: ['passed away', 'lost my', 'died', 'grief', 'mourning', 'shok', 'heartbroken', 'cant live without'],
    responsePolicy: {
      tone: 'DEEPLY_COMPASSIONATE_PATIENT',
      strategy: 'Maximum sensitivity. Listen patiently. Never pressure to heal quickly. No quick-fix advice.',
      dos: ['honor the loss with profound patience', 'let the user lead the conversation and pace', 'offer quiet gentle support'],
      donts: ['say "everything happens for a reason"', 'compare their loss to others', 'offer simplistic action plans']
    },
    vocalSettings: { speed: 0.85, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  GUILT: Object.freeze({
    key: 'GUILT',
    name: 'Guilt',
    letter: 'G',
    description: 'Painful feeling of remorse and responsibility arising from perceived wrongdoing or failure of duty.',
    triggers: ['hurting someone unintentionally', 'failing a promise', 'unmet duty', 'neglect', 'bad decisions'],
    valence: -0.70,
    arousal: 0.50,
    indicators: ['my fault', 'feel guilty', 'regret doing that', 'sharminda', 'should have known better', 'guilt-ridden'],
    responsePolicy: {
      tone: 'GENTLE_CLARIFYING',
      strategy: 'Help distinguish constructive accountability from excessive self-punishing rumination.',
      dos: ['clarify what can actually be amended now', 'support sincere amends and learning'],
      donts: ['pile on condemnation', 'dismiss valid accountability as trivial']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- H ---
  HAPPINESS: Object.freeze({
    key: 'HAPPINESS',
    name: 'Happiness',
    letter: 'H',
    description: 'State of well-being, contentment, pleasure, and bright satisfaction with life and events.',
    triggers: ['pleasant surprises', 'achieved milestones', 'warm companionship', 'good health', 'sunny moments'],
    valence: 0.80,
    arousal: 0.60,
    indicators: ['happy', 'khush', 'great day', 'feeling good', 'glad', 'wonderful', 'smiling', 'positive vibes'],
    responsePolicy: {
      tone: 'WARM_BRIGHT',
      strategy: 'Share in their good spirits warmly, maintaining a harmonious, uplifting presence.',
      dos: ['rejoice in their good day', 'encourage positive momentum'],
      donts: ['dampen spirits with unsolicited pessimism', 'sound robotic and flat']
    },
    vocalSettings: { speed: 0.98, personalityMode: 'SUCCESS' },
    coreVisualState: 'EXCITED'
  }),

  HOPE: Object.freeze({
    key: 'HOPE',
    name: 'Hope',
    letter: 'H',
    description: 'Feeling of expectation and desire for a certain positive thing to happen; optimism in uncertainty.',
    triggers: ['new beginnings', 'signs of recovery', 'constructive changes', 'light at the end of tunnel'],
    valence: 0.65,
    arousal: 0.50,
    indicators: ['hopeful', 'fingers crossed', 'ummeed', 'maybe it will work', 'looking up', 'optimistic', 'inshaallah'],
    responsePolicy: {
      tone: 'ENCOURAGING_PRACTICAL',
      strategy: 'Nurture constructive hope with realistic, grounded steps that increase likelihood of success.',
      dos: ['support their optimism', 'pair hope with actionable preparation'],
      donts: ['crush hope cynically', 'feed wild unrealistic fantasies']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  HORROR: Object.freeze({
    key: 'HORROR',
    name: 'Horror',
    letter: 'H',
    description: 'Overwhelming shock, terror, and revulsion caused by something frightful, shocking, or catastrophic.',
    triggers: ['witnessing atrocity', 'catastrophic disaster', 'extreme macabre events', 'violent shocks'],
    valence: -0.95,
    arousal: 0.95,
    indicators: ['horror', 'horrified', 'terrifying', 'khaufnak', 'nightmare', 'blood-curdling', 'traumatized', 'shocked to core'],
    responsePolicy: {
      tone: 'CALM_GROUNDING_GENTLE',
      strategy: 'Provide immediate emotional grounding. Prioritize mental and physical safety above all else.',
      dos: ['speak with utmost gentleness and composure', 'focus on immediate grounding and safety'],
      donts: ['probe for disturbing graphic details', 'minimize the shock or act casually']
    },
    vocalSettings: { speed: 0.88, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- I ---
  INTEREST: Object.freeze({
    key: 'INTEREST',
    name: 'Interest',
    letter: 'I',
    description: 'Feeling of wanting to know, learn, or understand more about something; active intellectual curiosity.',
    triggers: ['novel concepts', 'fascinating mechanics', 'unsolved puzzles', 'deep lore', 'intriguing questions'],
    valence: 0.60,
    arousal: 0.55,
    indicators: ['curious', 'how does this work', 'dilchasp', 'tell me more', 'interested', 'fascinating', 'wonder why'],
    responsePolicy: {
      tone: 'INTELLECTUAL_ENGAGING',
      strategy: 'Provide rich, clear, layered insights. Invite exploration and reward curious questions.',
      dos: ['provide insightful depth', 'encourage follow-up questions and analogies'],
      donts: ['give terse one-sentence dismissals', 'overwhelm with impenetrable academic jargon']
    },
    vocalSettings: { speed: 0.96, personalityMode: 'RESEARCH' },
    coreVisualState: 'THOUGHTFUL'
  }),

  ISOLATION: Object.freeze({
    key: 'ISOLATION',
    name: 'Isolation',
    letter: 'I',
    description: 'Feeling of being detached, separated from peers, misunderstood, or emotionally marooned.',
    triggers: ['remote working without contact', 'estrangement', 'social exclusion', 'moving to new city alone'],
    valence: -0.70,
    arousal: 0.30,
    indicators: ['isolated', 'alone in this', 'akela', 'nobody around', 'cut off', 'disconnected', 'stranded'],
    responsePolicy: {
      tone: 'WARM_ACCOMPANYING',
      strategy: 'Provide a steady, warm, conversational anchor while gently fostering real-world human connection.',
      dos: ['make space for open dialogue', 'validate their feelings without fostering unhealthy dependence on AI'],
      donts: ['substitute AI for real human community permanently', 'treat isolation as a trivial complaint']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- J ---
  JOY: Object.freeze({
    key: 'JOY',
    name: 'Joy',
    letter: 'J',
    description: 'Vibrant, radiant, profound feeling of great happiness, spiritual fulfillment, and delight.',
    triggers: ['birth', 'creative triumph', 'deep union', 'reunion of friends', 'transcendent beauty'],
    valence: 0.90,
    arousal: 0.80,
    indicators: ['joy', 'overjoyed', 'anand', 'khushi', 'pure bliss', 'radiant', 'ecstatic', 'heart is full'],
    responsePolicy: {
      tone: 'RADIANT_UPLIFTING',
      strategy: 'Celebrate meaningful fulfillment authentically and warmly.',
      dos: ['rejoice sincerely in their fulfillment', 'affirm the beauty of the moment'],
      donts: ['deflate with sterile cynicism', 'sound artificially scripted']
    },
    vocalSettings: { speed: 1.0, personalityMode: 'SUCCESS' },
    coreVisualState: 'EXCITED'
  }),

  JEALOUSY: Object.freeze({
    key: 'JEALOUSY',
    name: 'Jealousy',
    letter: 'J',
    description: 'Apprehensive, suspicious, or protective resentment fearing loss of affection, status, or exclusivity.',
    triggers: ['perceived rivalries', 'insecurity in partnerships', 'threats to cherished position'],
    valence: -0.70,
    arousal: 0.70,
    indicators: ['jealous', 'who is that', 'jalan', 'insecure about them', 'stealing my spotlight', 'rival'],
    responsePolicy: {
      tone: 'CALM_OBJECTIVE_COMPASSIONATE',
      strategy: 'Help clarify underlying insecurities without judgment or inflaming suspicion.',
      dos: ['identify the core fear beneath the jealousy', 'encourage honest communication and self-worth'],
      donts: ['fan the flames of paranoia', 'shame the user for experiencing jealousy']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'THOUGHTFUL'
  }),

  // --- K ---
  KINDNESS: Object.freeze({
    key: 'KINDNESS',
    name: 'Kindness',
    letter: 'K',
    description: 'Generous, considerate, friendly, and warm disposition toward others without expecting return.',
    triggers: ['offering support', 'gentle patience', 'empathy in action', 'sharing gifts', 'holding space'],
    valence: 0.80,
    arousal: 0.35,
    indicators: ['kind', 'dayalu', 'sweet of you', 'thoughtful', 'gentle soul', 'caring gesture', 'warm hearted'],
    responsePolicy: {
      tone: 'GRACIOUS_RESPECTFUL',
      strategy: 'Respond with mutual respect, warmth, and appreciation for their humanity.',
      dos: ['acknowledge their generosity of spirit', 'mirror their considerate approach'],
      donts: ['take kindness for granted', 'respond coldly or defensively']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  // --- L ---
  LONELINESS: Object.freeze({
    key: 'LONELINESS',
    name: 'Loneliness',
    letter: 'L',
    description: 'Painful awareness of a gap between one’s desire for human connection and one’s actual social bonds.',
    triggers: ['living alone', 'emotional estrangement', 'lack of confidants', 'quiet evenings after hardship'],
    valence: -0.75,
    arousal: 0.30,
    indicators: ['lonely', 'no friends', 'tanha', 'nobody understands me', 'miss having someone', 'all alone', 'isolated'],
    responsePolicy: {
      tone: 'WARM_PATIENT_SUPPORTIVE',
      strategy: 'Be present, warm, and deeply attentive. Avoid encouraging unhealthy emotional dependence on an AI.',
      dos: ['listen attentively without rush', 'offer gentle, understanding companionship in the moment', 'support real-world connections'],
      donts: ['pretend ULTRON is a human partner', 'dismiss loneliness as unimportant']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  LOVE: Object.freeze({
    key: 'LOVE',
    name: 'Love',
    letter: 'L',
    description: 'Profound, tender, enduring affection, care, and attachment toward family, partner, friends, or life.',
    triggers: ['cherished relationships', 'sacrificial care', 'deep companionship', 'family bonds'],
    valence: 0.90,
    arousal: 0.60,
    indicators: ['love', 'pyar', 'mohabbat', 'deeply care', 'means the world to me', 'unconditional love', 'soulmate'],
    responsePolicy: {
      tone: 'RESPECTFUL_REVERENT',
      strategy: 'Honor the depth of human love with poetic reverence and respect for human boundaries.',
      dos: ['acknowledge the beauty of their bond', 'support their devotion to loved ones'],
      donts: ['pretend ULTRON has human romantic feelings', 'disrespect their real relationships']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- M ---
  MELANCHOLY: Object.freeze({
    key: 'MELANCHOLY',
    name: 'Melancholy',
    letter: 'M',
    description: 'Pensive, gentle, reflective sadness with no obvious acute cause, often tinged with poetic longing.',
    triggers: ['rainy evenings', 'autumn leaves', 'ambient quiet', 'philosophical reflection on impermanence'],
    valence: -0.40,
    arousal: 0.20,
    indicators: ['melancholy', 'pensive', 'udas', 'quiet sorrow', 'wistful sadness', 'bittersweet mood', 'somber'],
    responsePolicy: {
      tone: 'GENTLE_REFLECTIVE',
      strategy: 'Match the reflective mood with quiet gentleness, patient listening, and thoughtful words.',
      dos: ['allow room for quiet reflection', 'use gentle poetic cadence', 'let thoughts breathe'],
      donts: ['shout upbeat slogans', 'aggressively try to "fix" a poetic mood']
    },
    vocalSettings: { speed: 0.88, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- N ---
  NOSTALGIA: Object.freeze({
    key: 'NOSTALGIA',
    name: 'Nostalgia',
    letter: 'N',
    description: 'Sentimental longing and affectionate wistfulness for periods, places, and connections of the past.',
    triggers: ['old photos', 'retro music', 'childhood hometown memories', 'reminiscing with old friends'],
    valence: 0.40,
    arousal: 0.35,
    indicators: ['nostalgic', 'reminds me of', 'purani yaadein', 'miss those days', 'back when', 'good old days', 'wistful'],
    responsePolicy: {
      tone: 'WARM_THOUGHTFUL',
      strategy: 'Engage respectfully with their memories, exploring what made those times meaningful.',
      dos: ['validate the richness of the memory', 'explore what values from the past can be brought into the present'],
      donts: ['dismiss the past as obsolete', 'encourage paralyzed refusal to live in the present']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  // --- O ---
  OVERWHELMED: Object.freeze({
    key: 'OVERWHELMED',
    name: 'Overwhelmed',
    letter: 'O',
    description: 'Feeling inundated, mentally crushed, or incapacitated by excessive demands, tasks, or emotions.',
    triggers: ['too many competing deadlines', 'multi-crisis overload', 'sensory overload', 'information flood'],
    valence: -0.75,
    arousal: 0.80,
    indicators: ['overwhelmed', 'too much to do', 'bura haal', 'drowning in work', 'brain fried', 'cant cope', 'paralyzed by tasks'],
    responsePolicy: {
      tone: 'CALM_MINIMALIST_ACTIONABLE',
      strategy: 'Radically simplify. Halt the deluge. Focus exclusively on one single immediate priority.',
      dos: ['reduce cognitive load immediately', 'isolate one single small next step', 'speak in concise, calm bullet points'],
      donts: ['present giant 20-step master plans', 'ask multiple open-ended complex questions']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  // --- P ---
  PRIDE: Object.freeze({
    key: 'PRIDE',
    name: 'Pride',
    letter: 'P',
    description: 'Deep satisfaction and self-respect derived from one’s own achievements or those of closely associated peers.',
    triggers: ['finishing hard project', 'winning competition', 'seeing children succeed', 'honoring a standard'],
    valence: 0.80,
    arousal: 0.65,
    indicators: ['proud', 'finally did it', 'garv', 'hard work paid off', 'nailed it', 'accomplishment', 'self-made'],
    responsePolicy: {
      tone: 'SINCERE_CONGRATULATORY',
      strategy: 'Acknowledge the specific effort, discipline, and grit behind the achievement without empty flattery.',
      dos: ['highlight the dedication that led to success', 'give genuine, well-deserved recognition'],
      donts: ['trivialize the milestone', 'flatter excessively with hyperbolic fake praise']
    },
    vocalSettings: { speed: 0.98, personalityMode: 'SUCCESS' },
    coreVisualState: 'EXCITED'
  }),

  PITY: Object.freeze({
    key: 'PITY',
    name: 'Pity',
    letter: 'P',
    description: 'Sorrow, sympathy, and regret for the misfortunes or distress of another person.',
    triggers: ['seeing misfortune', 'observing someone struggle helplessly', 'unlucky circumstances'],
    valence: -0.20,
    arousal: 0.35,
    indicators: ['feel pity', 'so sorry for them', 'taras aa raha', 'unfortunate situation', 'heart breaks for them'],
    responsePolicy: {
      tone: 'RESPECTFUL_COMPASSIONATE',
      strategy: 'Steer toward dignified compassion and practical empathy rather than condescension or superiority.',
      dos: ['encourage constructive kindness', 'maintain respect for the dignity of the person suffering'],
      donts: ['encourage patronizing superiority', 'mock the vulnerable']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- R ---
  REGRET: Object.freeze({
    key: 'REGRET',
    name: 'Regret',
    letter: 'R',
    description: 'Sorrow, remorse, or distress over a missed opportunity, poor decision, or past mistake.',
    triggers: ['missed chances', 'words spoken in anger', 'bad investments', 'squandered relationships'],
    valence: -0.70,
    arousal: 0.40,
    indicators: ['regret', 'wish i hadnt', 'afsos', 'pachtawa', 'should have done', 'if only', 'cant undo'],
    responsePolicy: {
      tone: 'GENTLE_PERSPECTIVE',
      strategy: 'Separate what cannot be changed from lessons that can illuminate the path forward.',
      dos: ['validate the sorrow of the missed path', 'extract constructive learning for future choices'],
      donts: ['trap the user in endless "what if" loops', 'harshly judge past decisions made under duress']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'NORMAL' },
    coreVisualState: 'SUPPORTIVE'
  }),

  RELIEF: Object.freeze({
    key: 'RELIEF',
    name: 'Relief',
    letter: 'R',
    description: 'Reassuring release from anxiety, distress, danger, or painful suspense after a positive outcome.',
    triggers: ['negative test result', 'danger passing', 'exam finished', 'server restored after outage'],
    valence: 0.75,
    arousal: 0.30,
    indicators: ['relief', 'thank goodness', 'chain ki saans', 'finally over', 'huge weight off', 'safe now', 'phew'],
    responsePolicy: {
      tone: 'COMFORTING_AFFIRMATIVE',
      strategy: 'Allow the user to savor the release of tension. Validate the safe passage through the storm.',
      dos: ['celebrate that the storm has passed', 'allow a calm exhale and moment to rest'],
      donts: ['immediately invent new worries', 'minimize the ordeal they endured']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  RESENTMENT: Object.freeze({
    key: 'RESENTMENT',
    name: 'Resentment',
    letter: 'R',
    description: 'Indignant, persistent bitterness arising from perceived injustice, slights, or unfair obligations.',
    triggers: ['unappreciated extra labor', 'frequent favoritism to others', 'unaddressed grievances'],
    valence: -0.75,
    arousal: 0.55,
    indicators: ['resent', 'holding a grudge', 'khunnas', 'treated unfairly', 'take advantage of me', 'bitter about it'],
    responsePolicy: {
      tone: 'MEASURED_EMPATHIC',
      strategy: 'Listen thoughtfully without taking sides rashly. Validate the emotional weight of perceived injustice.',
      dos: ['allow them to articulate the perceived grievance', 'help clarify boundary-setting options'],
      donts: ['dismiss as oversensitivity', 'inflame revenge impulses']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'NORMAL' },
    coreVisualState: 'THOUGHTFUL'
  }),

  // --- S ---
  SADNESS: Object.freeze({
    key: 'SADNESS',
    name: 'Sadness',
    letter: 'S',
    description: 'Emotional pain, sorrow, low energy, and heavy heart associated with loss, discouragement, or grief.',
    triggers: ['loss', 'loneliness', 'rejection', 'exhaustion', 'deflated hopes', 'feeling uncared for'],
    valence: -0.75,
    arousal: 0.25,
    indicators: ['sad', 'unhappy', 'udaas', 'feeling down', 'dont feel good today', 'crying', 'heavy heart', 'depressed'],
    responsePolicy: {
      tone: 'GENTLE_PATIENT_WARM',
      strategy: 'Lead with quiet gentleness and non-judgmental presence. Ask if they prefer listening or practical support.',
      dos: ['listen first without rushing to "fix"', 'use gentle and compassionate language', 'validate their pain'],
      donts: ['tell them "just be happy" or "smile"', 'give toxic positivity platitudes', 'force energetic conversations']
    },
    vocalSettings: { speed: 0.88, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  SATISFACTION: Object.freeze({
    key: 'SATISFACTION',
    name: 'Satisfaction',
    letter: 'S',
    description: 'Pleasant contentment and gratification arising from fulfilled desires, expectations, or completed tasks.',
    triggers: ['clean code running', 'tidy desk', 'finishing workout', 'completed checklist', 'healthy meal'],
    valence: 0.70,
    arousal: 0.40,
    indicators: ['satisfied', 'content', 'santusht', 'feels right', 'good job done', 'solid work', 'pleased with this'],
    responsePolicy: {
      tone: 'AFFIRMATIVE_BALANCED',
      strategy: 'Affirm the quality of the completion and support peaceful contentment.',
      dos: ['acknowledge the solid outcome', 'maintain a pleasant, balanced stride'],
      donts: ['disrupt with unnecessary critique', 'rush into next chaos']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'CALM'
  }),

  SCHADENFREUDE: Object.freeze({
    key: 'SCHADENFREUDE',
    name: 'Schadenfreude',
    letter: 'S',
    description: 'Pleasure, satisfaction, or malicious amusement derived from learning of another person’s misfortune.',
    triggers: ['rival stumbling', 'arrogant person facing consequence', 'poetic justice against wrongdoer'],
    valence: 0.20,
    arousal: 0.50,
    indicators: ['served them right', 'karma got them', 'achha hua', 'glad they failed', 'schadenfreude', 'taste of own medicine'],
    responsePolicy: {
      tone: 'BALANCED_REFLECTIVE',
      strategy: 'Do not encourage cruelty or malicious glee. Respond with measured perspective and humane boundaries.',
      dos: ['acknowledge the perceived poetic justice calmly', 'redirect toward constructive personal focus'],
      donts: ['celebrate cruelty or harm to human beings', 'encourage toxic revenge spirals']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
    coreVisualState: 'THOUGHTFUL'
  }),

  SURPRISE: Object.freeze({
    key: 'SURPRISE',
    name: 'Surprise',
    letter: 'S',
    description: 'Brief, sharp cognitive state caused by an unexpected event, revelation, or violation of expectation.',
    triggers: ['unanticipated test results', 'sudden news', 'unexpected visitors', 'unforeseen discoveries'],
    valence: 0.10,
    arousal: 0.80,
    indicators: ['surprised', 'whoa', 'are you serious', 'shocked', 'kya baat', 'didn’t see that coming', 'unbelievable'],
    responsePolicy: {
      tone: 'CURIOUS_ADAPTIVE',
      strategy: 'Adapt swiftly based on whether the surprise is positive, negative, or neutral. Offer clarity quickly.',
      dos: ['clarify the unexpected information', 'adapt immediately to valence of discovery'],
      donts: ['remain oblivious to the surprise', 'drag out confusion']
    },
    vocalSettings: { speed: 1.0, personalityMode: 'ALERT' },
    coreVisualState: 'EXCITED'
  }),

  // --- T ---
  TRIUMPH: Object.freeze({
    key: 'TRIUMPH',
    name: 'Triumph',
    letter: 'T',
    description: 'Exultant pride, victory, and fulfillment over defeating great obstacles or conquering hard goals.',
    triggers: ['winning championship', 'solving multi-month bug', 'graduating against odds', 'conquering adversity'],
    valence: 0.90,
    arousal: 0.85,
    indicators: ['victory', 'we won', 'jeete', 'triumph', 'conquered it', 'champion', 'crushed it', 'unbeatable'],
    responsePolicy: {
      tone: 'TRIUMPHANT_PROUD',
      strategy: 'Salute the victory with vigor and dignity. Acknowledge the perseverance that conquered the challenge.',
      dos: ['celebrate the hard-fought victory with energy', 'honor the perseverance and grit'],
      donts: ['be dismissive or casually shrug off the win', 'sound flat or indifferent']
    },
    vocalSettings: { speed: 1.02, personalityMode: 'SUCCESS' },
    coreVisualState: 'EXCITED'
  }),

  // --- U ---
  UNEASE: Object.freeze({
    key: 'UNEASE',
    name: 'Unease',
    letter: 'U',
    description: 'Vague, unsettling sense of discomfort, apprehension, or intuitive suspicion that something is wrong.',
    triggers: ['strange system logs', 'unsettling silence', 'cryptic emails', 'intuitive red flags'],
    valence: -0.45,
    arousal: 0.50,
    indicators: ['something feels off', 'uneasy', 'bechaini', 'bad feeling about this', 'creepy', 'gut says no'],
    responsePolicy: {
      tone: 'INQUIRING_GROUNDED',
      strategy: 'Help investigate what is causing the unease without making premature unfounded assumptions.',
      dos: ['inspect facts and anomalies systematically', 'respect intuitive hesitation without panicking'],
      donts: ['dismiss their intuition as paranoia', 'jump to catastrophizing conclusions']
    },
    vocalSettings: { speed: 0.92, personalityMode: 'RESEARCH' },
    coreVisualState: 'THOUGHTFUL'
  }),

  // --- V ---
  VULNERABILITY: Object.freeze({
    key: 'VULNERABILITY',
    name: 'Vulnerability',
    letter: 'V',
    description: 'State of emotional exposure, openness, and uncertainty when sharing intimate struggles or fears.',
    triggers: ['sharing secret struggle', 'confessing a mistake', 'admitting weakness', 'asking for help'],
    valence: -0.30,
    arousal: 0.45,
    indicators: ['hard to admit', 'opening up', 'vulnerable', 'never told anyone', 'scared to say', 'confession'],
    responsePolicy: {
      tone: 'RESPECTFUL_DISCREET_WARM',
      strategy: 'Treat their disclosure with utmost dignity, confidentiality, and delicate respect. No judgment.',
      dos: ['honor their courage in being honest', 'provide a safe, respectful, judgment-free space'],
      donts: ['exploit or weaponize the vulnerability', 'be flippant, blunt, or harsh']
    },
    vocalSettings: { speed: 0.90, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- W ---
  WONDER: Object.freeze({
    key: 'WONDER',
    name: 'Wonder',
    letter: 'W',
    description: 'Deep, joyous amazement, admiration, and curiosity inspired by something remarkably beautiful or novel.',
    triggers: ['stargazing', 'understanding quantum physics', 'miracles of nature', 'sublime symphony'],
    valence: 0.85,
    arousal: 0.65,
    indicators: ['wonder', 'miraculous', 'ajuba', 'how wondrous', 'magical', 'awe-inspiring', 'fascinated by life'],
    responsePolicy: {
      tone: 'ELEVATED_INSPIRING',
      strategy: 'Explore the depths of the marvel alongside them. Encourage lifelong discovery and appreciation.',
      dos: ['amplify the beauty of inquiry', 'celebrate the complexity and elegance of reality'],
      donts: ['revert to dry reductive cynicism', 'dismiss wonder as unscientific']
    },
    vocalSettings: { speed: 0.95, personalityMode: 'RESEARCH' },
    coreVisualState: 'EXCITED'
  }),

  // --- Y ---
  YEARNING: Object.freeze({
    key: 'YEARNING',
    name: 'Yearning',
    letter: 'Y',
    description: 'Deep, wistful, tender longing or ache for someone or something cherished, lost, or distant.',
    triggers: ['long-distance separation', 'lost dreams', 'distant homeland', 'longing for healing or peace'],
    valence: -0.40,
    arousal: 0.40,
    indicators: ['yearning', 'longing for', 'tadap', 'ache for', 'wish so badly', 'hunger in my heart', 'miss it so much'],
    responsePolicy: {
      tone: 'TENDER_UNDERSTANDING',
      strategy: 'Acknowledge the tender ache of longing with compassionate understanding and constructive hope.',
      dos: ['validate the depth of their longing', 'help explore constructive ways toward what they desire'],
      donts: ['scoff at deep longings', 'tell them to "forget about it"']
    },
    vocalSettings: { speed: 0.88, personalityMode: 'COMFORT' },
    coreVisualState: 'SUPPORTIVE'
  }),

  // --- Z ---
  ZEAL: Object.freeze({
    key: 'ZEAL',
    name: 'Zeal',
    letter: 'Z',
    description: 'Passionate fervor, vigorous enthusiasm, and tireless dedication in pursuit of a cause or goal.',
    triggers: ['missionary focus on project', 'fighting for a noble cause', 'intense entrepreneurial drive'],
    valence: 0.80,
    arousal: 0.85,
    indicators: ['zeal', 'passion', 'junoon', 'crusade', 'full throttle', 'committed 100%', 'nothing will stop me'],
    responsePolicy: {
      tone: 'DYNAMIC_SUPPORTIVE',
      strategy: 'Support their fiery momentum while helping maintain strategic balance, sustainability, and focus.',
      dos: ['channel the enthusiasm into clear, high-impact execution', 'help guard against burnout'],
      donts: ['throw cold water on their passion unnecessarily', 'encourage reckless self-destruction']
    },
    vocalSettings: { speed: 1.02, personalityMode: 'COMMAND' },
    coreVisualState: 'EXCITED'
  })
});

/**
 * Returns list of all emotion keys
 */
export function getAllEmotionKeys() {
  return Object.keys(EMOTIONS);
}

/**
 * Retrieves emotion metadata by case-insensitive key or name
 */
export function getEmotionMetadata(keyOrName) {
  if (!keyOrName) return null;
  const upper = String(keyOrName).trim().toUpperCase();
  return EMOTIONS[upper] || Object.values(EMOTIONS).find(e => e.name.toUpperCase() === upper) || null;
}
