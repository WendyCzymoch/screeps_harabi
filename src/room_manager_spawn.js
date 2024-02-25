const { config } = require('./config')
const { blinkyBodyMaker } = require('./creep_prototype_blinky')

const RAMPART_HITS_THRESHOLD = 50000000 //50M

const RAMPART_HITS_ENOUGH = config.rampartHitsPerRclSquare * 120

global.MANAGER_MAX_CARRY = 16

global.EMERGENCY_WORK_MAX = 100

const SPAWN_ORDER = [
  'miner',

  'managerUrgent',

  'hauler',

  'roomDefender',

  'attacker',
  'healer',

  'manager',
  'distributor',
  'scouter',

  'minerNotUrgent',

  'colonyDefender',

  'claimer',
  'pioneer',

  'powerBankAttacker',
  'powerBankHealer',
  'highwayHauler',

  'depositWorker',

  'guard',
  'sourceKeeperHandler',
  'coreAttacker',

  'laborerUrgent',

  'reserver',
  'remoteMiner',
  'remoteBuilder',
  'remoteHauler',
  'mineralHauler',

  'extractor',
  'laborer',
  'wallMaker',

  'harasser',
  'researcher',

  'dismantler',
  'looter',
]

global.SPAWN_PRIORITY = {}

for (let i = 0; i < SPAWN_ORDER.length; i++) {
  const role = SPAWN_ORDER[i]
  SPAWN_PRIORITY[role] = i + 1
}

