"""Plain names for the feedback, in English and Bangla.

The Bangla names and the movement, direction and game names are the web app's (web/src/i18n),
so the report and the screens use the same words. The English measure names are everyday
phrases for patients; `MENTIONS` lists the words that show a text is talking about a measure,
for the validator's direction check.
"""

from typing import Literal

FeedbackLanguage = Literal["en", "bn"]

#: Everyday names of the measures, for patient text.
METRIC_NAMES: dict[FeedbackLanguage, dict[str, str]] = {
    "en": {
        "K1": "how far you can reach",
        "K5": "how quickly you start to move",
        "K6": "how quickly you reach a target",
        "K7": "how direct your reaching path is",
        "K8": "how smooth your movement is",
        "K9": "your top speed",
        "K10": "how even your speed is",
        "K12": "how often your body helped your arm",
        "R1": "how high you lift your arm in front",
        "R2": "how high you lift your arm to the side",
        "R3": "how far you bend and straighten your elbow",
        "R4": "how far you reach forward",
        "H1": "how wide you open your hand",
        "H2": "your finger taps",
        "H3": "how steadily you hold a squeeze",
        "H4": "how quickly you let go after a squeeze",
        "H5": "how quickly you move objects",
        "H6": "how wide you open your hand in Bloom",
        "G1": "your game success",
        "G2": "your active time",
        "G3": "your warm-up repetitions",
        "G4": "your warm-up goals",
        "E2": "your strongest squeeze",
        "E3": "your muscle-controlled game success",
        "E5": "how quickly your muscle starts working",
        "E6": "how quickly your muscle relaxes",
        "E8": "how steadily your muscle holds",
        "E9": "how your strength kept up through the session",
    },
    "bn": {
        "K1": "নাগালের এলাকা",
        "K5": "প্রতিক্রিয়ার সময়",
        "K6": "নড়াচড়ার সময়",
        "K7": "পথের দক্ষতা",
        "K8": "মসৃণতা",
        "K9": "সর্বোচ্চ গতি",
        "K10": "প্রতি নড়াচড়ায় গতির শিখর",
        "K12": "ক্ষতিপূরণের হার",
        "R1": "কাঁধ সামনে তোলা",
        "R2": "কাঁধ পাশে তোলা",
        "R3": "কনুইয়ের পরিসর",
        "R4": "সামনে নাগাল",
        "H1": "হাত খোলার পরিসর",
        "H2": "আঙুলের পিয়ানো সঠিক হার",
        "H3": "মুঠোর স্থিরতা",
        "H4": "ঢিলে করার সময়",
        "H5": "তুলে রাখার বয়ে নেওয়ার সময়",
        "H6": "ফুল ফোটানোয় সর্বোচ্চ খোলা",
        "G1": "খেলায় মোট সফলতার হার",
        "G2": "সক্রিয় মিনিট",
        "G3": "ওয়ার্ম-আপ পুনরাবৃত্তি",
        "G4": "ওয়ার্ম-আপের লক্ষ্য পূরণ",
        "E2": "সবচেয়ে জোরালো চাপ",
        "E3": "পেশি দিয়ে খেলার সফলতা",
        "E5": "পেশি কত দ্রুত কাজ শুরু করে",
        "E6": "পেশি কত দ্রুত ঢিলে হয়",
        "E8": "পেশি কত স্থিরভাবে ধরে রাখে",
        "E9": "সেশনজুড়ে শক্তি কতটা বজায় ছিল",
    },
}

