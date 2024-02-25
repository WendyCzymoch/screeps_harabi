const config = {}

const shardName = Game.shard.name
config.shard = shardName

if (shardName === 'swc') {
  config.allies = []

  config.task = {
    powerBank: false,
    deposit: true,
  }

  config.harass = true

  config.economyStandard = {
    1: 10000,
    2: 10000,
    3: 10000,
    4: 20000,
    5: 40000,
    6: 80000,
    7: 160000,
    8: 320000,
  }

  config.compoundGoal = {
    // for defense, ant
    XUH2O: 2000,
    UH2O: 1000,
    UH: 1000,

    // for blinky quad
    XKHO2: 3000,
    XLHO2: 4000,
    XZHO2: 2000,
    XGHO2: 1000,

    KHO2: 1500,
    LHO2: 1000,
    ZHO2: 1000,

    KO: 1000,
    LO: 1000,
    ZO: 2000,

    // for worm
    ZH: 1500,
    ZH2O: 1500,
    XZH2O: 1500,
  }

  config.notBuild = ['powerSpawn', 'nuker']

  config.rampartLevel = 4

  config.alwaysShowMapInfo = true

  config.publicRamparts = true

  config.rampartHitsPerRclSquare = 16000

  config.distanceToRemote = 2

  config.alwaysShowDashboard = true
} else if (shardName === 'shardSeason') {
  config.allies = []

  config.task = {
    powerBank: false,
    deposit: false,
  }

  config.harass = false

  config.compoundGoal = {
    // for defense, ant
    XUH2O: 2000,
    UH2O: 1000,
    UH: 1000,

    // for blinky quad
    XKHO2: 3000,
    XLHO2: 4000,
    XZHO2: 2000,
    XGHO2: 1000,

    KHO2: 1500,
    LHO2: 1000,
    ZHO2: 1000,

    KO: 1000,
    LO: 1000,
    ZO: 2000,

    // for worm
    ZH: 1500,
    ZH2O: 1500,
    XZH2O: 1500,

    // upgrade
    XGH2O: 1000,

    // nuker
    G: 1000,
  }

  config.economyStandard = {
    1: 10000,
    2: 10000,
    3: 10000,
    4: 20000,
    5: 40000,
    6: 80000,
    7: 160000,
    8: 320000,
  }

  config.rampartLevel = 4

  config.market = false

  config.notBuild = ['nuker', 'powerSpawn']

  config.labConstructLevel = 7

  config.alwaysShowMapInfo = false

  config.publicRamparts = false

  config.seasonNumber = 6

  config.rampartHitsPerRclSquare = 5000

  config.blockUpragade = false

  config.distanceToRemote = 2
} else if (['shard0', 'shard1', 'shard2', 'shard3'].includes(shardName)) {
  // world
  config.isWorld = true

  config.allies = []

  config.task = {
    powerBank: true,
    deposit: true,
  }

  config.harass = false

  config.buyPixel = true

  config.compoundGoal = {
    // for defense, ant
    XUH2O: 4000,
    UH2O: 1000,
    UH: 1000,

    // for blinky quad
    XKHO2: 6000,
    XLHO2: 8000,
    XZHO2: 4000,
    XGHO2: 2000,

    KHO2: 1500,
    LHO2: 1000,
    ZHO2: 1000,

    KO: 1000,
    LO: 1000,
    ZO: 2000,

    // for worm
    ZH: 1500,
    ZH2O: 1500,
    XZH2O: 1500,

    // repair
    XLH2O: 6000,

    // upgrade
    XGH2O: 6000,

    // nuker
    G: 5000,
  }

  config.economyStandard = {
    1: 10000,
    2: 10000,
    3: 10000,
    4: 20000,
    5: 40000,
    6: 80000,
    7: 160000,
    8: 320000,
  }

  config.rampartLevel = 4

  config.creditGoal = 3000000000

  config.alwaysShowMapInfo = false

  config.publicRamparts = false

  config.rampartHitsPerRclSquare = 16000

  config.distanceToRemote = 2

  config.shards = ['shard0', 'shard1', 'shard2', 'shard3']
} else {
  // local
  config.allies = []

  config.task = {
    powerBank: false,
    deposit: false,
  }

  config.harass = false

  config.buyPixel = false

  config.compoundGoal = {
    // for defense, ant
    XUH2O: 4000,
    UH2O: 1000,
    UH: 1000,

    // for blinky quad
    XKHO2: 6000,
    XLHO2: 8000,
    XZHO2: 4000,
    XGHO2: 2000,

    KHO2: 1500,
    LHO2: 1000,
    ZHO2: 1000,

    KO: 1000,
    LO: 1000,
    ZO: 2000,

    // for worm
    ZH: 1500,
    ZH2O: 1500,
    XZH2O: 1500,

    // repair
    XLH2O: 6000,

    // upgrade
    XGH2O: 6000,

    // nuker
    G: 5000,
  }

  config.economyStandard = {
    1: 6000,
    2: 6000,
    3: 6000,
    4: 12000,
    5: 24000,
    6: 48000,
    7: 96000,
    8: 192000,
  }

  config.rampartLevel = 5

  config.alwaysShowMapInfo = true

  config.publicRamparts = false

  config.showTicks = true

  config.rampartHitsPerRclSquare = 16000

  config.distanceToRemote = 2

  config.diplomacy = true
}

// quad and duo settings
config.IMPORTANT_STRUCTURE_TYPES = [
  STRUCTURE_SPAWN,
  STRUCTURE_TOWER,
  STRUCTURE_STORAGE,
  STRUCTURE_TERMINAL,
  STRUCTURE_INVADER_CORE,
]

config.duo = {
  IGNORE_TOWER_DAMAGE: true,
  IGNORE_DAMAGE: true,
}

config.quad = {
  IGNORE_DAMAGE_WHEN_PATHING: true,
  QUAD_COST_VISUAL: false,
  BULLDOZE_COST_VISUAL: false,
  HEAL_BUFFER: 100,
}

config.RCL_THRESHOLD_TO_SAFEMODE = 2

// energy thresholds

config.energyLevel = {
  REACT_TO_NUKES: 20,

  CONSTRUCT: 30,

  STOP_SIEGE: 40,

  RAMPART_LOW: 50,

  BE_HELPED: 60,

  HELP: 90,

  UPGRADE: 100,

  FUNNEL: 110,

  DEPOSIT: 120,

  RAMPART_MIDDLE: 130,

  FILL_NUKER: 140,

  OPERATE_POWER_SPAWN: 150,

  POWERBANK: 160,

  BATTERY_EAT: 170,

  STOP_FUNNEL: 200,

  RAMPART_HIGH: 210,

  BATTERY_COOK: 240,

  STOP_BALANCE: 250,

  BALANCE: 300,
}

// diplomacy

config.hateLevel = {
  harass: 1,
  invasion: 30,
  murder: 500,
  toHarass: 500,
  toInvade: 20000,
}

module.exports = {
  config,
}