Room.prototype.manageSpawn = function () {
  if (!this.hasAvailableSpawn()) {
    return ERR_BUSY
  }

  if (!this.structures.tower.length && this.findHostileCreeps().length && !this.creeps.colonyDefender.length) {
    this.requestColonyDefender(this.name, { doCost: false })
  }

  // manager 생산. 전시에는 무조건 생산
  const maxNumManager = this.getMaxNumManager()
  if (maxNumManager > 0) {
    const managers = this.creeps.manager.filter((creep) => (creep.ticksToLive || 1500) > 3 * creep.body.length)
    const researchers = this.creeps.researcher.filter((creep) => (creep.ticksToLive || 1500) > 3 * creep.body.length)

    if (managers.length + researchers.length < maxNumManager) {
      this.requestManager(MANAGER_MAX_CARRY, { isUrgent: managers.length <= 0 || this.heap.isEnemy })
    } else {
      this.enoughManager = true
    }

    this.visual.text(
      `📤${managers.length + researchers.length}/${maxNumManager}`,
      this.storage.pos.x - 2.9,
      this.storage.pos.y + 1.75,
      { font: 0.5, align: 'left' }
    )
  }

  // distributor
  if (this.controller.level >= 5 && this.getHubCenterPos()) {
    const numDistributor = this.creeps.distributor.filter(
      (creep) => (creep.ticksToLive || 1500) > 3 * creep.body.length - 2
    ).length
    if (numDistributor === 0) {
      this.requestDistributor()
    }
  }

  // builder 생산
  const repairingForNuke = this.isReactingToNukes() && this.energyLevel > config.energyLevel.REACT_TO_NUKES

  const builders = this.creeps.laborer.filter((creep) => {
    if (!creep.memory.isBuilder) {
      return false
    }
    if ((creep.ticksToLive || 1500) < 3 * creep.body.length) {
      return false
    }
    return true
  })

  const numWorkBuild = builders
    .map((creep) => creep.body.filter((part) => part.type === WORK).length)
    .reduce((acc, curr) => acc + curr, 0)

  const canBoost = this.terminal && this.structures.lab.length > 0

  if (repairingForNuke) {
    if (numWorkBuild < EMERGENCY_WORK_MAX) {
      const boost = canBoost && this.hasEnoughCompounds('XLH2O') ? 'XLH2O' : undefined
      this.requestLaborer({ maxWork: 16, boost, isBuilder: true })
    }
  } else if (this.constructionSites.length > 0) {
    if (numWorkBuild < 2 * this.controller.level) {
      this.requestLaborer({ maxWork: 10, isBuilder: true })
    }
  }

  // laborer 생산

  let maxWork = this.maxWork

  const maxNumLaborer = Math.min(this.controller.available, Math.ceil(maxWork / this.laborer.numWorkEach))
  const numLaborer = this.creeps.laborer.filter((creep) => (creep.ticksToLive || 1500) > 3 * creep.body.length).length
  const numWorkEach = Math.ceil(maxWork / maxNumLaborer)

  // source 가동률만큼만 생산
  if (TRAFFIC_TEST) {
    if (numLaborer < this.controller.available && this.laborer.numWork < maxWork) {
      this.requestLaborer({ maxWork: 1 })
    }
  } else if (numLaborer < this.controller.available && this.laborer.numWork < maxWork) {
    let doBoost = undefined

    if (canBoost) {
      const funnelRequest = Overlord.getBestFunnelRequest()

      if (config.isWorld || this.controller.level < 8) {
        if (!funnelRequest || funnelRequest.roomName === this.name) {
          const resourceAmountsTotal = Overlord.getResourceAmountsTotal()
          doBoost = resourceAmountsTotal && (resourceAmountsTotal['XGH2O'] || 0) >= numWorkEach * LAB_BOOST_MINERAL
        }
      }
    }

    if (doBoost) {
      this.requestLaborer({ maxWork: numWorkEach, boost: 'XGH2O' })
    } else {
      let numWork = maxWork - this.laborer.numWork

      if (numLaborer >= maxNumLaborer) {
        numWork = numWorkEach
      }

      this.requestLaborer({ maxWork: numWork })
    }
  }

  this.visual.text(`🛠️${this.laborer.numWork}/${maxWork}`, this.controller.pos.x + 0.75, this.controller.pos.y - 0.5, {
    align: 'left',
  })

  // researcher 생산
  if (this.heap.needResearcher) {
    if (this.creeps.researcher.filter((creep) => (creep.ticksToLive || 1500 > 3) * creep.body.length).length < 1) {
      if (this.enoughManager === true) {
        const candidate = this.creeps.manager.sort((a, b) => (b.ticksToLive || 0) - (a.ticksToLive || 0))[0]
        candidate.say(`📤➡️🧪`, true)
        candidate.memory.role = 'researcher'
      } else {
        this.requestResearcher()
      }
    }
  }

  // 여기서부터는 전시에는 생산 안함
  if (!this.memory.militaryThreat) {
    // extractor 생산
    if (
      this.terminal &&
      this.structures.extractor.length &&
      this.mineral.mineralAmount > 0 &&
      this.terminal.store.getFreeCapacity() > 50000 &&
      this.terminal.store[this.mineral.mineralType] < 100000
    ) {
      if (this.creeps.extractor.filter((creep) => (creep.ticksToLive || 1500) > 3 * creep.body.length).length === 0) {
        this.requestExtractor()
      }
    }

    // wallMaker 생산
    if (this.creeps.wallMaker.length < this.getDesiredWallMakerCount()) {
      this.requestWallMaker()
    }
  }

  // manage spawn
  const queue = this.spawnQueue.sort((a, b) => a.priority - b.priority)

  const spawns = new Array(...this.structures.spawn)

  let j = 0

  for (let i = 0; i < spawns.length; ) {
    const spawn = spawns[i]
    const spawning = spawn.spawning
    if (!spawning) {
      i++
      continue
    }
    if (spawning.remainingTime === 0) {
      const adjacentCreeps = spawn.pos.findInRange(FIND_MY_CREEPS, 1)
      for (const creep of adjacentCreeps) {
        if (creep.getNextPos()) {
          continue
        }
        const posToMove = creep.pos
          .getAtRange(1)
          .find((pos) => pos.getRangeTo(spawn.pos) > 1 && pos.walkable && creep.checkEmpty(pos))
        if (posToMove) {
          if (creep.moveMy(posToMove) === OK) {
            break
          }
        }
      }
    }
    const name = spawning.name
    const role = name.split(' ')[1]
    this.visual.text(`🐣${role}`, spawn.pos.x, spawn.pos.y - 0.5 + 0.5 * j, { font: 0.5 })
    j++
    spawns.splice(i, 1)
  }

  if (this.needNotSpawningSpawn) {
    const index = spawns.findIndex((spawn) => !spawn.spawning)
    if (index !== -1) {
      spawns.splice(index, 1)
    }
  }

  while (spawns.length > 0 && queue.length > 0) {
    const request = queue.shift()
    const spawn = spawns.shift()

    if (spawn.spawnRequest(request) === OK) {
      continue
    } else {
      if (queue[0] && request.priority === queue[0].priority) {
        continue
      }
      break
    }
  }
  this.heap.spawnQueue = []
}