#: Words (lower case) that show a text is about a measure, besides its id and catalogue name.
MENTIONS: dict[FeedbackLanguage, dict[str, tuple[str, ...]]] = {
    "en": {
        "K1": ("reach area", "how far you can reach", "how far you reach"),
        "K5": ("reaction time", "start to move", "start moving"),
        "K6": ("movement time", "reach a target", "reach each target", "reach the target"),
        "K7": ("path efficiency", "reaching path", "direct path"),
        "K8": ("smoothness", "smooth"),
        "K9": ("peak speed", "top speed"),
        "K10": ("speed peaks", "even your speed"),
        "K12": ("compensation",),
        "R1": ("shoulder raise forward", "arm in front"),
        "R2": ("shoulder raise sideways", "arm to the side"),
        "R3": ("elbow range", "your elbow"),
        "R4": ("forward reach", "reach forward"),
        "H1": ("hand opening", "open your hand"),
        "H2": ("finger piano", "finger taps"),
        "H3": ("grip steadiness", "hold a squeeze", "steady grip"),
        "H4": ("relaxation time", "let go"),
        "H5": ("transport time", "move objects"),
        "H6": ("bloom peak openness", "in bloom"),
        "G1": ("success rate", "game success"),
        "G2": ("active minutes", "active time"),
        "G3": ("warm-up repetitions",),
        "G4": ("warm-up goals",),
        "E2": ("strongest squeeze", "maximum voluntary contraction"),
        "E3": ("muscle-controlled game success",),
        "E5": ("onset latency", "muscle starts working"),
        "E6": ("emg relaxation", "muscle relaxes"),
        "E8": ("muscle holds", "grip steadiness (emg)"),
        "E9": ("fatigue slope", "strength kept up"),
    },
    "bn": {metric_id: (name,) for metric_id, name in METRIC_NAMES["bn"].items()},
}

MOVEMENT_NAMES: dict[FeedbackLanguage, dict[str, str]] = {
    "en": {
        "reach": "reaching",
        "shoulder": "raising your arm",
        "elbow": "bending and straightening your elbow",
        "hand_opening": "opening your hand",
        "fingers": "moving each finger",
        "grip": "gripping and holding",
        "smoothness": "smooth, steady movement",
    },
    "bn": {
        "reach": "হাত বাড়ানো",
        "shoulder": "বাহু তোলা",
        "elbow": "কনুই ভাঁজ করা ও সোজা করা",
        "hand_opening": "হাত খোলা",
        "fingers": "প্রতিটি আঙুল নাড়ানো",
        "grip": "মুঠো করে ধরে রাখা",
        "smoothness": "মসৃণ, স্থির নড়াচড়া",
    },
}

DIRECTION_NAMES: dict[FeedbackLanguage, dict[int, str]] = {
    "en": {
        0: "out to the side",
        45: "up and out",
        90: "up",
        135: "up and across",
        180: "across the body",
        225: "down and across",
        270: "down",
        315: "down and out",
    },
    "bn": {
        0: "পাশের দিকে বাইরে",
        45: "উপরে ও বাইরে",
        90: "উপরে",
        135: "উপরে ও শরীরের ওপারে",
        180: "শরীরের ওপারে",
        225: "নিচে ও শরীরের ওপারে",
        270: "নিচে",
        315: "নিচে ও বাইরে",
    },
}

GAME_NAMES: dict[FeedbackLanguage, dict[str, str]] = {
    "en": {
        "reach_activate": "Reach and squeeze",
        "balloon_pop": "Balloon pop",
        "fruit_catch": "Fruit catch",
        "bloom": "Bloom",
        "finger_piano": "Finger piano",
        "path_trace": "Path trace",
        "paint_wall": "Paint the wall",
        "pick_place": "Pick and place",
        "grip_hold": "Grip and hold",
    },
    "bn": {
        "reach_activate": "পৌঁছান ও চাপুন",
        "balloon_pop": "বেলুন ফাটানো",
        "fruit_catch": "ফল ধরা",
        "bloom": "ফুল ফোটা",
        "finger_piano": "আঙুলের পিয়ানো",
        "path_trace": "পথ আঁকা",
        "paint_wall": "দেয়াল রং করা",
        "pick_place": "তুলে রাখা",
        "grip_hold": "ধরে রাখা",
    },
}


def metric_name(metric_id: str, language: FeedbackLanguage) -> str:
    return METRIC_NAMES[language].get(metric_id, metric_id)


def direction_name(degrees: float, language: FeedbackLanguage) -> str | None:
    return DIRECTION_NAMES[language].get(round(degrees) % 360)
