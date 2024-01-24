const { config } = require("./config")

const TEST = false

const IGNORE_DAMAGE_WHEN_PATHING = config.quad.IGNORE_DAMAGE_WHEN_PATHING

const QUAD_COST_VISUAL = config.quad.QUAD_COST_VISUAL

const BULLDOZE_COST_VISUAL = config.quad.BULLDOZE_COST_VISUAL

const IMPORTANT_STRUCTURE_TYPES = config.quad.IMPORTANT_STRUCTURE_TYPES

const HEAL_BUFFER = config.quad.HEAL_BUFFER

const ENEMY_OBSTACLE_OBJECT_TYPES = [...OBSTACLE_OBJECT_TYPES, 'rampart']

const EDGE_COST = 50
const HALF_EDGE_COST = 10


QUAD_BLINKY_BODY = {
  70: parseBody('11r22m11h'),
  71: parseBody('10r12m14h'),
  72: parseBody('17r9m10h'),
  73: parseBody('15r7m12h'),
  80: parseBody('12r25m13h'),
  81: parseBody('18r16m14h'),
  82: parseBody('22r12m14h'),
  83: parseBody('2t15r3t5m20h5m')
}

const QUAD_BLINKY_BOOST_RESOURCES = {
  71: ['ZO', 'LO', 'KO',],
  72: ['ZHO2', 'LHO2', 'KHO2',],
  73: ['XZHO2', 'XLHO2', 'XKHO2',],
  81: ['ZO', 'LO', 'KO',],
  82: ['ZHO2', 'LHO2', 'KHO2',],
  83: ['XZHO2', 'XGHO2', 'XLHO2', 'XKHO2',],
}


const FORMATION_VECTORS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
]

const FORMATION_VECTORS_REVERSED = [
  { x: 0, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: -1 }
]

const FORMATION_NEIGHBOR_VECTORS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
]

const ATTACK_TARGET_POSITION_VECTORS = [
  { x: -2, y: -1 },
  { x: -2, y: -0 },
  { x: -1, y: -2 },
  { x: -1, y: 1 },
  { x: 0, y: -2 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 1, y: -1 }
]

class Quad {
  constructor(name) {
    const names = [0, 1, 2, 3].map(number => `${name} ${number}`)
    this.name = name
    this.names = names
  }

  get creeps() {
    return this.getCreeps()
  }

  get creepIds() {
    if (this._creepIds) {
      return this._creepIds
    }
    return this._creepIds = this.creeps.map(creep => creep.id)
  }

  get fatigue() {
    if (this._fatigue) {
      return this._fatigue
    }
    let result = 0
    for (const creep of this.creeps) {
      result = Math.max(result, creep.fatigue)
    }
    return this._fatigue = result
  }

  get moveCost() {
    const moveCosts = this.creeps.map(creep => creep.getMoveCost())
    return Math.max(...moveCosts)
  }

  get leader() {
    return this.creeps[0]
  }

  get pos() {
    if (this._pos !== undefined) {
      return this._pos
    }

    const leader = this.leader

    if (!leader) {
      return undefined
    }

    if (this.isCompact) {
      const x = Math.min(...this.creeps.map(creep => creep.pos.x))
      const y = Math.min(...this.creeps.map(creep => creep.pos.y))
      const pos = new RoomPosition(x, y, this.roomName)
      return this._pos = pos
    }

    return this._pos = leader.pos
  }

  get room() {
    if (!this.leader) {
      return undefined
    }
    return this.leader.room
  }

  get roomName() {
    if (this._roomName !== undefined) {
      return this._roomName
    }
    if (!this.room) {
      return undefined
    }
    return this._roomName = this.room.name
  }

  get ticksToLive() {
    if (this._ticksToLive !== undefined) {
      return this._ticksToLive
    }
    return this._ticksToLive = Math.max(...this.creeps.map(creep => creep.ticksToLive || 1500))
  }

  get hitsMax() {
    if (this._hitsMax !== undefined) {
      return this._hitsMax
    }
    return this._hitsMax = this.creeps.map(creep => creep.hitsMax).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
  }

  get hits() {
    if (this._hits !== undefined) {
      return this._hits
    }
    return this._hits = this.creeps.map(creep => creep.hits).reduce((accumulator, currentValue) => accumulator + currentValue.hits, 0)
  }

  get formation() {
    if (this._formation) {
      return this._formation
    }
    return this._formation = this.getFormation()
  }

  get isCompact() {
    if (this._isCompact !== undefined) {
      return this._isCompact
    }
    return this._isCompact = this.getIsCompact()
  }

  get isFormed() {
    if (this._isFormed) {
      return this._isFormed
    }
    return this._isFormed = this.getIsFormed()
  }

  get dismantlePower() {
    if (this._dismantlePower) {
      return this._dismantlePower
    }
    const result = this.creeps.map(creep => creep.dismantlePower).reduce((acc, curr) => acc + curr, 0)
    return this._dismantlePower = result
  }

  get attackPower() {
    if (this._attackPower) {
      return this._attackPower
    }
    const result = this.creeps.map(creep => creep.attackPower).reduce((acc, curr) => acc + curr, 0)
    return this._attackPower = result
  }