Room.prototype.hasEnoughCompounds = function (resourceType, ratio = 0.5) {
  if (!Memory.stats || !Memory.stats.resources) {
    return false
  }
  const COMPOUND_GOAL = config.compoundGoal

  const numMaxRclRoom = Overlord.myRooms.filter((room) => room.controller.level === 8).length
  const boostThreshold = numMaxRclRoom * COMPOUND_GOAL[resourceType] * ratio
  return Memory.stats.resources[resourceType] > boostThreshold
}

Room.prototype.getIsNeedBoostedUpgrader = function () {
  return this.hasEnoughCompounds('XGH2O')
}

Room.prototype.hasAvailableSpawn = function () {
  if (this._hasAvailableSpawn) {
    return this._hasAvailableSpawn
  }

  return (this._hasAvailableSpawn = this.structures.spawn.some((s) => !s.spawning))
}

Room.prototype.getMaxNumManager = function () {
  if (!this.storage) {
    return 0
  }
  if (this.controller.level < 7) {
    return 1
  }
  if (this.heap.isEnemy) {
    return 3
  }
  return 2
}

Room.prototype.getDesiredWallMakerCount = function () {
  if (this._desiredWallMakerCount !== undefined) {
    return this._desiredWallMakerCount
  }

  if (this.heap.desiredWallMakerCount !== undefined && Math.random() > 0.01) {
    return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount)
  }

  if (this.structures.rampart.length === 0) {
    return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount = 0)
  }

  const weakestRampart = this.weakestRampart

  const maxHits = RAMPART_HITS_MAX[this.controller.level]

  if (weakestRampart.hits > maxHits - 10000) {
    return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount = 0)
  }

  const hits = weakestRampart.hits

  if (this.energyLevel >= config.energyLevel.RAMPART_HIGH) {
    if (hits < RAMPART_HITS_THRESHOLD) {
      const count = Math.ceil((this.energyLevel - config.energyLevel.RAMPART_HIGH) / 20)
      return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount = count)
    }
  } else if (this.energyLevel >= config.energyLevel.RAMPART_MIDDLE) {
    if (hits < RAMPART_HITS_ENOUGH) {
      return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount = 1)
    }
  } else if (this.energyLevel >= config.energyLevel.RAMPART_LOW) {
    const threshold = this.controller.level ^ (2 * config.rampartHitsPerRclSquare)

    if (hits < threshold) {
      return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount = 1)
    }
  }

  return (this._desiredWallMakerCount = this.heap.desiredWallMakerCount = 0)
}

Room.prototype.getManagerCarryTotal = function () {
  let result = 0
  const managers = this.creep.manager.filter((creep) => (creep.ticksToLive || 1500) > 3 * creep.body.length)
  for (const creep of managers) {
    result += creep.getNumParts('carry')
  }
  return result
}

Object.defineProperties(Room.prototype, {
  spawnQueue: {
    get() {
      this.heap.spawnQueue = this.heap.spawnQueue || []
      return this.heap.spawnQueue
    },
  },
})

