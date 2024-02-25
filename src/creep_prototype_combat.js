const { getCombatInfo } = require('./overlord_tasks_guard')

const RANGE_FOR_KITING = 3
const RANGE_FOR_ANGRY = 2

Creep.prototype.blinkyFight = function (targetRoomName, options = {}) {
  const ignoreSourceKeepers = options.ignoreSourceKeepers || false
  const friendlies = options.friendlies
    ? options.friendlies.map((name) => Game.creeps[name])
    : thisRoom.getMyCombatants()

  this.activeHeal()

  const isFriendlyRoom = Overlord.getIsFriendlyRoom(this.room.name)

  this.activeRangedAttack({ attackNeutralStructures: !isFriendlyRoom })

  if (this.memory.fleeTime && (Game.time < this.memory.fleeTime || this.hits < this.hitsMax)) {
    const exits = Game.map.describeExits(this.room.name)

    const findExits = []
    for (const exitDirection in exits) {
      const exitRoomName = exits[exitDirection]
      if (Overlord.getIsDangerousRoom(exitRoomName)) {
        continue
      }
      findExits.push(exitDirection)
    }

    this.flee({ findExits })
    return
  } else {
    delete this.memory.fleeTime
  }

  if (this.room.name !== targetRoomName) {
    this.moveToRoom(targetRoomName)
    return
  }

  // look for closest target

  let targets = this.room.getEnemyCombatants()

  if (ignoreSourceKeepers) {
    targets = targets.filter((creep) => creep.owner.username !== 'Source Keeper')
  }

  let closestTarget = this.pos.findClosestByRange(targets)

  if (closestTarget) {
    const enemyCompanions = closestTarget.pos.findInRange(targets, 4)

    const combatInfoMy = getCombatInfo(friendlies)

    if (this.room.isMy) {
      const numTower = this.room.structures.tower.filter(
        (tower) => tower.RCLActionable && tower.store.getUsedCapacity(RESOURCE_ENERGY) >= 10
      ).length
      combatInfoMy.attack += numTower * 150
      combatInfoMy.rangedAttack += numTower * 150
    }

    const combatInfoEnemy = getCombatInfo(enemyCompanions)

    const canWinWithKiting = combatInfoMy.canWinWithKiting(combatInfoEnemy)
    const canWin = combatInfoMy.canWin(combatInfoEnemy)

    const idealRange = getIdealRange(canWin, canWinWithKiting)

    const range = this.pos.getRangeTo(closestTarget)

    if (!idealRange) {
      this.say('😱', true)
      this.fleeFrom(closestTarget, 20, 2)
      this.memory.fleeTime = Game.time + 5
      return
    }

    if (idealRange === RANGE_FOR_KITING) {
      this.say('🤚', true)
    } else if (idealRange === RANGE_FOR_ANGRY) {
      this.say('💢', true)
    }

    if (range > idealRange) {
      this.moveMy({ pos: closestTarget.pos, range: idealRange }, { ignoreCreeps: false, staySafe: false, ignoreMap: 2 })
      return
    }

    if (range < idealRange) {
      this.fleeFrom(closestTarget, 10, 1)
      return
    }

    return
  }

  // civillians
  targets = this.room.findHostileCreeps()
  if (ignoreSourceKeepers) {
    targets = targets.filter((creep) => creep.owner.username !== 'Source Keeper')
  }

  closestTarget = this.pos.findClosestByRange(targets)

  if (closestTarget) {
    const idealRange = 1
    const range = this.pos.getRangeTo(closestTarget)

    if (range > idealRange) {
      this.moveMy({ pos: closestTarget.pos, range: idealRange }, { ignoreCreeps: false, staySafe: false, ignoreMap: 2 })
      return
    }

    if (range < idealRange) {
      this.fleeFrom(closestTarget, 10, 1)
      return
    }

    return
  }

  if (!isFriendlyRoom) {
    const structuresToWreck = this.room.find(FIND_STRUCTURES).filter((structure) => {
      if (!structure.hits) {
        return false
      } else {
        return true
      }
    })

    const targetStructure = this.pos.findClosestByPath(structuresToWreck)

    if (targetStructure) {
      if (this.pos.getRangeTo(targetStructure) > 3) {
        this.moveMy({ pos: targetStructure.pos, range: 3 }, { staySafe: false, ignoreMap: 1 })
        return
      }

      this.activeRangedAttack({ attackNeutralStructures: true })
      return
    }

    const constructionSites = this.room
      .find(FIND_CONSTRUCTION_SITES)
      .filter(
        (constructionSite) => !constructionSite.my && !constructionSite.pos.isWall && constructionSite.progress > 0
      )

    const closestConstructionSite = this.pos.findClosestByPath(constructionSites)
    if (closestConstructionSite) {
      this.moveMy(closestConstructionSite)
      return
    }
  }

  this.memory.harassComplete = true
}