  get rangedAttackPower() {
    if (this._rangedAttackPower) {
      return this._rangedAttackPower
    }
    const result = this.creeps.map(creep => creep.rangedAttackPower).reduce((acc, curr) => acc + curr, 0)
    return this._rangedAttackPower = result
  }

  get healPower() {
    if (this._healPower) {
      return this._healPower
    }
    const result = this.creeps.map(creep => creep.healPower).reduce((acc, curr) => acc + curr, 0)
    return this._healPower = result
  }

  get isSnakeFormedUp() {
    if (this._isSnakeFormedUp) {
      return this._isSnakeFormedUp
    }
    return this._isSnakeFormedUp = this.getIsSnakeFormedUp()
  }

  get costMatrix() {
    if (this._costMatrix) {
      return this._costMatrix
    }
    return this._costMatrix = getQuadCostMatrix(this.roomName)
  }

  get heap() {
    if (!Heap.quads.has(this.name)) {
      Heap.quads.set(this.name, {})
    }
    return Heap.quads.get(this.name)
  }
}

Quad.prototype.attackRoom = function () {
  const moveResult = this.maneuver()
  this.quadRangedAttack(moveResult)
}

Quad.prototype.maneuver = function () {
  if (!this.isFormed) {
    this.leader.say('🎺', true)
    this.formUp()
    return { action: 'formUp', reason: 'deformation' }
  }

  if (this.healPower < (this.hitsMax - this.hits) + HEAL_BUFFER) {
    this.leader.say('🚑', true)
    this.retreat()
    return { action: 'retreat', reason: 'danger' }
  }

  if (this.room.controller && this.room.controller.safeMode > 0) {
    this.leader.say('🏰', true)
    this.retreat()
    return { action: 'retreat', reason: 'safeMode' }
  }

  if (this.isDanger()) {
    this.leader.say('🚨', true)
    this.retreat()
    return { action: 'retreat', reason: 'danger' }
  }

  const path = this.getPathToAttack()

  if (path === ERR_NOT_FOUND) {
    this.leader.say('🚫', true)
    this.retreat()
    return { action: 'retreat', reason: 'noPath' }
  }

  const nextPos = this.pos.getNextPosFromPath(path)

  if (nextPos) {
    visualizePath(path, this.pos)
    if (this.isAbleToStep(nextPos)) {
      const direction = this.pos.getDirectionTo(nextPos)
      this.move(direction)
      return { action: 'move', nexPos: nextPos }
    }

    if (this.checkMyCreep(nextPos)) {
      this.deleteCachedPath()
      return { action: 'wait', reason: 'creep' }
    }

    const targetStructure = this.getStructureToAttackAt(nextPos)

    const posToAttack = this.findPosToAttack(targetStructure)
    if (posToAttack) {
      const range = this.pos.getRangeTo(posToAttack)

      if (range > 0) {
        const direction = this.pos.getDirectionTo(posToAttack)
        this.move(direction)
        return { action: 'move', nexPos: posToAttack }
      }
    }

    if (this.dismantlePower > 0 && targetStructure) {
      this.dismantle(targetStructure)
    }
    return { action: 'attack', targetStructure: targetStructure }
  }
  this.deleteCachedPath()
  return { action: 'wait', reason: 'noNextPos' }
}

Quad.prototype.formUp = function () {
  if (this.isCompact && this.fatigue > 0) {
    return
  }

  const formation = this.findFormationToFormUp()

  console.log(formation)
  if (formation && formation[0].roomName !== this.roomName) {
    this.resetFormationToFormUp()
    return
  }

  for (const pos of formation) {
    this.room.visual.circle(pos)
  }

  const creeps = this.creeps

  for (let i = 0; i < creeps.length; i++) {
    const creep = creeps[i]
    const index = getIndex(creep, i)
    const pos = formation[index]
    if (!pos) {
      continue
    }
    if (creep.pos.isEqualTo(pos)) {
      continue
    }
    if (creep.moveMy(pos, { ignoreMap: 2 }) === ERR_NO_PATH) {
      creep.moveTo(pos)
    }
  }
}

Quad.prototype.findFormationToFormUp = function () {
  if (this.heap.formationToFormUp !== undefined) {
    return this.heap.formationToFormUp
  }

  if (this.isAbleToStep(this.pos)) {
    const formation = this.pos.getQuadSquarePositions()
    return this.heap.formationToFormUp = formation
  }

  const candidates = []

  for (let range = 1; range <= 10; range++) {
    const positions = this.pos.getAtRange(range)
    for (const pos of positions) {
      if (!this.isAbleToStep(pos)) {
        continue
      }
      candidates.push(pos)
    }
  }

  const goals = candidates.map(pos => {
    return { pos, range: 0 }
  })

  const path = Overlord.findPath(this.pos, goals)
  if (path === ERR_NO_PATH) {
    return undefined
  }

  const lastPos = path.pop()

  const formation = lastPos.getQuadSquarePositions()

  return this.heap.formationToFormUp = formation
}

Quad.prototype.resetFormationToFormUp = function () {
  delete this.heap.formationToFormUp
}


Quad.prototype.quadRangedAttack = function (moveResult) {
  for (const creep of this.creeps) {
    creep.quadRangedAttack(moveResult)
  }
}