global.RequestSpawn = function (body, name, memory, options = {}) {
  const defaultOptions = { priority: Infinity, cost: 0 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { priority, cost, boostResources } = mergedOptions
  this.body = body
  this.name = name
  this.memory = memory
  this.priority = priority
  this.cost = cost
  this.sourceKeeper = options.sourceKeeper
  if (boostResources !== undefined) {
    const boostRequest = new BoostRequest(this.name, this.body, boostResources)
    this.boostRequest = boostRequest
  }
}

/**
 * boost request to be handled by room
 * @param {Creep} creepName - The target creep name
 * @param {Array} resourceTypes - The array of resourceTypes
 * @param {Object} options
 */
function BoostRequest(creepName, body, resourceTypes) {
  this.time = Game.time
  this.creepName = creepName
  this.requiredResources = {}
  for (resourceType of resourceTypes) {
    const bodyType = BOOSTS_EFFECT[resourceType].type
    const numBodyType = body.filter((part) => part === bodyType).length
    const mineralAmount = Math.min(LAB_MINERAL_CAPACITY, 30 * numBodyType)
    const energyAmount = Math.min(LAB_ENERGY_CAPACITY, 20 * numBodyType)
    this.requiredResources[resourceType] = { mineralAmount, energyAmount }
  }
}

Spawn.prototype.spawnRequest = function (request) {
  const directions = []
  const hubCenterPos = this.room.getHubCenterPos()
  if (request.memory.role === 'distributor' && hubCenterPos) {
    directions.push(this.pos.getDirectionTo(hubCenterPos))
  }
  directions.push(1, 2, 3, 4, 5, 6, 7, 8)

  const result = this.spawnCreep(request.body, request.name, { memory: request.memory, directions })
  if (result !== OK) {
    return result
  }

  if (request.cost) {
    const targetRoomName = request.memory.targetRoomName
    if (targetRoomName) {
      this.room.addRemoteCost(targetRoomName, request.cost)
    } else {
      const activeRemotes = this.room.getActiveRemotes()
      const weightSum = activeRemotes.map((info) => info.weight).reduce((acc, curr) => acc + curr, 0)
      for (const info of activeRemotes) {
        const remoteName = info.remoteName
        const cost = (request.cost * info.weight) / weightSum
        this.room.addRemoteCost(remoteName, cost)
      }
    }
  }

  if (request.boostRequest) {
    this.room.boostQueue[request.name] = request.boostRequest
  }

  return result
}

Room.prototype.requestDistributor = function () {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = [MOVE]
  const maxEnergy = this.energyCapacityAvailable - 50

  for (let i = 0; i < Math.min(Math.floor(maxEnergy / 50), 16); i++) {
    body.push(CARRY)
  }

  const name = `${this.name} distributor ${Game.time}_${this.spawnQueue.length}`

  const memory = { role: 'distributor' }

  let priority = SPAWN_PRIORITY['distributor']

  const request = new RequestSpawn(body, name, memory, { priority: priority })

  this.spawnQueue.push(request)
}

Room.prototype.requestMiner = function (source) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let priority = this.memory.militaryThreat ? SPAWN_PRIORITY['minerNotUrgent'] : SPAWN_PRIORITY['miner']

  const maxEnergy = this.heap.sourceUtilizationRate > 0 ? this.energyCapacityAvailable : this.energyAvailable
  let body = []
  if (source.linked) {
    if (maxEnergy >= 800) {
      body = [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, WORK, MOVE, CARRY]
    } else if (maxEnergy >= 700) {
      //여력이 되면
      body = [WORK, WORK, WORK, WORK, MOVE, MOVE, WORK, MOVE, CARRY]
    } else if (maxEnergy >= 550) {
      body = [WORK, WORK, WORK, MOVE, WORK, CARRY, MOVE]
    } else {
      body = [WORK, WORK, CARRY, MOVE]
    }
  } else {
    if (maxEnergy >= 750) {
      body = [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, WORK, MOVE]
    } else if (maxEnergy >= 650) {
      //여력이 되면
      body = [WORK, WORK, WORK, WORK, MOVE, MOVE, WORK, MOVE]
    } else if (maxEnergy >= 550) {
      body = [WORK, WORK, WORK, WORK, WORK, MOVE]
    } else {
      body = [WORK, MOVE, WORK, MOVE]
    }
  }

  const name = `${this.name} miner ${Game.time}${this.spawnQueue.length}`
  const memory = { role: 'miner', sourceId: source.id }
  const request = new RequestSpawn(body, name, memory, { priority })

  this.spawnQueue.push(request)
}

Room.prototype.requestManager = function (numCarry, option = { isUrgent: false }) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const { isUrgent } = option
  let body = []
  const maxEnergy = isUrgent ? this.energyAvailable : this.energyCapacityAvailable
  for (let i = 0; i < Math.min(Math.ceil(numCarry / 2), Math.floor(maxEnergy / 150), 16); i++) {
    body.push(CARRY, CARRY, MOVE)
  }

  const name = `${this.name} manager ${Game.time}_${this.spawnQueue.length}`

  const memory = { role: 'manager' }

  const priority = isUrgent ? SPAWN_PRIORITY['managerUrgent'] : SPAWN_PRIORITY['manager']

  const request = new RequestSpawn(body, name, memory, { priority: priority })

  this.spawnQueue.push(request)
}

