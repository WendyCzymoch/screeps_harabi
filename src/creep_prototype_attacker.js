const { config } = require('./config')

const IGNORE_TOWER_DAMAGE = config.duo.IGNORE_TOWER_DAMAGE
const IMPORTANT_STRUCTURE_TYPES = config.IMPORTANT_STRUCTURE_TYPES

const EDGE_COST = 20

Creep.prototype.attackRoom = function (request) {
  const roomName = request.roomName
  const healer = Game.creeps[this.memory.healer]
  const status = this.hits / this.hitsMax
  const healerStatus = healer && !healer.spawning ? healer.hits / healer.hitsMax : 0

  if (this.memory.retreat && status === 1 && healerStatus === 1) {
    this.memory.retreat = false
  } else if (
    !this.memory.retreat &&
    (status < 0.9 || healerStatus < 0.9 || (this.room.controller && this.room.controller.safeMode))
  ) {
    this.memory.retreat = true
  }

  if (this.memory.retreat || this.memory.forceRetreat > Game.time) {
    this.attackNear()
    this.say('🚑', true)
    this.retreatFrom(roomName)
    return
  }

  if (Math.random() < 0.1) {
    const targetRoom = Game.rooms[roomName]
    if (targetRoom) {
      const nukes = targetRoom.find(FIND_NUKES)
      for (const nuke of nukes) {
        if (nuke.timeToLand < 50) {
          this.memory.forceRetreat = Math.max(this.memory.forceRetreat || 0, Game.time + nuke.timeToLand)
          return
        }
      }
    }
  }

  // check healer position. action only if healer is near
  if (this.room.name === healer.room.name) {
    const range = this.pos.getRangeTo(healer)
    if (range > 2) {
      this.attackNear()
      this.moveMy({ pos: healer.pos, range: 1 })
      healer.moveMy({ pos: this.pos, range: 1 })
      return
    }

    if (range > 1) {
      this.attackNear()
      healer.moveMy({ pos: this.pos, range: 1 })
      return
    }
  } else {
    this.moveMy(healer.pos)
  }

  if (healer.room.name === roomName && isEdgeCoord(healer.pos.x, healer.pos.y)) {
    const adjacents = healer.pos.getAtRange(1).sort((a, b) => Math.random() - 0.5)
    const nextPos = adjacents.find((pos) => pos.walkable)
    healer.move(healer.pos.getDirectionTo(nextPos))
    this.attackNear()
    this.follow(healer)
    return
  }

  // move to target room
  if (this.room.name !== roomName) {
    if (healer.fatigue === 0) {
      healer.moveToRoom(roomName, 2)
      healer.say('🐛', true)
    }
    this.attackNear()
    this.follow(healer)
    return
  }

  if (isEdgeCoord(this.pos.x, this.pos.y)) {
    const nextPos = healer.pos
      .getAtRange(1)
      .sort((a, b) => Math.random() - 0.5)
      .find((pos) => this.pos.isNearTo(pos) && !isEdgeCoord(pos.x, pos.y) && pos.walkable)
    this.attackNear()
    this.moveMy(nextPos)
    return
  }

  healer.follow(this)

  const flag = this.room.find(FIND_FLAGS)[0]
  if (flag) {
    this.attackNear()
    this.moveMy({ pos: flag.pos, range: 0 })
    return
  }

  //check safeMode
  if (this.room.controller.safeMode > 0) {
    this.say('🚑', true)
    this.attackNear()
    this.retreatFrom(roomName)
    return
  }

  const names = [this.name, healer.name]
  // attack important structures
  const path = this.getPathToAttackImportantStructures(names)

  if (path === ERR_NOT_FOUND) {
    this.say('🚑', true)
    this.attackNear()
    this.retreatFrom(roomName)
    return
  }

  if (path[0]) {
    this.say('🔨', true)
    this.room.visual.poly(path, { stroke: 'red', strokeWidth: 0.3 })
    const rampartOnPath = path[0].lookFor(LOOK_STRUCTURES).filter((obj) => obj.structureType === 'rampart')[0]

    if (rampartOnPath) {
      this.attack(rampartOnPath)
      this.dismantle(rampartOnPath)
      return
    }

    const structureOnPath = path[0]
      .lookFor(LOOK_STRUCTURES)
      .filter((obj) => OBSTACLE_OBJECT_TYPES.includes(obj.structureType))[0]

    if (structureOnPath) {
      this.attack(structureOnPath)
      this.dismantle(structureOnPath)
      return
    }

    this.attackNear()

    if (healer.fatigue === 0) {
      this.setNextPos(path[0])
    }
    return
  }

  request.result = 'success'

  // attack anything else
  const hostileCreeps = request.type === 'worm' ? [] : this.room.findHostileCreeps()
  const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES).filter((structure) => {
    if (structure.structureType === 'controller') {
      return false
    }
    return true
  })
  const hostiles = [...hostileCreeps, ...hostileStructures]
  const hostile = this.pos.findClosestByRange(hostiles)

  if (this.pos.getRangeTo(hostile) > 1) {
    this.moveMy({ pos: hostile.pos, range: 1 })
  }

  this.attack(hostile)
  this.dismantle(hostile)
}