Creep.prototype.quadRangedAttack = function (moveResult) {
  const allies = this.room.find(FIND_CREEPS).filter(creep => creep.isAlly())
  const isAlly = this.pos.findInRange(allies, 3).length > 0
  let rangedMassAttackTotalDamage = 0

  const positions = this.pos.getInRange(3)
  const rangedAttackPower = this.rangedAttackPower

  let rangedAttackTarget = undefined

  for (const pos of positions) {
    const priorityTarget = this.getPriorityTarget(pos)

    if (!priorityTarget) {
      continue
    }

    if (rangedAttackTarget === undefined) {
      rangedAttackTarget = priorityTarget
    } else {
      rangedAttackTarget = moreImportantTarget(priorityTarget, rangedAttackTarget)
    }

    if (priorityTarget.my === false) {
      const range = this.pos.getRangeTo(pos)

      if (range <= 1 && !isAlly) {
        this.rangedMassAttack()
        return
      }

      const rangeConstant = range <= 1 ? 1 : range <= 2 ? 0.4 : 0.1
      const damage = rangedAttackPower * rangeConstant

      rangedMassAttackTotalDamage += damage
      continue
    }
  }

  if (rangedMassAttackTotalDamage >= rangedAttackPower && !isAlly) {
    this.rangedMassAttack()
    return
  }

  if (moveResult.targetStructure && !(rangedAttackTarget instanceof Creep)) {
    this.rangedAttack(moveResult.targetStructure)
    return
  }

  if (rangedAttackTarget) {
    this.rangedAttack(rangedAttackTarget)
  }
}

function moreImportantTarget(targetA, targetB) {
  if (targetA instanceof Creep) {
    return targetA
  }
  if (targetB instanceof Creep) {
    return targetB
  }

  if (targetA.hits < targetB.hits) {
    return targetA
  } else {
    return targetB
  }
}

Room.prototype.requestQuadMemberHealer = function (name) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = []
  for (let i = 0; i < 40; i++) {
    body.push(HEAL)
  }
  for (let i = 0; i < 10; i++) {
    body.push(MOVE)
  }

  if (TEST) {
    body = [HEAL, HEAL, HEAL, HEAL, MOVE]
  }

  const memory = { role: 'quad', base: this.name, boosted: false, wait: true }

  const options = { priority: 1 }

  options.boostResources = ['XZHO2', 'XLHO2']

  const request = new RequestSpawn(body, name, memory, options)

  this.spawnQueue.push(request)
}

Room.prototype.requestQuadMemberDismantler = function (name) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let body = []
  for (let i = 0; i < 5; i++) {
    body.push(RANGED_ATTACK)
  }
  for (let i = 0; i < 35; i++) {
    body.push(WORK)
  }
  for (let i = 0; i < 10; i++) {
    body.push(MOVE)
  }

  if (TEST) {
    body = [RANGED_ATTACK, WORK, WORK, WORK, MOVE]
  }

  const memory = { role: 'quad', base: this.name, boosted: false, wait: true }

  const options = { priority: 1 }
  options.boostResources = ['XZHO2', 'XZH2O', 'XKHO2']

  const request = new RequestSpawn(body, name, memory, options)

  this.spawnQueue.push(request)
}

Room.prototype.requestQuadMemberBlinky = function (name, modelNumber) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = QUAD_BLINKY_BODY[modelNumber]

  if (!body) {
    return
  }

  const memory = { role: 'quad', base: this.name, wait: true }

  const options = { priority: 4 }

  const boostResources = QUAD_BLINKY_BOOST_RESOURCES[modelNumber]

  if (boostResources) {
    options.boostResources = boostResources
    memory.boosted = false
  }

  const request = new RequestSpawn(body, name, memory, options)

  this.spawnQueue.push(request)
}

Overlord.getNumAvailableBlinkyQuad = function () {
  if (Game._numAvailableBlinkyQuad) {
    return Game._numAvailableBlinkyQuad
  }
  const result = {}
  const resources = Memory.stats ? Memory.stats.resources : undefined
  if (!resources) {
    return result
  }
  outer:
  for (const i of Object.keys(QUAD_BLINKY_BOOST_RESOURCES)) {
    result[i] = Infinity
    const body = QUAD_BLINKY_BODY[i]
    const resourceTypes = QUAD_BLINKY_BOOST_RESOURCES[i]
    const requiredResources = getRequiredResourcesToBoost(body, resourceTypes)
    for (const resourceType in requiredResources) {
      const resourceAmount = resources[resourceType] || 0
      result[i] = Math.min(result[i], Math.floor(resourceAmount / (4 * requiredResources[resourceType])))
      if (result[i] < 1) {
        continue outer
      }
    }
  }
  return Game._numAvailableBlinkyQuad = result
}

global.getRequiredResourcesToBoost = function (body, resourceTypes) {
  const result = {}
  for (const resourceType of resourceTypes) {
    const bodyType = BOOSTS_EFFECT[resourceType].type
    const numBodyType = body.filter(part => part === bodyType).length
    const resourceAmount = 30 * numBodyType
    result[resourceType] = resourceAmount
  }
  return result
}

Quad.prototype.isDanger = function () {
  const damageArray = this.getDamageArray(this.moveCost)
  const healPower = this.healPower

  for (const creep of this.creeps) {
    for (const pos of creep.pos.getInRange(1)) {
      const packed = packCoord(pos.x, pos.y)
      const damage = damageArray[packed]
      const effectiveDamage = creep.getEffectiveDamage(damage)
      const netHeal = healPower - effectiveDamage
      if (netHeal < HEAL_BUFFER) {
        return true
      }
    }
  }
  return false
}