function getIdealRange(canWin, canWinWithKiting) {
  if (canWin) {
    return RANGE_FOR_ANGRY
  }
  if (canWinWithKiting) {
    return RANGE_FOR_KITING
  }
  return undefined
}

Overlord.getIsDangerousRoom = function (roomName) {
  if (this.getIsFriendlyRoom()) {
    return false
  }

  const roomIntel = this.getIntel(roomName)

  if (!roomIntel) {
    return true
  }

  if (roomIntel[scoutKeys.numTower] > 0) {
    return true
  }

  return false
}

Overlord.getIsFriendlyRoom = function (roomName) {
  const roomIntel = this.getIntel(roomName)

  if (!roomIntel) {
    return false
  }

  if (roomIntel[scoutKeys.isMy]) {
    return true
  }

  if (roomIntel[scoutKeys.isMyRemote]) {
    return true
  }

  if (roomIntel[scoutKeys.reservationOwner] && allies.includes(roomIntel[scoutKeys.reservationOwner])) {
    return true
  }

  return false
}

Creep.prototype.flee = function (options = {}) {
  const ignoreFriendly = options.ignoreFriendly || false
  const ignoreEnemy = options.ignoreEnemy || false
  const findExits = options.findExits || [FIND_EXIT]

  const thisRoom = this.room

  const combatants = thisRoom.getEnemyCombatants()

  if (combatants.length === 0) {
    const goal = { pos: new RoomPosition(25, 25, thisRoom.name), range: 20 }

    this.moveMy(goal)

    return
  }

  const moveCost = this.getMoveCost()

  const costsForFlee = ignoreEnemy ? thisRoom.basicCostmatrix : thisRoom.getCostMatrixForConflict()

  const goals = []

  const exits = []

  for (const findExit of findExits) {
    exits.push(...thisRoom.find(findExit))
  }

  for (const pos of exits) {
    if (pos.getRangeTo(this) < pos.getClosestRange(combatants)) {
      goals.push({ pos, range: 0 })
    }
  }

  if (goals.length === 0) {
    for (const pos of exits) {
      goals.push({ pos, range: 0 })
    }
  }

  if (!ignoreFriendly) {
    const friendlies = thisRoom.getMyCombatants()
    for (const friendly of friendlies) {
      if (friendly.id === this.id) {
        continue
      }
      if (friendly.pos.getRangeTo(this) <= 5) {
        continue
      }
      if (friendly.pos.getRangeTo(this) < friendly.pos.getRangeTo(combatants)) {
        goals.push({ pos, range: 1 })
      }
    }
  }

  const search = PathFinder.search(this.pos, goals, {
    plainCost: Math.max(1, Math.ceil(2 * moveCost)),
    swampCost: Math.max(1, Math.ceil(20 * moveCost)),
    roomCallback: function (roomName) {
      const intel = Overlord.getIntel(roomName)
      if ((!Game.rooms[roomName] || !Game.rooms[roomName].isMy) && intel && intel[scoutKeys.numTower]) {
        return false
      }
      if (roomName === thisRoom.name) {
        return costsForFlee
      }
    },
  })

  const path = search.path
  if (!path) {
    this.say(`⚠️`, true)
    return
  }

  visualizePath(path, this.pos)
  const nextPos = path[0]

  if (nextPos) {
    costsForFlee.set(nextPos.x, nextPos.y, 255)
    costsForFlee.set(this.pos.x, this.pos.y, this.room.basicCostmatrix.get(this.pos.x, this.pos.y))
    this.setNextPos(nextPos)
  }

  this.resetPath()
}

