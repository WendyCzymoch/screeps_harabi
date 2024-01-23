const config = {}

const shardName = Game.shard.name
config.shard = shardName

const wolrdShardNames = ['shard0', 'shard1', 'shard2', 'shard3']
const isWorld = wolrdShardNames.includes(shardName)

// Allies


if (shardName === 'swc') {
  config.allies = [

  ]
} else if (isWorld) {
  config.allies = [

  ]
} else {
  config.allies = []
}

// economy standard

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

// Boosts to make

if (shardName === 'swc') {
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
} else {
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
}

// harass ?
if (shardName === 'swc') {
  config.harass = true
} else {
  config.harass = false
}

// quad and duo settings
config.duo = {
  IGNORE_TOWER_DAMAGE: true,
  IGNORE_DAMAGE: true,
  IMPORTANT_STRUCTURE_TYPES: ['spawn', 'tower'],
}

config.quad = {
  IGNORE_DAMAGE_WHEN_PATHING: true,
  QUAD_COST_VISUAL: false,
  BULLDOZE_COST_VISUAL: false,
  IMPORTANT_STRUCTURE_TYPES: ['spawn', 'tower'],
  HEAL_BUFFER: 100
}

config.RCL_THRESHOLD_TO_SAFEMODE = 5

// Tasks
if (shardName === 'swc') {
  config.task = {
    powerBank: false,
    deposit: true,
    harass: true
  }
} else {
  config.task = {
    powerBank: true,
    deposit: true,
    harass: false
  }
}

// Remote
config.DISTANCE_TO_REMOTE = 1

// energy thresholds

config.energyLevel = {
  REACT_TO_NUKES: 20,

  CONSTRUCT: 30,

  STOP_SIEGE: 40,

  RAMPART_LOW: 50,

  BE_HELPED: 60,

  HELP: 90,

  UPGRADE: 100,
  HIGHWAY: 100,

  FUNNEL: 120,
  RAMPART_MIDDLE: 120,

  FILL_NUKER: 140,

  OPERATE_POWER_SPAWN: 160,

  RAMPART_HIGH: 170,

  STOP_FUNNEL: 180,
}

module.exports = {
  config
}