Quad.prototype.dismantle = function (structure) {
  this.prepareDismantle(structure)

  for (const creep of this.creeps) {
    if (creep.dismantlePower > 0) {
      creep.dismantle(structure)
    }
  }
}

Quad.prototype.prepareDismantle = function (structure) {
  const dismantlers = this.creeps.filter(creep => creep.dismantlePower > 0)

  let isFormed = true
  for (const creep of dismantlers) {
    if (creep.pos.getRangeTo(structure.pos) > 1) {
      isFormed = false
      break
    }
  }

  if (isFormed) {
    return true
  }

  const creepsSorted = [...this.creeps].sort((a, b) => b.dismantlePower - a.dismantlePower)
  const formation = this.formation
  const indexSorted = [0, 1, 2, 3].sort((a, b) => {
    const aPos = formation[a]
    const bPos = formation[b]
    if (!aPos) {
      return 1
    }
    if (!bPos) {
      return -1
    }
    return aPos.getRangeTo(structure.pos) - bPos.getRangeTo(structure.pos)
  })

  for (let i = 0; i < creepsSorted.length; i++) {
    const creep = creepsSorted[i]
    creep.memory.position = indexSorted[i]
  }

  this.formUp()
}

Quad.prototype.findPosToAttack = function (targetStructure) {

  if (!targetStructure) {
    return undefined
  }

  const candidatePositions = []

  for (const vector of ATTACK_TARGET_POSITION_VECTORS) {
    const x = vector.x + targetStructure.pos.x
    if (x < 0 || x > 49) {
      continue
    }
    const y = vector.y + targetStructure.pos.y
    if (y < 0 || y > 49) {
      continue
    }
    const pos = new RoomPosition(x, y, this.roomName)
    const range = this.pos.getRangeTo(pos)
    if (range > 1) {
      continue
    }
    if (!this.isAbleToStep(pos)) {
      continue
    }
    candidatePositions.push(pos)
  }

  if (candidatePositions.length === 0) {
    return undefined
  }

  const targetPos = getMinObject(candidatePositions, pos => this.pos.getTaxiRangeTo(pos))
  return targetPos
}

Quad.prototype.getStructureToAttackAt = function (nextPos) {
  const structures = this.getStructuresOnSquarePositions(nextPos)
  if (structures.length === 0) {
    return
  }
  const targetStructure = getMinObject(structures, structure => structure.hits || Infinity)
  return targetStructure
}

Quad.prototype.getStructuresOnSquarePositions = function (pos) {
  const result = []
  const squarePositions = pos.getQuadSquarePositions()
  for (const pos of squarePositions) {
    const structuresOnPos = pos.lookFor(LOOK_STRUCTURES)
    const rampart = structuresOnPos.find(structure => structure.structureType === 'rampart')
    if (rampart) {
      result.push(rampart)
      continue
    }
    const obstacle = structuresOnPos.find(structure => ENEMY_OBSTACLE_OBJECT_TYPES.includes(structure.structureType))
    if (obstacle) {
      result.push(obstacle)
      continue
    }
  }
  return result
}

RoomPosition.prototype.getQuadSquarePositions = function () {
  const result = []
  for (const vector of FORMATION_VECTORS) {
    const x = this.x + vector.x
    if (x < 0 || x > 49) {
      continue
    }
    const y = this.y + vector.y
    if (y < 0 || y > 49) {
      continue
    }

    const pos = new RoomPosition(x, y, this.roomName)
    result.push(pos)
  }
  return result
}

Quad.prototype.getPathToAttack = function () { // use heap to cache path
  if (Math.random() < 0.1) {
    this.deleteCachedPath()
  }

  const cachedPath = this.getCachedPath()

  if (cachedPath !== undefined && this.pos.getNextPosFromPath(cachedPath)) {
    this.leader.say('🚜', true)
    return cachedPath
  }

  const quadCostArray = this.getBulldozeQuadCostArray() // use heap to cache costArrayForBulldoze

  if (!quadCostArray) {
    return ERR_NOT_FOUND
  }

  const bulldozePath = this.getBulldozePath(quadCostArray)

  if (Array.isArray(bulldozePath)) {
    this.leader.say('🚜', true)
    return this.heap._path = bulldozePath
  }

  const skirmishPath = this.getSkirmishPath(quadCostArray)
  if (Array.isArray(skirmishPath)) {
    this.leader.say('🔫', true)
    return skirmishPath
  }

  this.leader.say('🚫', true)
  return ERR_NOT_FOUND
}

Quad.prototype.getCachedPath = function () {
  const cachedPath = this.heap._path
  if (!cachedPath) {
    return undefined
  }

  if (!Array.isArray(cachedPath)) {
    return undefined
  }

  if (cachedPath.length === 0) {
    return undefined
  }

  return cachedPath
}

RoomPosition.prototype.getNextPosFromPath = function (path) {
  for (let i = path.length - 1; i >= 0; i--) {
    const pos = path[i]
    if (this.isEqualTo(pos)) {
      return undefined
    }
    if (this.getRangeTo(pos) === 1) {
      return pos
    }
  }
  return undefined
}