Creep.prototype.fleeFrom = function (from, range = 10, maxRooms = 2) {
  from = Array.isArray(from) ? from : [from]
  from = from.map((target) => {
    const pos = target.pos || target
    return { pos, range }
  })

  const room = this.room
  const moveCost = this.getMoveCost()
  const costsForFlee = room.getCostMatrixForConflict().clone()
  const search = PathFinder.search(this.pos, from, {
    plainCost: Math.max(1, Math.ceil(2 * moveCost)),
    swampCost: Math.max(1, Math.ceil(20 * moveCost)),
    maxRooms,
    flee: true,
    roomCallback: function (roomName) {
      const intel = Overlord.getIntel(roomName)
      if (intel && intel[scoutKeys.numTower]) {
        return false
      }
      if (roomName === room.name) {
        return costsForFlee
      }
    },
  })

  const path = search.path
  if (!path) {
    this.say(`⚠️`, true)
    return
  }

  visualizePath(path, this.pos)
  const nextPos = path[0]

  if (nextPos) {
    costsForFlee.set(nextPos.x, nextPos.y, 255)
    costsForFlee.set(this.pos.x, this.pos.y, this.room.basicCostmatrix.get(this.pos.x, this.pos.y))
    this.setNextPos(nextPos)
  }

  this.resetPath()
}

Room.prototype.getCostMatrixForConflict = function () {
  if (this._costMatrixForConflict) {
    return this._costMatrixForConflict
  }

  const costs = this.basicCostmatrix.clone()

  const terrain = new Room.Terrain(this.name)

  const enemyCombatants = this.getEnemyCombatants()
  for (const enemyCombatant of enemyCombatants) {
    const range = enemyCombatant.rangedAttackPower > 0 ? 5 : 3
    for (const pos of enemyCombatant.pos.getInRange(range)) {
      let cost = Math.ceil(30 / range)

      if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP) {
        cost *= 5
      }

      if (!pos.isWall && costs.get(pos.x, pos.y) < cost) {
        costs.set(pos.x, pos.y, cost)
      }
    }
  }

  return (this._costMatrixForConflict = costs)
}

Creep.prototype.activeRangedAttack = function (options = {}) {
  const attackNeutralStructures = options.attackNeutralStructures || false

  const allies = this.room.find(FIND_CREEPS).filter((creep) => creep.isAlly())
  const isAlly = this.pos.findInRange(allies, 3).length > 0

  const positions = this.pos.getInRange(3)

  let rangedAttackTarget = undefined
  let rangedMassAttackTotalCounter = 0

  for (const pos of positions) {
    const priorityTarget = pos.getPriorityTarget({ attackNeutralStructures })

    if (!priorityTarget) {
      continue
    }

    if (!rangedAttackTarget) {
      rangedAttackTarget = priorityTarget
    } else {
      rangedAttackTarget = moreImportantTarget(priorityTarget, rangedAttackTarget)
    }

    if (priorityTarget.my === false) {
      const range = this.pos.getRangeTo(pos)

      if (range <= 1 && !isAlly) {
        this.rangedMassAttack()
        return OK
      }

      const rangeConstant = range <= 1 ? 10 : range <= 2 ? 4 : 1

      rangedMassAttackTotalCounter += rangeConstant
      continue
    }
  }

  if (rangedMassAttackTotalCounter >= 10 && !isAlly) {
    this.rangedMassAttack()
    return OK
  }

  if (rangedAttackTarget) {
    this.rangedAttack(rangedAttackTarget)
    return OK
  }
  return ERR_NOT_FOUND
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

/**
 * find priority target at certain position.
 * rampart > creep > other hostile structures > road/container(optional)
 * @param {object} options
 * @returns
 */
RoomPosition.prototype.getPriorityTarget = function (options) {
  const attackNeutralStructures = options.attackNeutralStructures || false

  let structures = undefined
  if (attackNeutralStructures) {
    structures = this.lookFor(LOOK_STRUCTURES).filter((structure) => structure.hits)
  } else {
    structures = this.lookFor(LOOK_STRUCTURES).filter(
      (structure) => structure.hits && structure.owner && ![...allies, MY_NAME].includes(structure.owner.username)
    )
  }

  const hostileCreeps = this.lookFor(LOOK_CREEPS).filter((creep) => !creep.my && !creep.isAlly())

  if (structures.length === 0 && hostileCreeps.length === 0) {
    return undefined
  }

  let hostileStructure = undefined
  let neutralStructure = undefined

  for (const structure of structures) {
    if (structure.structureType === 'rampart') {
      return structure
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

Room.prototype.getIsMy = function () {
  return this.isMy || Overlord.getAllRemoteNames().includes(this.name)
}