Room.prototype.requestHauler = function (numCarry, option = { isUrgent: false, office: undefined }) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const { isUrgent, office } = option
  let body = []
  const maxEnergy = isUrgent ? this.energyAvailable : this.energyCapacityAvailable
  if (this.memory.level >= 3) {
    for (let i = 0; i < Math.min(Math.ceil(numCarry / 2), Math.floor(maxEnergy / 150), 16); i++) {
      body.push(CARRY, CARRY, MOVE)
    }
  } else {
    for (let i = 0; i < Math.min(numCarry, Math.floor(maxEnergy / 100), 25); i++) {
      body.push(CARRY, MOVE)
    }
  }

  const name = `${this.name} hauler ${Game.time}_${this.spawnQueue.length}`

  const memory = { role: 'hauler', sourceId: office.id }

  let priority = SPAWN_PRIORITY['hauler']

  const request = new RequestSpawn(body, name, memory, { priority: priority })

  this.spawnQueue.push(request)
}

function getBuilderModel(energyCapacity, maxWork) {
  let cost = 200
  let work = 1
  let move = 1
  let carry = 1
  while (energyCapacity > cost && work + move + carry < MAX_CREEP_SIZE) {
    if ((move === 0 || (work + carry) / move >= 2) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
      move++
      cost += BODYPART_COST[MOVE]
      continue
    }

    if ((carry === 0 || carry / work <= 2) && energyCapacity >= cost + BODYPART_COST[CARRY]) {
      carry++
      cost += BODYPART_COST[CARRY]
      continue
    }

    if (maxWork && work >= maxWork) {
      break
    }

    if (energyCapacity >= cost + BODYPART_COST[WORK]) {
      work++
      cost += BODYPART_COST[WORK]
      continue
    }
    break
  }

  const body = parseBody(`${work - 1}w${carry}c${move - 1}m1w1m`)

  return { body, numWork: work, cost }
}

function getLaborerModel(energyCapacity, maxWork) {
  let cost = 50
  let work = 0
  let move = 0
  let carry = 1
  while (energyCapacity > cost) {
    if ((CARRY_CAPACITY * carry) / work < 2 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
      if (work + move + carry + 1 > MAX_CREEP_SIZE) {
        break
      }
      carry++
      cost += BODYPART_COST[CARRY]
      continue
    }

    if ((move === 0 || work / move >= 4) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
      if (work + move + carry + 1 > MAX_CREEP_SIZE) {
        break
      }
      move++
      cost += BODYPART_COST[MOVE]
      continue
    }

    if (maxWork && work >= maxWork) {
      break
    }

    if (energyCapacity >= cost + BODYPART_COST[WORK]) {
      if (work + move + carry + 1 > MAX_CREEP_SIZE) {
        break
      }
      work++
      cost += BODYPART_COST[WORK]
      continue
    }
    break
  }

  const body = parseBody(`${work - 1}w${carry}c${move}m1w`)

  return { body, numWork: work, cost }
}

/**
 *
 * @param {number} numWork - desired number of work parts
 * @param {string} boost - name of resource used to be boost
 * @returns
 */
Room.prototype.requestLaborer = function (options) {
  const defaultOptions = { maxWork: undefined, boost: undefined, isBuilder: false }
  const mergedOptions = { ...defaultOptions, ...options }

  const { maxWork, boost, isBuilder } = mergedOptions

  if (!this.hasAvailableSpawn()) {
    return
  }

  const model = isBuilder
    ? getBuilderModel(this.energyCapacityAvailable, maxWork)
    : getLaborerModel(this.energyCapacityAvailable, maxWork)

  const body = model.body

  const name = `${this.name} laborer ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'laborer',
    controller: this.controller.id,
    working: false,
    isBuilder,
  }

  let priority = undefined

  const bestFunnelRequest = Overlord.getBestFunnelRequest()
  if (
    !this.storage ||
    isBuilder ||
    (bestFunnelRequest && bestFunnelRequest.roomName === this.name) ||
    this.energyLevel > config.energyLevel.STOP_FUNNEL
  ) {
    priority = SPAWN_PRIORITY['laborerUrgent']
  } else {
    priority = SPAWN_PRIORITY['laborer']
  }

  const spawnOptions = { priority }

  if (boost) {
    memory.boosted = false
    spawnOptions.boostResources = [boost]
  }

  const request = new RequestSpawn(body, name, memory, spawnOptions)
  this.spawnQueue.push(request)
}

Room.prototype.requestWallMaker = function () {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const maxWork = Math.min(16, Math.floor(this.energyCapacityAvailable / 200))

  let body = []
  for (let i = 0; i < maxWork - 1; i++) {
    body.push(WORK)
  }

  for (let i = 0; i < maxWork - 1; i++) {
    body.push(CARRY)
  }

  for (let i = 0; i < maxWork - 1; i++) {
    body.push(MOVE)
  }

  body.push(WORK, CARRY, MOVE)

  const name = `${this.name} wallMaker ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'wallMaker',
    working: false,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['wallMaker'] })
  this.spawnQueue.push(request)
}