Quad.prototype.deleteCachedPath = function () {
  delete this.heap._path
  delete this.heap._costArrayForBulldoze
}

Quad.prototype.isAbleToStep = function (pos) {
  const costs = this.costMatrix
  if (costs.get(pos.x, pos.y) > EDGE_COST) {
    return false
  }

  const minX = Math.max(0, pos.x)
  const minY = Math.max(0, pos.y)

  const maxX = Math.min(49, pos.x + 1)
  const maxY = Math.min(49, pos.y + 1)

  const creeps = this.room.lookForAtArea(LOOK_CREEPS, minY, minX, maxY, maxX, true)
  const thisIds = this.creepIds
  const creepsFiltered = creeps.filter(looked => !looked.creep.pos.isRampart && !thisIds.includes(looked.creep.id))
  if (creepsFiltered.length > 0) {
    return false
  }

  const structures = this.room.lookForAtArea(LOOK_STRUCTURES, minY, minX, maxY, maxX, true)
  const structuresFiltered = structures.filter(looked => ENEMY_OBSTACLE_OBJECT_TYPES.includes(looked.structure.structureType))
  if (structuresFiltered.length > 0) {
    return false
  }

  return true
}

Quad.prototype.checkMyCreep = function (pos) {
  const minX = Math.max(0, pos.x)
  const minY = Math.max(0, pos.y)

  const maxX = Math.min(49, pos.x + 1)
  const maxY = Math.min(49, pos.y + 1)

  const creeps = this.room.lookForAtArea(LOOK_CREEPS, minY, minX, maxY, maxX, true)
  const isMyCreep = creeps.find(looked => !this.creepIds.includes(looked.creep.id) && looked.creep.my)

  if (isMyCreep) {
    return true
  }

  return false
}

Quad.prototype.getBulldozePath = function (quadCostArray) {
  if (this._bulldozePath) {
    return this._bulldozePath
  }

  const range = 0

  const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES)
  const importantStructures = hostileStructures.filter(structure => IMPORTANT_STRUCTURE_TYPES.includes(structure.structureType))
  // if (this.room.storage && this.room.storage.store.getUsedCapacity() > 20000) {
  //   importantStructures.push(this.room.storage)
  // }

  if (importantStructures.length === 0) {
    return undefined
  }

  const goals = []

  for (const structure of importantStructures) {
    const pos = structure.pos
    for (const vector of FORMATION_VECTORS_REVERSED) {
      const x = pos.x + vector.x
      if (x < 0 || x > 49) {
        continue
      }
      const y = pos.y + vector.y
      if (y < 0 || y > 49) {
        continue
      }
      const newPos = new RoomPosition(x, y, this.roomName)
      const goal = { pos: newPos, range }
      goals.push(goal)
    }
  }

  const dijkstra = this.room.dijkstra(this.pos, goals, quadCostArray)
  return this._bulldozePath = dijkstra
}

Quad.prototype.getSkirmishPath = function (quadCostArray) {
  if (this._skirmishPath) {
    return this._skirmishPath
  }

  const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES).filter(structure => structure.hits)
  const hostileCreeps = this.room.findHostileCreeps()
  const goals = []

  const structureRange = 0
  for (const structure of hostileStructures) {
    const pos = structure.pos
    for (const vector of FORMATION_VECTORS_REVERSED) {
      const x = pos.x + vector.x
      if (x < 0 || x > 49) {
        continue
      }
      const y = pos.y + vector.y
      if (y < 0 || y > 49) {
        continue
      }
      const newPos = new RoomPosition(x, y, this.roomName)
      const goal = { pos: newPos, range: structureRange }
      goals.push(goal)
    }
  }

  const creepRange = 2
  for (const creep of hostileCreeps) {
    const pos = creep.pos
    for (const vector of FORMATION_VECTORS_REVERSED) {
      const x = pos.x + vector.x
      if (x < 0 || x > 49) {
        continue
      }
      const y = pos.y + vector.y
      if (y < 0 || y > 49) {
        continue
      }
      const newPos = new RoomPosition(x, y, this.roomName)
      const goal = { pos: newPos, range: creepRange }
      goals.push(goal)
    }
  }

  const dijkstra = this.room.dijkstra(this.pos, goals, quadCostArray)
  return this._skirmishPath = dijkstra
}

Quad.prototype.getBulldozeQuadCostArray = function () {
  if (this._bulldozeQuadCostArray) {
    return this._bulldozeQuadCostArray
  }

  const length = 2500

  const costArray = this.getCostArrayForBulldoze() // use heap to cache

  const result = new Uint32Array(length)

  const damageArray = this.room.getDamageArray()

  for (let i = 0; i < length; i++) {
    const costBefore = costArray[i]
    result[i] = costBefore
    if (!IGNORE_DAMAGE_WHEN_PATHING) {
      const netHeal = this.healPower - damageArray[i] - HEAL_BUFFER
      if (netHeal < 0 && costBefore !== 0) {
        result[i] += 20
      }
    }
  }

  const myCreeps = this.room.find(FIND_MY_CREEPS)
  const allyCreeps = this.room.find(FIND_HOSTILE_CREEPS).filter(creep => creep.isAlly())

  for (const creep of myCreeps) {
    if (!this.names.includes(creep.name)) {
      for (const pos of creep.pos.getInRange(1)) {
        const packed = packCoord(pos.x, pos.y)
        if (result[packed] > 0) {
          result[packed] = 0
        }
      }
    }
  }

  for (const creep of allyCreeps) {
    const pos = creep.pos
    const packed = packCoord(pos.x, pos.y)
    if (result[packed] > 0) {
      result[packed] += 200
    }
  }

  const quadCostArray = transformCostArrayForQuad(result, this.roomName)

  return this._bulldozeQuadCostArray = quadCostArray
}