Creep.prototype.getPathToAttackImportantStructures = function (names) {
  const cachedPath = this.getCachedPathToAttack()

  if (cachedPath !== undefined && Math.random() < 0.95) {
    return cachedPath
  }

  const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES)
  const importantStructures = hostileStructures.filter((structure) =>
    IMPORTANT_STRUCTURE_TYPES.includes(structure.structureType)
  )

  const goals = importantStructures.map((structure) => {
    return { pos: structure.pos, range: 0 }
  })

  const power = this.attackPower + this.dismantlePower

  if (power === 0) {
    return
  }

  const costArray = this.room.getCostArrayForBulldoze(power)

  const damageArray = this.room.getTowerDamageArray()

  if (!IGNORE_TOWER_DAMAGE) {
    for (let i = 0; i < damageArray.length; i++) {
      const netHeal = this.totalHealPower - this.getEffectiveDamage(damageArray[i])
      if (netHeal < 0) {
        const parsed = parseCoord(i)
        this.room.visual.text('D', parsed.x, parsed.y)
        costArray[i] = 0
      }
    }
  }

  const creepsToAvoid = this.room.find(FIND_MY_CREEPS).filter((creep) => {
    if (!names.includes(creep.name)) {
      return true
    }
  })

  for (const creep of creepsToAvoid) {
    const pos = creep.pos
    const packed = packCoord(pos.x, pos.y)
    costArray[packed] = 0
  }

  const dijkstra = this.room.dijkstra(this.pos, goals, costArray)
  return (this.heap._pathToAttack = dijkstra)
}

Creep.prototype.getCachedPathToAttack = function () {
  const cachedPath = this.heap._pathToAttack
  if (!cachedPath) {
    return undefined
  }

  if (!Array.isArray(cachedPath)) {
    return undefined
  }

  if (cachedPath.length === 0) {
    return undefined
  }

  if (this.pos.getRangeTo(cachedPath[0]) === 1 && !isEdgeCoord(cachedPath[0].x, cachedPath[0].y)) {
    return cachedPath
  }

  if (this.pos.getRangeTo(cachedPath[0]) === 0 && cachedPath.length > 1) {
    this.heap._pathToAttack.shift()
    return this.heap._pathToAttack
  }
}

/**
 *
 * @returns Uint32Array with packed coord as keys and costs as values. 0 means cannot be passed
 */
Room.prototype.getCostArrayForBulldoze = function (attackPower) {
  const result = new Uint32Array(2500)
  const terrain = new Room.Terrain(this.name)

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const packed = packCoord(x, y)
      const pos = new RoomPosition(x, y, this.name)
      const structures = pos.lookFor(LOOK_STRUCTURES)

      const road = structures.find((structure) => structure.structureType === 'road')
      if (road) {
        result[packed] = 1
      } else if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue
      } else if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
        result[packed] = 5
      } else {
        result[packed] = 1
      }

      if (isEdgeCoord(x, y)) {
        result[packed] = EDGE_COST
        continue
      }

      result[packed] += Math.ceil(pos.getTotalHits() / attackPower)
    }
  }

  return result
}

Room.prototype.getDamageArray = function () {
  if (this._damageArray) {
    return this._damageArray
  }

  const addedRange = 1

  const costArray = new Uint16Array(2500)

  const towerDamageArray = this.getTowerDamageArray()

  for (let i = 0; i < 2500; i++) {
    costArray[i] = towerDamageArray[i]
  }

  const hostileCreeps = this.findHostileCreeps()
  for (const creep of hostileCreeps) {
    if (creep.attackPower > 0) {
      for (const pos of creep.pos.getInRange(1 + addedRange)) {
        const packed = packCoord(pos.x, pos.y)
        costArray[packed] += creep.attackPower
        costArray[packed] += creep.rangedAttackPower
      }
    }
    if (creep.rangedAttackPower > 0) {
      for (let range = 3; range <= 3 + addedRange; range++) {
        for (const pos of creep.pos.getAtRange(range)) {
          const packed = packCoord(pos.x, pos.y)
          costArray[packed] += creep.rangedAttackPower
        }
      }
    }
  }
  return (this._damageArray = costArray)
}