Room.prototype.requestExtractor = function () {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = []
  for (i = 0; i < Math.min(10, Math.floor(this.energyAvailable / 450)); i++) {
    body.push(WORK, WORK, WORK, WORK, MOVE)
  }

  const name = `${this.name} extractor ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'extractor',
    terminal: this.terminal.id,
    extractor: this.structures.extractor[0].id,
    mineral: this.mineral.id,
    resourceType: this.mineralType,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['extractor'] })
  this.spawnQueue.push(request)
}

Room.prototype.requestResearcher = function () {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = []
  for (i = 0; i < Math.min(10, Math.floor(this.energyAvailable / 150)); i++) {
    body.push(MOVE, CARRY, CARRY)
  }

  const name = `${this.name} researcher ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'researcher',
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['researcher'] })
  this.spawnQueue.push(request)
}

Room.prototype.requestReserver = function (targetRoomName) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = []
  let cost = 0
  for (i = 0; i < Math.min(5, Math.floor(this.energyAvailable / 650)); i++) {
    body.push(CLAIM, MOVE)
    cost += 650
  }

  const name = `${targetRoomName} reserver ${Game.time}`

  const memory = {
    role: 'reserver',
    base: this.name,
    targetRoomName,
    ignoreMap: 1,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['reserver'], cost })
  this.spawnQueue.push(request)
}

Room.prototype.requestColonyHaulerForConstruct = function (colonyName, sourceId, sourcePathLength) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = []
  let cost = 0
  for (let i = 0; i < Math.min(Math.floor(this.energyCapacityAvailable / 550), 3); i++) {
    body.push(WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE)
    cost += 550
  }

  const name = `${colonyName} colonyHauler ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'colonyHauler',
    base: this.name,
    colony: colonyName,
    sourceId: sourceId,
    sourcePathLength: sourcePathLength,
    ignoreMap: 1,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['colonyHauler'] - 1, cost })
  this.spawnQueue.push(request)
}

Room.prototype.requestColonyMiner = function (colonyName, sourceId, containerId) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let cost = 0
  const body = []
  for (let i = 0; i < Math.min(Math.floor(this.energyCapacityAvailable / 150), 6); i++) {
    body.push(WORK, MOVE)
    cost += 150
  }

  if (this.energyCapacityAvailable - cost >= 50) {
    body.push(CARRY)
    cost += 50
  }

  const name = `${colonyName} colonyMiner ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'colonyMiner',
    base: this.name,
    colony: colonyName,
    sourceId: sourceId,
    containerId: containerId,
    ignoreMap: 1,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['colonyMiner'], cost: cost })
  this.spawnQueue.push(request)
}

global.harasserBody = {
  260: blinkyBodyMaker(1, 1, 0),
  550: blinkyBodyMaker(0, 1, 1),
  760: blinkyBodyMaker(1, 2, 1),
  1300: blinkyBodyMaker(0, 5, 1),
  1800: blinkyBodyMaker(0, 6, 2),
  2300: blinkyBodyMaker(0, 7, 3),
  5600: blinkyBodyMaker(0, 19, 6),
}

global.harasserBodyMoveFirst = {
  260: blinkyBodyMaker(1, 1, 0, true),
  550: blinkyBodyMaker(0, 1, 1, true),
  760: blinkyBodyMaker(1, 2, 1, true),
  1300: blinkyBodyMaker(0, 5, 1, true),
  1800: blinkyBodyMaker(0, 6, 2, true),
  2300: blinkyBodyMaker(0, 7, 3, true),
  5600: blinkyBodyMaker(0, 19, 6, true),
}