Quad.prototype.getCostArrayForBulldoze = function () {
  if (this.heap._costArrayForBulldozeRoomName !== this.room.name) {
    delete this.heap._costArrayForBulldozeRoomName
    delete this.heap._costArrayForBulldoze
  }

  if (this.heap._costArrayForBulldoze !== undefined) {
    return this.heap._costArrayForBulldoze
  }

  const power = this.attackPower + this.dismantlePower

  if (power === 0) {
    return undefined
  }

  const costArray = this.room.getCostArrayForBulldoze(power)

  this.heap._costArrayForBulldozeRoomName = this.room.name
  return this.heap._costArrayForBulldoze = costArray
}

Quad.prototype.rangedMassAttack = function () {
  const hostileCreeps = this.room.findHostileCreeps()
  for (const creep of this.creeps) {
    const hostileCreepsInRange = creep.pos.findInRange(hostileCreeps, 3)
    if (hostileCreepsInRange.length > 0) {
      creep.rangedMassAttack()
    }
  }
}

Creep.prototype.getPriorityTarget = function (pos) {
  const structures = pos.lookFor(LOOK_STRUCTURES).filter(structure => structure.hits)
  const hostileCreeps = pos.lookFor(LOOK_CREEPS).filter(creep => !creep.my && !creep.isAlly())

  if (structures.length === 0 && hostileCreeps.length === 0) {
    return undefined
  }

  let hostileStructure = undefined
  let neutralStructure = undefined

  for (const structure of structures) {
    if (structure.structureType === 'rampart') {
      return structure
    }
    if (structure.hits === undefined) {
      continue
    }
    if (structure.my === false) {
      hostileStructure = structure
      continue
    }
    if (neutralStructure === undefined || structure.hits > neutralStructure.hits) {
      neutralStructure = structure
      continue
    }
  }

  if (hostileCreeps.length > 0) {
    return hostileCreeps[0]
  }

  if (hostileStructure) {
    return hostileStructure
  }

  if (neutralStructure) {
    return neutralStructure
  }

  return undefined
}

Quad.prototype.retreat = function () {
  const costs = this.costMatrix
  const damageArray = this.getDamageArray(this.moveCost)
  const packedNow = packCoord(this.pos.x, this.pos.y)
  const damageNow = damageArray[packedNow]

  const adjacentPositions = this.pos.getAtRange(1)
  const adjacentPositionsFiltered = adjacentPositions.filter(pos => {
    if (!this.isAbleToStep(pos)) {
      return false
    }
    if (costs.get(pos.x, pos.y) >= HALF_EDGE_COST) {
      return false
    }
    const packed = packCoord(pos.x, pos.y)
    const damage = damageArray[packed]
    if (damage > damageNow) {
      return false
    }
    return true
  })

  const posToRetreat = getMinObject(adjacentPositionsFiltered, (pos) => {
    const packed = packCoord(pos.x, pos.y)
    const addition = pos.getQuadSquarePositions().find(squarePos => squarePos.isSwamp) ? 100 : 0
    return damageArray[packed] + addition
  })

  if (!posToRetreat) {
    this.leader.say('noPos')
    const exitPositions = this.room.find(FIND_EXIT)
    const goals = exitPositions.map(pos => { return { pos, range: 2 } })
    this.moveInFormation(goals)
    return
  }

  const direction = this.pos.getDirectionTo(posToRetreat)
  this.move(direction)
}

Quad.prototype.getRallyExit = function (targetRoomName) {
  const cachedResult = this.leader.memory.rallyExit
  if (cachedResult && cachedResult['targetRoomName'] === targetRoomName) {
    return cachedResult
  }

  const thisRoomName = this.roomName

  const route = Overlord.findRoutesWithPortal(thisRoomName, targetRoomName, 2)

  if (route === ERR_NO_PATH) {
    return undefined
  }

  const lastSegment = route[route.length - 1]
  if (!lastSegment) {
    return undefined
  }

  const roomName = lastSegment[lastSegment.length - 2] || thisRoomName

  const exit = Game.map.findExit(roomName, targetRoomName)
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
    return undefined
  }

  const result = { exit, roomName, targetRoomName }

  return this.leader.memory.rallyExit = result
}

