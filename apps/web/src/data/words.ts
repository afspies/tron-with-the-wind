/**
 * Curated word list for room codes.
 * All words are 4-8 characters, easy to spell/say, and fun/thematic.
 */
export const ROOM_WORDS = [
  // Speed & movement
  'BOLT', 'DASH', 'FLASH', 'BLAZE', 'SURGE', 'RUSH', 'SWIFT', 'ZOOM',
  'DRIFT', 'GLIDE', 'TURBO', 'NITRO', 'RAPID', 'ROCKET', 'LAUNCH',
  'SPRINT', 'SONIC', 'CRUISE', 'CHARGE', 'BOOST',

  // Light & energy
  'SPARK', 'GLOW', 'BEAM', 'PULSE', 'FLARE', 'PRISM', 'NEON', 'LASER',
  'PHOTON', 'PLASMA', 'VOLT', 'WATT', 'TESLA', 'EMBER', 'RADIANT',
  'AURORA', 'LUMEN', 'SHINE', 'BLITZ', 'STROBE',

  // Power & strength
  'TITAN', 'FORCE', 'POWER', 'STORM', 'THUNDER', 'STRIKE', 'CLASH',
  'IMPACT', 'FURY', 'RAGE', 'HAMMER', 'ANVIL', 'STEEL', 'IRON',
  'MIGHTY', 'BRAVE', 'BOLD', 'FIERCE', 'VALIANT', 'VIGOR',

  // Nature & elements
  'FROST', 'FLAME', 'RIVER', 'STONE', 'OCEAN', 'WIND', 'CLOUD',
  'SHADOW', 'SOLAR', 'LUNAR', 'COMET', 'METEOR', 'STAR', 'NOVA',
  'NEBULA', 'QUAKE', 'TIDAL', 'BREEZE', 'GUST', 'MONSOON',

  // Fantasy & adventure
  'KNIGHT', 'DRAGON', 'WIZARD', 'ROGUE', 'QUEST', 'LEGEND', 'MYTH',
  'PHOENIX', 'GRIFFIN', 'RAVEN', 'FALCON', 'HAWK', 'WOLF', 'LION',
  'TIGER', 'VIPER', 'COBRA', 'PANTHER', 'JAGUAR', 'RAPTOR',

  // Tech & cyber
  'CYBER', 'PIXEL', 'VECTOR', 'MATRIX', 'BINARY', 'BYTE', 'CODE',
  'GRID', 'NEXUS', 'VERTEX', 'CIRCUIT', 'SIGNAL', 'RELAY', 'SYNC',
  'RENDER', 'GLITCH', 'HACK', 'CIPHER', 'CRYPTO', 'QUANTUM',

  // Space & cosmic
  'ORBIT', 'COSMIC', 'GALAXY', 'ZENITH', 'APEX', 'VOID', 'ASTRAL',
  'PULSAR', 'QUASAR', 'WARP', 'HYPER', 'RIFT', 'PORTAL', 'VORTEX',
  'ECLIPSE', 'HORIZON', 'COSMOS', 'ABYSS', 'STELLAR', 'RADIAL',

  // Battle & competition
  'ARENA', 'COMBAT', 'DUEL', 'RIVAL', 'VICTOR', 'TROPHY', 'CROWN',
  'SHIELD', 'SWORD', 'SPEAR', 'LANCE', 'BLADE', 'SABER', 'ARROW',
  'SNIPER', 'HUNTER', 'SIEGE', 'RAID', 'AMBUSH', 'BLITZ',

  // Cool adjectives
  'EPIC', 'PRIME', 'OMEGA', 'ALPHA', 'ULTRA', 'MEGA', 'SUPER',
  'HYPER', 'STEALTH', 'PHANTOM', 'GHOST', 'SPECTRAL', 'MYSTIC',
  'ARCANE', 'ANCIENT', 'ETERNAL', 'PRIMAL', 'CHAOS', 'REGAL', 'ROYAL',

  // Terrain & places
  'CANYON', 'SUMMIT', 'RIDGE', 'PEAK', 'CRATER', 'VALLEY', 'GORGE',
  'CLIFF', 'MESA', 'TUNDRA', 'JUNGLE', 'ISLAND', 'OASIS', 'REEF',
  'LAGOON', 'RAVINE', 'GLACIER', 'DELTA', 'STEPPE', 'GROVE',

  // Materials & gems
  'RUBY', 'JADE', 'ONYX', 'TOPAZ', 'OPAL', 'AMBER', 'PEARL',
  'COBALT', 'CHROME', 'BRONZE', 'COPPER', 'SILVER', 'GOLDEN', 'CRYSTAL',
  'DIAMOND', 'QUARTZ', 'OBSIDIAN', 'MARBLE', 'GRANITE', 'TITANIUM',

  // Action words
  'SMASH', 'CRUSH', 'BREAK', 'SHATTER', 'BLAST', 'BURST', 'ERUPT',
  'IGNITE', 'DETONATE', 'EXPLODE', 'RUMBLE', 'ROAR', 'HOWL', 'ECHO',
  'THUNDER', 'CRACKLE', 'SIZZLE', 'SCORCH', 'BURN', 'FREEZE',

  // Animals & creatures
  'SHARK', 'EAGLE', 'BEAR', 'BULL', 'STAG', 'LYNX', 'PUMA',
  'MANTIS', 'HORNET', 'SCORPION', 'SPIDER', 'KRAKEN', 'HYDRA',
  'CHIMERA', 'MINOTAUR', 'PEGASUS', 'UNICORN', 'BASILISK', 'WYVERN', 'DRAKE',

  // Tron-themed
  'CYCLE', 'TRAIL', 'GRID', 'DISC', 'PROGRAM', 'USER', 'ARENA',
  'LEGACY', 'RINZLER', 'TRACE', 'SECTOR', 'KERNEL', 'DAEMON', 'LOOP',
  'NODE', 'ARRAY', 'STACK', 'QUEUE', 'BUFFER', 'CACHE',

  // Music & sound
  'BASS', 'TEMPO', 'RHYTHM', 'CHORD', 'MELODY', 'SONIC', 'TREBLE',
  'OCTAVE', 'FORTE', 'PIANO', 'DRUM', 'CYMBAL', 'HORN', 'SIREN',
  'WHISTLE', 'CHIME', 'GONG', 'BASS', 'RIFF', 'ANTHEM',

  // Weather & atmosphere
  'HAZE', 'MIST', 'FOG', 'RAIN', 'SLEET', 'HAIL', 'SNOW',
  'ICE', 'BLIZZARD', 'TORNADO', 'CYCLONE', 'TYPHOON', 'SQUALL', 'TEMPEST',
  'NIMBUS', 'CUMULUS', 'STRATUS', 'CIRRUS', 'ZEPHYR', 'SIROCCO',

  // Miscellaneous cool words
  'MAGMA', 'LAVA', 'PLASMA', 'FUSION', 'FISSION', 'NEUTRON', 'PROTON',
  'ION', 'ATOM', 'HELIX', 'SPIRAL', 'PRONG', 'CLAW', 'FANG',
  'TALON', 'THORN', 'BARB', 'SPIKE', 'SHARD', 'SPLINTER',

  // Mythology
  'ODIN', 'THOR', 'LOKI', 'ZEUS', 'ARES', 'ATLAS', 'TITAN',
  'APOLLO', 'HERMES', 'HADES', 'POSEIDON', 'ATHENA', 'ARTEMIS', 'HELIOS',
  'CHRONOS', 'MORPHEUS', 'ICARUS', 'ACHILLES', 'SPARTACUS', 'MINERVA',

  // Colors & visual
  'SCARLET', 'CRIMSON', 'INDIGO', 'VIOLET', 'MAGENTA', 'CYAN', 'TEAL',
  'IVORY', 'EBONY', 'AZURE', 'CORAL', 'SAGE', 'OCHRE', 'UMBER',
  'SIENNA', 'MAUVE', 'PEWTER', 'SLATE', 'CHARCOAL', 'SHADOW',
];

export function getRandomWord(): string {
  return ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)];
}