Room.prototype.requestColonyDefender = function (colonyName, options = {}) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const defaultOptions = { doCost: true, costMax: 5500, waitForTroops: false, task: undefined }
  const mergedOptions = { ...defaultOptions, ...options }
  let { doCost, costMax, waitForTroops, task } = mergedOptions

  let body = undefined
  let cost = 0

  costMax = Math.min(costMax, this.energyCapacityAvailable)

  const costs = Object.keys(harasserBody).sort((a, b) => b - a)
  for (const bodyCost of costs) {
    if (bodyCost <= costMax) {
      body = harasserBody[bodyCost]
      cost = bodyCost
      break
    }
  }

  if (!body) {
    return
  }

  const name = `${colonyName} colonyDefender ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'colonyDefender',
    base: this.name,
    colony: colonyName,
    waitForTroops: waitForTroops,
  }

  if (task) {
    memory.task = { category: task.category, id: task.id }
  }

  if (!doCost) {
    cost = 0
  }
  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['colonyDefender'], cost: cost })
  this.spawnQueue.push(request)
}

Room.prototype.requestColonyHauler = function (colonyName, sourceId, maxCarry, sourcePathLength, isRepairer = false) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = []
  let cost = 0

  if (isRepairer) {
    body.push(WORK, MOVE)
    cost += 150
  }

  const energyCapacity = this.energyCapacityAvailable - (isRepairer ? 150 : 0)

  for (let i = 0; i < Math.min(Math.floor(energyCapacity / 150), 16, Math.ceil(maxCarry / 2)); i++) {
    body.push(CARRY, CARRY, MOVE)
    cost += 150
  }

  const name = `${colonyName} colonyHauler ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'colonyHauler',
    base: this.name,
    colony: colonyName,
    sourceId: sourceId,
    sourcePathLength: sourcePathLength,
    ignoreMap: 1,
    isRepairer: isRepairer,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['colonyHauler'], cost: cost })
  this.spawnQueue.push(request)
}

Room.prototype.requestFastColonyHauler = function (colonyName, sourceId, maxCarry, sourcePathLength) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = []
  let cost = 0
  for (let i = 0; i < Math.min(Math.floor(this.energyCapacityAvailable / 100), 25, Math.ceil(maxCarry)); i++) {
    body.push(CARRY, MOVE)
    cost += 100
  }

  const name = `${colonyName} colonyHauler ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'colonyHauler',
    base: this.name,
    colony: colonyName,
    sourceId: sourceId,
    sourcePathLength: sourcePathLength,
    ignoreMap: 1,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['colonyHauler'], cost: cost })
  this.spawnQueue.push(request)
}

Room.prototype.requestClaimer = function (targetRoomName, disclaimer = false) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = []

  if (disclaimer) {
    for (let i = 0; i < Math.floor(this.energyCapacityAvailable / 650); i++) {
      body.push(CLAIM, MOVE)
    }
  } else {
    body = [CLAIM, MOVE, MOVE, MOVE, MOVE, MOVE]
  }

  const name = `${targetRoomName} claimer ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'claimer',
    base: this.name,
    targetRoom: targetRoomName,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['claimer'] })
  this.spawnQueue.push(request)
}

Room.prototype.requestDepositWorker = function (depositRequest) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = []

  for (let i = 0; i < 15; i++) {
    body.push(WORK)
  }

  for (let i = 0; i < 10; i++) {
    body.push(CARRY)
  }

  for (let i = 0; i < 25; i++) {
    body.push(MOVE)
  }

  const name = `${depositRequest.depositId} depositWorker ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'depositWorker',
    base: this.name,
    targetRoom: depositRequest.roomName,
    task: { category: depositRequest.category, id: depositRequest.id },
  }
  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['depositWorker'] })
  this.spawnQueue.push(request)
}

Room.prototype.requestPioneer = function (targetRoomName, number = 0) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const model = getBuilderModel(this.energyCapacityAvailable, 10)

  const body = model.body

  const name = `${targetRoomName} pioneer ${Game.time}_${number}`

  const memory = {
    role: 'pioneer',
    targetRoom: targetRoomName,
    working: false,
    number: number,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['pioneer'] })
  this.spawnQueue.push(request)
}

Room.prototype.requestScouter = function () {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = [MOVE]

  const name = `${this.name} scouter ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'scouter',
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['scouter'] })
  this.spawnQueue.push(request)
}

module.exports = {
  getLaborerModel,
  getBuilderModel,
}