Quad.prototype.snakeTravel = function (goals) {
  goals = normalizeGoals(goals)

  if (this.pos.isInGoal(goals)) {
    delete this.leader.memory.snakeFormed
    return 'finished'
  }

  if (Game.time % 10 === 0) {
    delete this.leader.memory.snakeFormed
  }

  if (!this.leader.memory.snakeFormed && this.isSnakeFormedUp) {
    this.leader.memory.snakeFormed = true
  }

  if (!this.leader.memory.snakeFormed && Game.time % 3 === 0) {
    this.formSnake()
    return ERR_BUSY
  }

  if (this.fatigue > 0) {
    return ERR_TIRED
  }

  this.leader.moveMy(goals, { ignoreCreeps: 20, ignoreMap: 2, visualize: true })

  for (i = 1; i < this.creeps.length; i++) {
    const formerCreep = this.creeps[i - 1]
    const creep = this.creeps[i]
    if (creep.pos.roomName !== formerCreep.pos.roomName || creep.pos.getRangeTo(formerCreep) > 1) {
      creep.moveMy(formerCreep, { ignoreMap: 2 })
      continue
    }
    const direction = creep.pos.getDirectionTo(formerCreep)
    creep.move(direction)
  }

  return OK
}

Quad.prototype.getIsSnakeFormedUp = function () {
  for (i = 1; i < this.creeps.length; i++) {
    const formerCreep = this.creeps[i - 1]
    const creep = this.creeps[i]
    if (!isEdgeCoord(creep.pos.x, creep.pos.y)
      && !isEdgeCoord(formerCreep.pos.x, formerCreep.pos.y)
      && creep.pos.getRangeTo(formerCreep) > 1) {
      return false
    }
  }
  return true
}

Quad.prototype.formSnake = function () {
  for (i = 1; i < this.creeps.length; i++) {
    const formerCreep = this.creeps[i - 1]
    const creep = this.creeps[i]
    if (creep.pos.getRangeTo(formerCreep) > 1) {
      creep.moveMy({ pos: formerCreep.pos, range: 1 }, { ignoreMap: 2 })
    }
  }
}

Quad.prototype.quadHeal = function () {
  if (this.hits === this.hitsMax) {
    this.preHeal()
    return
  }
  this.activeHeal()
  return
}

Quad.prototype.preHeal = function () {
  for (const creep of this.creeps) {
    creep.heal(creep)
  }
}

Quad.prototype.activeHeal = function () {
  const damageArray = this.getDamageArray()

  this.creeps.forEach(creep => {
    const packed = packCoord(creep.pos.x, creep.pos.y)
    const damage = damageArray[packed]
    creep.virtualHits = creep.hits - creep.getEffectiveDamage(damage)
  })
  const creeps = [...this.creeps].sort((a, b) => b.healPower - a.healPower)
  for (const creep of creeps) {
    if (creep.healPower === 0) {
      continue
    }
    const mostInjuredCreep = getMinObject(this.creeps, (a) => a.virtualHits)

    creep.heal(mostInjuredCreep)

    mostInjuredCreep.virtualHits += creep.healPower
  }
}

Quad.prototype.getFormation = function () {
  if (!this.leader) {
    return undefined
  }

  const result = new Array(4)

  const x = this.pos.x
  const y = this.pos.y

  for (let i = 0; i < FORMATION_VECTORS.length; i++) {
    const vector = FORMATION_VECTORS[i]
    const newX = vector.x + x
    const newY = vector.y + y
    if (newX < 0 || newX > 49 || newY < 0 || newY > 49) {
      continue
    }
    const pos = new RoomPosition(newX, newY, this.roomName)

    if (pos.isWall) {
      continue
    }

    result[i] = pos
  }

  return result
}

Quad.prototype.getIsFormed = function () {
  const formation = this.formation
  const creeps = this.creeps
  for (let i = 0; i < Math.min(creeps.length, formation.length); i++) {
    const creep = creeps[i]
    const index = getIndex(creep, i)
    const formationPos = formation[index]
    if (!formationPos) {
      continue
    }

    if (creep.pos.roomName !== this.roomName) {
      if (creep.pos.getRangeToMy(formationPos) > 0) {
        return false
      }
    } else if (!creep.pos.isEqualTo(formationPos)) {
      return false
    }

  }
  this.resetFormationToFormUp()
  return true
}

Quad.prototype.getCreeps = function () {
  if (this._creeps) {
    return this._creeps
  }

  const result = new Array(4)
  for (let i = 0; i < 4; i++) {
    const name = this.names[i]
    const creep = Game.creeps[name]
    if (!creep || creep.spawning) {
      continue
    }
    const index = getIndex(creep, i)
    result[index] = creep
  }

  return this._creeps = result.filter(creep => creep !== undefined)
}

global.transformCostArrayForQuad = function (costArray, roomName) {
  const result = new Uint32Array(2500)
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const packed = packCoord(x, y)
      let cost = costArray[packed]
      for (const vector of FORMATION_NEIGHBOR_VECTORS) {
        const newX = vector.x + x
        const newY = vector.y + y
        if (newX < 0 || newX > 49 || newY < 0 || newY > 49) {
          continue
        }
        const newPacked = packCoord(newX, newY)
        const newCost = costArray[newPacked]

        if (cost === 0 || newCost === 0) {
          cost = 0
          break
        }
        cost += newCost
      }
      result[packed] = cost
      if (BULLDOZE_COST_VISUAL) {
        new RoomVisual(roomName).text(cost, x, y, { font: 0.3 })
      }
    }
  }
  return result
}