Room.prototype.getTowerDamageArray = function () {
  const cachedArray = this.heap._towerDamageArray
  if (cachedArray !== undefined) {
    // check if tower damage stayed same. boosting tower can change this.
    let packed = undefined
    for (let i = 0; i < 2500; i++) {
      if (cachedArray[i] > 0) {
        packed = i
        break
      }
    }
    const parsed = parseCoord(packed)
    const pos = new RoomPosition(parsed.x || 0, parsed.y || 0, this.name)
    if (packed && cachedArray[packed] === pos.getTowerDamageAt()) {
      return this.heap._towerDamageArray
    }
  }

  const costArray = new Uint16Array(2500)
  const roomName = this.name
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const pos = new RoomPosition(x, y, roomName)
      if (pos.isWall) {
        continue
      }
      const packed = packCoord(x, y)
      costArray[packed] = pos.getTowerDamageAt()
    }
  }

  return (this.heap._towerDamageArray = costArray)
}

RoomPosition.prototype.getTotalHits = function () {
  let result = 0

  const structures = this.lookFor(LOOK_STRUCTURES)
  for (const structure of structures) {
    if (structure.structureType === 'road') {
      continue
    }
    result += structure.hits
  }

  return result
}

Creep.prototype.attackNear = function () {
  if (this.attackPower > 0) {
    const nearHostileCreep = this.room
      .findHostileCreeps()
      .find((creep) => this.pos.getRangeTo(creep) <= 1 && !creep.pos.isRampart)

    if (nearHostileCreep) {
      this.attack(nearHostileCreep)
      return
    }
  }

  const nearHostileStructure = this.room.find(FIND_HOSTILE_STRUCTURES).find((structure) => {
    if (this.pos.getRangeTo(structure) > 1) {
      return false
    }

    if (structure.structureType === 'controller') {
      return false
    }

    if (structure.my) {
      return false
    }
    return true
  })

  if (nearHostileStructure) {
    this.dismantle(nearHostileStructure)
    this.attack(nearHostileStructure)
    return
  }
}

Creep.prototype.retreatFrom = function (roomName) {
  this.say('🏃‍♂️', true)

  this.attackNear()

  const healer = Game.creeps[this.memory.healer]

  if (!healer) {
    const exitPositions = this.room.find(FIND_EXIT)
    const goals = exitPositions.map((pos) => {
      return { pos, range: 0 }
    })
    this.moveMy(goals, { ignoreCreeps: false })
    return
  }

  if (this.room.name === healer.room.name && this.pos.getRangeTo(healer) > 1) {
    this.moveMy({ pos: healer.pos, range: 1 }, { ignoreCreeps: false })
    return
  }

  if (healer.room.name !== roomName) {
    healer.moveToRoom(healer.room.name)
    this.follow(healer)
    return
  }

  if (this.fatigue > 0 || healer.fatigue > 0) {
    return
  }

  const exitPositions = this.room.find(FIND_EXIT)
  const goals = exitPositions.map((pos) => {
    return { pos, range: 0 }
  })

  healer.moveMy(goals, { ignoreCreeps: false })
  this.follow(healer)
}

Creep.prototype.follow = function (target) {
  if (!target) {
    return
  }

  if (this.room.name !== target.room.name) {
    this.moveMy({ pos: target.pos, range: 0 })
    return
  }

  if (this.pos.getRangeTo(target) <= 1 && isEdgeCoord(this.pos.x, this.pos.y)) {
    const nearTarget = target.pos.getAtRange(1).filter((pos) => !isEdgeCoord(pos.x, pos.y))
    this.moveMy(this.pos.findClosestByRange(nearTarget))
    return
  }

  if (this.pos.getRangeTo(target) > 1) {
    this.moveMy({ pos: target.pos, range: 1 })
    return
  }

  const direction = this.pos.getDirectionTo(target)
  this.move(direction)
  this.setWorkingInfo(target.pos, 0)
  return
}

Creep.prototype.care = function (target) {
  const allies = this.room.find(FIND_CREEPS).filter((creep) => creep.isAlly())

  const alliesNear = this.pos.findInRange(allies, 3)
  const wounded = alliesNear.find((creep) => creep.hits < creep.hitsMax)

  if (this.rangedAttackPower) {
    this.activeRangedAttack()
  }

  if (wounded) {
    if (this.pos.getRangeTo(wounded) > 1) {
      this.rangedHeal(wounded)
      return
    } else {
      this.heal(wounded)
      return
    }
  }

  if (!target) {
    this.heal(this)
    return
  }

  if (this.room.name !== target.room.name) {
    this.heal(this)
    return
  }

  const targetToheal = this.hits / this.hitsMax >= target.hits / target.hitsMax ? target : this

  const range = this.pos.getRangeTo(targetToheal)

  if (range > 3) {
    this.heal(this)
    return
  }

  if (range > 1) {
    this.rangedHeal(targetToheal)
    return
  }

  if (this.heal(targetToheal) !== OK) {
    this.heal(this)
  }
}
