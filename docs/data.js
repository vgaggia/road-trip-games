/**
 * Curated Content Packs for SHOTGUN! Road Trip Party Games
 */
(function (global) {
  'use strict';

  const AVATARS = [
    { emoji: '🦊', color: '#ff7b39' },
    { emoji: '🕶️', color: '#4cc9f0' },
    { emoji: '🤠', color: '#ffd166' },
    { emoji: '🐸', color: '#06d6a0' },
    { emoji: '👽', color: '#b57cff' },
    { emoji: '🐻', color: '#ff5d8f' },
    { emoji: '⚡', color: '#f7b801' },
    { emoji: '🍕', color: '#ff4d6d' }
  ];

  // 1. WINDOW WARS — Roadside Spotter Bingo Sights
  const WINDOW_WARS_SIGHTS = [
    // Easy (+100)
    { id: 'ww1', label: 'Yellow Car', icon: '🚕', tier: 'easy', pts: 100 },
    { id: 'ww2', label: 'Roof Cargo Box', icon: '🧳', tier: 'easy', pts: 100 },
    { id: 'ww3', label: 'Dog in a Car', icon: '🐕', tier: 'easy', pts: 100 },
    { id: 'ww4', label: 'Motorcycle', icon: '🏍️', tier: 'easy', pts: 100 },
    { id: 'ww5', label: 'Camper / RV', icon: '🚐', tier: 'easy', pts: 100 },
    { id: 'ww6', label: 'Construction Cones', icon: '🚧', tier: 'easy', pts: 100 },
    { id: 'ww7', label: 'Red Pickup Truck', icon: '🛻', tier: 'easy', pts: 100 },
    { id: 'ww8', label: 'Bridge / Overpass', icon: '🌉', tier: 'easy', pts: 100 },
    { id: 'ww9', label: 'Bike Rack on Car', icon: '🚲', tier: 'easy', pts: 100 },
    { id: 'ww10', label: 'Rest Area / Exit Sign', icon: '🪧', tier: 'easy', pts: 100 },
    { id: 'ww11', label: 'Tanker Truck', icon: '🚛', tier: 'easy', pts: 100 },
    { id: 'ww12', label: 'Convertible', icon: '🏎️', tier: 'easy', pts: 100 },
    { id: 'ww13', label: 'Bus / Coach', icon: '🚌', tier: 'easy', pts: 100 },
    { id: 'ww14', label: 'Bright Green Car', icon: '🟢', tier: 'easy', pts: 100 },
    { id: 'ww15', label: 'Coffee / Drive-Thru Sign', icon: '☕', tier: 'easy', pts: 100 },
    { id: 'ww16', label: 'Solar Panel or Windmill', icon: '🌬️', tier: 'easy', pts: 100 },

    // Medium (+200)
    { id: 'ww17', label: 'Vanity / Custom Plate', icon: '🔢', tier: 'med', pts: 200 },
    { id: 'ww18', label: 'Funny Bumper Sticker', icon: '😂', tier: 'med', pts: 200 },
    { id: 'ww19', label: 'Police / Patrol Car', icon: '🚓', tier: 'med', pts: 200 },
    { id: 'ww20', label: 'Truck Hauling Cars', icon: '🚗', tier: 'med', pts: 200 },
    { id: 'ww21', label: 'Out-of-Region Plate', icon: '🗺️', tier: 'med', pts: 200 },
    { id: 'ww22', label: 'Boat or Jet Ski Trailer', icon: '🚤', tier: 'med', pts: 200 },
    { id: 'ww23', label: 'Tow Truck in Action', icon: '🪝', tier: 'med', pts: 200 },
    { id: 'ww24', label: 'Billboard With Giant Face', icon: '😬', tier: 'med', pts: 200 },
    { id: 'ww25', label: 'Cows, Horses, or Sheep', icon: '🐄', tier: 'med', pts: 200 },
    { id: 'ww26', label: 'Purple or Orange Car', icon: '🟣', tier: 'med', pts: 200 },
    { id: 'ww27', label: 'Someone Singing in Car', icon: '🎤', tier: 'med', pts: 200 },
    { id: 'ww28', label: 'Kayak / Surfboard on Roof', icon: '🛶', tier: 'med', pts: 200 },
    { id: 'ww29', label: 'Food Truck', icon: '🌮', tier: 'med', pts: 200 },
    { id: 'ww30', label: 'Train or Railway Tracks', icon: '🚆', tier: 'med', pts: 200 },

    // Rare (+350)
    { id: 'ww31', label: 'Classic Vintage Car', icon: '🎩', tier: 'rare', pts: 350 },
    { id: 'ww32', label: 'Mismatched Car Door/Hood', icon: '🧩', tier: 'rare', pts: 350 },
    { id: 'ww33', label: 'Oversized Load Banner', icon: '⚠️', tier: 'rare', pts: 350 },
    { id: 'ww34', label: 'Tractor on or Near Road', icon: '🚜', tier: 'rare', pts: 350 },
    { id: 'ww35', label: 'Limousine or Supercar', icon: '💎', tier: 'rare', pts: 350 },
    { id: 'ww36', label: '3+ Identical Cars in a Row', icon: '🎰', tier: 'rare', pts: 350 },
    { id: 'ww37', label: 'Bird of Prey / Hawk', icon: '🦅', tier: 'rare', pts: 350 },
    { id: 'ww38', label: 'Mattress / Weird Roof Load', icon: '🛋️', tier: 'rare', pts: 350 }
  ];

  // 2. UNDERCOVER PASSENGER — 24 Categories x 8 Words = 192 Words
  const UNDERCOVER_PACKS = [
    {
      category: 'Gas Station Snacks',
      words: ['Beef Jerky', 'Slushie', 'Gummy Worms', 'Energy Drink', 'Nachos', 'Trail Mix', 'Corn Nuts', 'Glazed Donut']
    },
    {
      category: 'Things in a Car',
      words: ['Glovebox', 'Sun Visor', 'Spare Tire', 'Windshield Wipers', 'Cup Holder', 'Seatbelt', 'Rearview Mirror', 'Jump Starter']
    },
    {
      category: 'Fast Food Legends',
      words: ['McDonald\'s', 'KFC', 'Subway', 'Taco Bell', 'Burger King', 'Domino\'s', 'Wendy\'s', 'Starbucks']
    },
    {
      category: 'Roadside Attractions',
      words: ['Waterpark', 'Drive-In Movie', 'Diner', 'Flea Market', 'Mini Golf', 'Scenic Overlook', 'Haunted Motel', 'Souvenir Shop']
    },
    {
      category: 'Vacation Destinations',
      words: ['Tokyo', 'Paris', 'Iceland', 'Hawaii', 'New York', 'Rome', 'Rio de Janeiro', 'Cairo']
    },
    {
      category: 'Animals YouWouldn\'t Fight',
      words: ['Hippo', 'Polar Bear', 'Gorilla', 'Cassowary', 'Kangaroo', 'Honey Badger', 'Moose', 'Komodo Dragon']
    },
    {
      category: 'Superpowers',
      words: ['Invisibility', 'Teleportation', 'Time Travel', 'Mind Reading', 'Super Speed', 'Shapeshifting', 'Flight', 'Telekinesis']
    },
    {
      category: 'Movies Everyone Knows',
      words: ['Jurassic Park', 'Titanic', 'The Matrix', 'Shrek', 'Finding Nemo', 'Toy Story', 'Star Wars', 'Jaws']
    },
    {
      category: 'Camping Gear',
      words: ['Sleeping Bag', 'Flashlight', 'Swiss Army Knife', 'Hammock', 'Bug Spray', 'Campfire Grill', 'Compass', 'Cooler']
    },
    {
      category: 'Breakfast Foods',
      words: ['Pancakes', 'Croissant', 'Avocado Toast', 'Omelette', 'Waffles', 'Cinnamon Roll', 'Hash Browns', 'Bagel']
    },
    {
      category: 'Jobs & Careers',
      words: ['Firefighter', 'Pilot', 'Detective', 'Chef', 'Astronaut', 'Lifeguard', 'DJ', 'Stunt Double']
    },
    {
      category: 'Beach Day Essentials',
      words: ['Sunscreen', 'Flip-Flops', 'Beach Umbrella', 'Snorkel', 'Sandcastle', 'Surfboard', 'Volleyball', 'Ice Cream Cone']
    },
    {
      category: 'Video Game Icons',
      words: ['Mario Kart', 'Minecraft', 'Tetris', 'Pac-Man', 'Pokémon', 'The Sims', 'Grand Theft Auto', 'Zelda']
    },
    {
      category: 'Musical Instruments',
      words: ['Saxophone', 'Electric Guitar', 'Bagpipes', 'Bongos', 'Harmonica', 'Ukulele', 'Accordion', 'Grand Piano']
    },
    {
      category: 'Things at an Airport',
      words: ['Duty Free', 'Luggage Carousel', 'Passport Control', 'Window Seat', 'Boarding Pass', 'Metal Detector', 'Neck Pillow', 'Jet Lag']
    },
    {
      category: 'Pizza Toppings',
      words: ['Pineapple', 'Pepperoni', 'Jalapeños', 'Mushrooms', 'Anchovies', 'Extra Cheese', 'Black Olives', 'BBQ Chicken']
    },
    {
      category: 'Fairground & Theme Park',
      words: ['Roller Coaster', 'Bumper Cars', 'Cotton Candy', 'Ferris Wheel', 'House of Mirrors', 'Claw Machine', 'Drop Tower', 'Funnel Cake']
    },
    {
      category: 'Weather & Disasters',
      words: ['Tornado', 'Blizzard', 'Heatwave', 'Thunderstorm', 'Hailstorm', 'Dense Fog', 'Sandstorm', 'Rainbow']
    },
    {
      category: '90s & 2000s Nostalgia',
      words: ['Flip Phone', 'Tamagotchi', 'DVD Rental', 'Burned CD', 'Lava Lamp', 'Rollerblades', 'Ringtone', 'Disposable Camera']
    },
    {
      category: 'Desserts',
      words: ['Tiramisu', 'Cheesecake', 'Churros', 'Banana Split', 'Brownie', 'Gelato', 'Apple Pie', 'Crème Brûlée']
    }
  ];

  // 3A. HOT SEAT HIGHWAY — "Most Likely In This Car" Prompts
  const MOST_LIKELY_PROMPTS = [
    'Who in this car would insist "I know a shortcut" and add 45 minutes to the trip?',
    'If our car broke down in the desert, who is surviving the longest?',
    'Who in this car has the boldest (or most chaotic) AUX-cord music taste?',
    'If we got pulled over, who has the best chance of charming us out of a ticket?',
    'Who would spend $40 on bizarre snacks during a 3-minute bathroom stop?',
    'If this car entered a heist movie, who would accidentally trip the laser alarm?',
    'Who is most likely to fall asleep in 4 minutes flat and deny they were sleeping?',
    'If we won a free mystery flight leaving in 2 hours, who is packing fastest?',
    'Who in this car would start a conversation with a total stranger at a gas pump?',
    'If aliens abducted our car right now, who would they appoint as Earth\'s spokesperson?',
    'Who is most likely to confidently sing the completely wrong song lyrics?',
    'If we opened a roadside diner together, who would secretly eat half the profits?',
    'Who in this car would last the longest with zero phone or internet for a week?',
    'Who is most likely to adopt a stray animal we met at a rest stop?',
    'If we were contestants on a reality race across the continent, who is reading the map?',
    'Who would survive a zombie apocalypse purely through sheer luck?',
    'Who takes 47 photos of a sunset and posts zero of them?',
    'Who in this car would accidentally join a marathon just looking for a bathroom?',
    'If someone in this car were secretly an international spy, who is it?',
    'Who gets the worst "hangry" mood if lunch is delayed by 30 minutes?',
    'Who would win an argument against a GPS—and still go the wrong way?',
    'Who in this car packs 14 outfits for a 2-day weekend trip?',
    'If our road trip became a documentary, who gives the most dramatic confessional interviews?',
    'Who is first to shout "COWS!" every single time we pass a pasture?'
  ];

  // 3B. HOT SEAT HIGHWAY — "Read the Passenger" Spotlight Dilemmas
  const SPOTLIGHT_DILEMMAS = [
    {
      prompt: '{name} gets a free 60-second sprint inside a mega gas station. Which aisle do they hit FIRST?',
      options: ['🧂 Salty Chips & Jerky', '🍫 Candy & Chocolate', '🥤 Cold Drinks & Slushies', '🕶️ Weird Gadgets & Sunglasses']
    },
    {
      prompt: 'We let {name} pick the next 2 hours of audio for the whole car. What are they putting on?',
      options: ['🎸 Throwback Sing-Along Bangers', '🔪 True Crime / Mystery Podcast', '🎧 Chill Indie / Electronic Vibes', '🤣 Stand-Up Comedy Clips']
    },
    {
      prompt: '{name} finds an envelope with $500 cash at a rest stop (no ID anywhere). What do they genuinely do?',
      options: ['🍽️ Upgrade Tonight\'s Dinner for Everyone', '🤫 Pocket It for Savings', '🏢 Hand It to Rest Stop Staff', '🎰 Put It All on One Crazy Adventure']
    },
    {
      prompt: 'The hotel accidentally double-booked us and offers {name} four weird alternatives. Which one do they pick?',
      options: ['⛺ Luxury Glamping Tent Under Stars', '🏰 Slightly Haunted Historic Inn', '🚐 Retro Camper Van by a Lake', '🛎️ Tiny Capsule Pod + Free Spa']
    },
    {
      prompt: 'What is {name}\'s biggest secret pet peeve on a long car ride?',
      options: ['🥶 Freezing AC Blasting Their Face', '⏭️ Skipping Songs After 30 Seconds', '🍟 Crunchy Crumbs Everywhere', '🗺️ Backseat Driving Advice']
    },
    {
      prompt: 'If {name} could teleport skip ONE unpleasant thing forever, which would they erase?',
      options: ['🚦 Rush-Hour Traffic Jams', '✈️ Middle Seats on Flights', '🧺 Folding Laundry', '⏰ Waking Up Before 7 AM']
    },
    {
      prompt: 'We pass a bizarre roadside sign. Which attraction is {name} begging us to pull over for?',
      options: ['🦖 World\'s Largest Fiberglass Dinosaur', '🥧 Secret Grandma Pie Bakery', '🛸 UFO Museum & Gift Shop', '🐐 Baby Goat Petting Farm']
    },
    {
      prompt: 'In an action movie chase scene, what role is {name} playing?',
      options: ['🛞 Calm Getaway Driver', '💻 Frantic Laptop Hacker in Back', '🎭 Master of Disguise Distraction', '🍿 Eating Snacks Asking "Are We Good?"']
    },
    {
      prompt: '{name} has to eat ONLY one road-trip meal format for the rest of the trip:',
      options: ['🍔 Burgers & Fries', '🌮 Tacos & Burritos', '🍕 Wood-Fired Pizza', '🥪 Loaded Deli Sandwiches']
    },
    {
      prompt: 'It\'s midnight on an empty highway. What topic gets {name} talking nonstop for an hour?',
      options: ['🌌 Space, Time & Conspiracy Theories', '🎬 Movies/Shows Hot Takes', '💼 Wild Life Stories & Lore', '🏝️ Dream Future Plans & Travel']
    },
    {
      prompt: 'Which fictional vehicle would {name} pick as their daily driver?',
      options: ['⏳ Back to the Future DeLorean', '🦇 The Batmobile', '🚐 Scooby-Doo Mystery Machine', '🏎️ Mario Kart Rainbow Kart']
    },
    {
      prompt: 'How early does {name} ACTUALLY want to arrive at the airport?',
      options: ['🏃 Sprinting as Gate Closes', '😎 Smooth 75 Minutes Before', '☕ Solid 2.5 Hours + Lounge Snack', '🏕️ 4 Hours Early Just in Case']
    }
  ];

  // 4. VIBE CHECK — 1 to 10 Spectrums
  const VIBE_SPECTRUMS = [
    { left: 'Terrible Road Trip Snack', right: 'God-Tier Road Trip Snack', hint: 'Name one food or drink!' },
    { left: 'Total Waste of Money', right: 'Worth Every Single Penny', hint: 'Name a product, purchase, or upgrade!' },
    { left: 'Worst Song for Karaoke', right: 'Ultimate Car Sing-Along', hint: 'Name a song or artist!' },
    { left: 'Mildly Annoying Habit', right: 'Immediate Straight-to-Jail Offense', hint: 'Name a everyday behavior!' },
    { left: 'Overrated Tourist Trap', right: 'Bucket-List Must Visit', hint: 'Name a place or attraction!' },
    { left: 'Useless Superpower', right: 'Completely Overpowered', hint: 'Invent or name one ability!' },
    { left: 'Worst First Date Idea', right: 'Legendary First Date Idea', hint: 'Describe a date activity!' },
    { left: 'Harmless White Lie', right: 'Unforgivable Betrayal', hint: 'Give an example sentence!' },
    { left: 'Movie You Fall Asleep To', right: 'Edge-of-Your-Seat Masterpiece', hint: 'Name a movie or genre!' },
    { left: 'Chill & Relaxing Hobby', right: 'Unhinged Extreme Chaos', hint: 'Name a hobby or sport!' },
    { left: 'Thing Nobody Actually Needs', right: 'Couldn\'t Survive a Day Without It', hint: 'Name an everyday item!' },
    { left: 'Awkward Text to Receive', right: 'Best Text Ever to Receive', hint: 'Say the text message out loud!' },
    { left: 'Easy Animal to Beat in a Race', right: 'Zero Chance You\'re Winning', hint: 'Name an animal + terrain!' },
    { left: 'Terrible Excuse for Being Late', right: '100% Believable Masterclass Excuse', hint: 'Say the excuse out loud!' },
    { left: 'Food That\'s Weird Cold', right: 'Even Better Cold the Next Day', hint: 'Name a dish!' },
    { left: 'Smallest Flex', right: 'Biggest Subtle Flex', hint: 'Name something people brag about!' },
    { left: 'Worst Thing Driver Can Say', right: 'Most Reassuring Thing Driver Can Say', hint: 'Say a quote from the driver\'s seat!' },
    { left: 'Zero Survival Skills Needed', right: 'Bear Grylls Level Hardcore', hint: 'Name an outdoor situation!' },
    { left: 'Forgotten in 5 Minutes', right: 'Core Childhood Memory', hint: 'Name a toy, game, or experience!' },
    { left: 'Tastes Like Cardboard', right: 'Pure Culinary Heaven', hint: 'Name a specific food!' }
  ];

  // 5. SPEED TRAP — Forbidden Word Cards
  const SPEED_TRAP_CARDS = [
    { word: 'CRUISE CONTROL', taboo: ['Speed', 'Button', 'Pedal', 'Highway'] },
    { word: 'DRIVE-THRU', taboo: ['Window', 'Fast Food', 'Order', 'Microphone'] },
    { word: 'PARALLEL PARKING', taboo: ['Curb', 'Reverse', 'Sidewalk', 'Space'] },
    { word: 'KARAOKE', taboo: ['Sing', 'Microphone', 'Lyrics', 'Music'] },
    { word: 'ROUNDABOUT', taboo: ['Circle', 'Turn', 'Exit', 'Traffic'] },
    { word: 'SUNBURN', taboo: ['Beach', 'Red', 'Sunscreen', 'Peel'] },
    { word: 'SPEED TRAP', taboo: ['Police', 'Radar', 'Ticket', 'Fast'] },
    { word: 'SHOTGUN', taboo: ['Front', 'Seat', 'Passenger', 'Driver'] },
    { word: 'HITCHHIKER', taboo: ['Thumb', 'Ride', 'Stranger', 'Road'] },
    { word: 'BUMPER STICKER', taboo: ['Back', 'Car', 'Funny', 'Glue'] },
    { word: 'JET LAG', taboo: ['Time Zone', 'Sleep', 'Flight', 'Tired'] },
    { word: 'GLOVEBOX', taboo: ['Dashboard', 'Front', 'Manual', 'Store'] },
    { word: 'POTHOLES', taboo: ['Bump', 'Road', 'Tire', 'Asphalt'] },
    { word: 'CAMPFIRE', taboo: ['Wood', 'Marshmallow', 'Smoke', 'Tent'] },
    { word: 'TOLL BOOTH', taboo: ['Pay', 'Money', 'Highway', 'Gate'] },
    { word: 'JUMPER CABLES', taboo: ['Battery', 'Dead', 'Red', 'Spark'] },
    { word: 'BLIND SPOT', taboo: ['Mirror', 'Look', 'Lane', 'Shoulder'] },
    { word: 'ESPRESSO', taboo: ['Coffee', 'Shot', 'Caffeine', 'Italian'] },
    { word: 'GUACAMOLE', taboo: ['Avocado', 'Chips', 'Green', 'Mexican'] },
    { word: 'ROLLER COASTER', taboo: ['Loop', 'Scream', 'Track', 'Theme Park'] },
    { word: 'PASSPORT', taboo: ['Border', 'Stamp', 'Country', 'Photo'] },
    { word: 'AIR CONDITIONING', taboo: ['Cold', 'Vent', 'Summer', 'Fan'] },
    { word: 'WINDSHIELD', taboo: ['Glass', 'Wipers', 'Bug', 'Front'] },
    { word: 'CARPOOL', taboo: ['Share', 'Work', 'Lane', 'Together'] },
    { word: 'TAILGATING', taboo: ['Close', 'Behind', 'Bumper', 'Follow'] },
    { word: 'SOUVENIR', taboo: ['Gift', 'Magnet', 'Remember', 'Trip'] },
    { word: 'FLAT TIRE', taboo: ['Spare', 'Jack', 'Air', 'Nail'] },
    { word: 'GPS / SAT-NAV', taboo: ['Map', 'Turn', 'Voice', 'Phone'] },
    { word: 'CAR WASH', taboo: ['Soap', 'Brushes', 'Water', 'Clean'] },
    { word: 'REST STOP', taboo: ['Bathroom', 'Highway', 'Vending', 'Break'] },
    { word: 'SUNGLASSES', taboo: ['Eyes', 'Bright', 'Shade', 'UV'] },
    { word: 'SNORING', taboo: ['Sleep', 'Loud', 'Nose', 'Night'] },
    { word: 'ICEBREAKER', taboo: ['Question', 'Awkward', 'Ship', 'Conversation'] },
    { word: 'DEJA VU', taboo: ['Again', 'Before', 'Memory', 'Feeling'] },
    { word: 'VENDING MACHINE', taboo: ['Coins', 'Stuck', 'Snacks', 'Buttons'] },
    { word: 'BRAIN FREEZE', taboo: ['Cold', 'Ice Cream', 'Slushie', 'Headache'] },
    { word: 'CLIFFHANGER', taboo: ['Ending', 'Episode', 'Next', 'Suspense'] },
    { word: 'PHOTOBOMB', taboo: ['Picture', 'Background', 'Camera', 'Ruined'] },
    { word: 'BACKSEAT DRIVER', taboo: ['Annoying', 'Advice', 'Brake', 'Tell'] },
    { word: 'BUFFET', taboo: ['All You Can Eat', 'Plate', 'Line', 'Food'] }
  ];

  const GAMES_META = [
    {
      id: 'window-wars',
      title: 'Window Wars',
      tag: '👀 Out the Window',
      players: '3–4 Ideal',
      duration: 'Live Bingo',
      accent: '#06d6a0',
      summary: 'Spot real cars, signs & chaos out the car window! Claim tiles & nail 3-in-a-row Bingos.'
    },
    {
      id: 'undercover',
      title: 'Undercover Passenger',
      tag: '🕵️ Social Deduction',
      players: '3–6 Players',
      duration: '4 min',
      accent: '#ff4d6d',
      summary: 'Everyone gets the secret word except ONE Impostor in the car. Give 1-word clues & catch the fake!'
    },
    {
      id: 'hot-seat',
      title: 'Hot Seat Highway',
      tag: '🔥 Crew Votes',
      players: '3–6 Players',
      duration: '5 Rounds',
      accent: '#ff9f1c',
      summary: 'Hilarious "Most Likely in This Car" votes mixed with mind-reading predictions about your crew!'
    },
    {
      id: 'vibe-check',
      title: 'Vibe Check 1–10',
      tag: '🎚️ Hot-Take Dial',
      players: '3–6 Players',
      duration: '1 Turn Each',
      accent: '#4cc9f0',
      summary: 'One player gets a secret number from 1–10 and gives a hot-take clue. How well can the car read their brain?'
    },
    {
      id: 'speed-trap',
      title: 'Speed Trap',
      tag: '🚨 Fast Buzzer',
      players: '3–6 Players',
      duration: '35s Blitz',
      accent: '#b57cff',
      summary: 'Describe the word before the horn blows WITHOUT saying the 4 forbidden words—friends hold the live buzzer!'
    }
  ];

  global.GameData = {
    AVATARS,
    GAMES_META,
    WINDOW_WARS_SIGHTS,
    UNDERCOVER_PACKS,
    MOST_LIKELY_PROMPTS,
    SPOTLIGHT_DILEMMAS,
    VIBE_SPECTRUMS,
    SPEED_TRAP_CARDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