function getQuadCostMatrix(roomName) {
  const room = Game.rooms[roomName]
  const basicCosts = room ? room.basicCostmatrix.clone() : new PathFinder.CostMatrix

  const costs = new PathFinder.CostMatrix
  const terrain = new Room.Terrain(roomName)

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const terrainMask = terrain.get(x, y)
      if (terrainMask === TERRAIN_MASK_WALL) {
        basicCosts.set(x, y, 255)
        continue
      }

      if (isEdgeCoord(x, y) && basicCosts.get(x, y) < HALF_EDGE_COST) {
        basicCosts.set(x, y, HALF_EDGE_COST)
      }

      if (terrainMask === TERRAIN_MASK_SWAMP && basicCosts.get(x, y) < 5) {
        basicCosts.set(x, y, 5)
        continue
      }
    }
  }

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let cost = basicCosts.get(x, y)
      for (const vector of FORMATION_NEIGHBOR_VECTORS) {
        const newX = vector.x + x
        const newY = vector.y + y
        if (newX < 0 || newX > 49 || newY < 0 || newY > 49) {
          cost = Math.max(cost, EDGE_COST)
          continue
        }
        cost = Math.max(cost, basicCosts.get(newX, newY))
      }
      costs.set(x, y, cost)
      if (QUAD_COST_VISUAL) {
        new RoomVisual(roomName).text(cost, x, y, { font: 0.5 })
      }
    }
  }
  return costs
}

/**
 * 
 * @param {object} goals - a goal {pos, range} or an array of goals
 * @returns 
 */
Quad.prototype.moveInFormation = function (goals) {
  if (this.fatigue > 0) {
    return ERR_TIRED
  }

  if (this.heap.indivisualMove > Game.time) {
    this.indivisualMove(goals)
    return
  }

  if (!this.isFormed) {
    console.log('not formed')
    console.log(`creep positions: ${this.creeps.map(creep => creep.pos)}`)
    console.log(`formation positions: ${this.formation}`)
    this.formUp()
    return
  }

  const search = this.getSearchTo(goals)
  if (search.incomplete) {
    this.indivisualMove(goals)
    return
  }

  const path = search.path
  visualizePath(path, this.pos)

  const nextPos = path[0]

  if (!nextPos) {
    this.indivisualMove(goals)
    return
  }

  if (this.pos.roomName === nextPos.roomName) {
    if (this.isAbleToStep(nextPos)) {
      const direction = this.pos.getDirectionTo(nextPos)
      this.move(direction)
      return
    }
  }
}

Quad.prototype.indivisualMove = function (goals) {
  for (const creep of this.creeps) {
    creep.moveMy(goals, { ignoreMap: 2 })
  }
}

Quad.prototype.getSearchTo = function (goals) {
  const search = PathFinder.search(this.pos, goals, {
    roomCallback: (roomName) => getQuadCostMatrix(roomName)
  })

  return search
}

Quad.prototype.move = function (direction) {
  if (this.fatigue > 0) {
    const toPull = []
    const toBePulled = []
    for (const creep of this.creeps) {
      if (creep.fatigue > 0) {
        toPull.push(creep)
      } else {
        toBePulled.push(creep)
      }
    }

    while (toPull.length > 0 && toBePulled.length > 0) {
      const puller = toPull.shift()
      const target = toBePulled.shift()
      puller.pull(target)
      toPull.push(target)
    }

    return ERR_TIRED
  }
  for (const creep of this.creeps) {
    if (!isEdgeCoord(creep.pos.x, creep.pos.y) && !isEdgeCoord(this.pos.x, this.pos.y) && creep.pos.getRangeTo(this.pos) > 1) {
      continue
    }
    creep.move(direction)
  }
  return OK
}

Quad.prototype.getIsCompact = function () {
  const creeps = this.creeps
  for (let i = 0; i < creeps.length - 1; i++) {
    const creepA = creeps[i]
    for (let j = i + 1; j < creeps.length; j++) {
      const creepB = creeps[j]
      if (!creepA || !creepB) {
        continue
      }
      if (creepA.pos.getRangeTo(creepB.pos) > 1) {
        return false
      }
    }
  }
  return true
}

Quad.prototype.getDamageArray = function () {
  if (this._damageArray) {
    return this._damageArray
  }

  const costArray = new Uint16Array(2500)

  const towerDamageArray = this.room.getTowerDamageArray()

  for (let i = 0; i < 2500; i++) {
    costArray[i] = towerDamageArray[i]
  }

  const hostileCreeps = this.room.findHostileCreeps()
  for (const creep of hostileCreeps) {
    if (creep.attackPower > 0) {
      for (const pos of creep.pos.getInRange(1)) {
        const packed = packCoord(pos.x, pos.y)
        costArray[packed] += creep.attackPower
        costArray[packed] += creep.rangedAttackPower
      }
    }
    if (creep.rangedAttackPower > 0) {
      for (let range = 2; range <= 3; range++) {
        for (const pos of creep.pos.getAtRange(range)) {
          const packed = packCoord(pos.x, pos.y)
          costArray[packed] += creep.rangedAttackPower
        }
      }
    }
  }
  return this._damageArray = costArray
}

function getIndex(creep, index) {
  const position = creep.memory.position
  if (position !== undefined) {
    return position
  }
  return index
}

module.exports = {
  Quad,
  QUAD_BLINKY_BODY,
  QUAD_BLINKY_BOOST_RESOURCES,
}