const { getCombatInfo } = require("./overlord_tasks_guard")

Creep.prototype.healWounded = function () {
  const wounded = this.room.find(FIND_MY_CREEPS).filter(creep => creep.hitsMax - creep.hits > 0)
  if (wounded.length) {
    const target = this.pos.findClosestByRange(wounded)
    if (this.pos.getRangeTo(target) > 1) {
      this.moveMy({ pos: target.pos, range: 1 }, { staySafe: false, ignoreMap: 1 })
    }
    this.heal(target)
    return OK
  }
  return ERR_NOT_FOUND
}

Creep.prototype.handleCombatants = function (targets) {
  this.harasserRangedAttack()
  this.activeHeal()

  const myCombatants = this.room.getMyCombatants()

  const captain = myCombatants.find(creep => creep.id !== this.id) || this

  const companions = this.pos.findInRange(myCombatants, 10)

  // look for closest target

  const closestTarget = this.pos.findClosestByPath(targets)

  if (!closestTarget) {
    return ERR_NO_PATH
  }

  const enemyCompanions = closestTarget.pos.findInRange(targets, 4)

  const combatInfoMy = getCombatInfo(companions)
  const combatInfoEnemy = getCombatInfo(enemyCompanions)

  const canWinWithKiting = combatInfoMy.canWinWithKiting(combatInfoEnemy)
  const canWin = combatInfoMy.canWin(combatInfoEnemy)

  const idealRange = getIdealRange(canWin, canWinWithKiting)

  const range = this.pos.getRangeTo(closestTarget)

  if (!idealRange) {
    this.say('😱', true)
    if (range > 5 && this.pos.getRangeTo(captain.pos) > 3) {
      this.moveMy({ pos: captain.pos, range: 3 }, { ignoreCreeps: false, staySafe: false, ignoreMap: 2 })
      return
    }
    this.fleeFrom(closestTarget, 20, 1)
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
    this.fleeFrom(closestTarget, 10, 2)
    return
  }
}

const RANGE_FOR_KITING = 3
const RANGE_FOR_ANGRY = 2

function getIdealRange(canWin, canWinWithKiting) {
  if (canWin) {
    return RANGE_FOR_ANGRY
  }
  if (canWinWithKiting) {
    return RANGE_FOR_KITING
  }
  return undefined
}

Creep.prototype.harasserRangedAttack = function (attackNeutralStructures = false) {
  const allies = this.room.find(FIND_CREEPS).filter(creep => creep.isAlly())
  const isAlly = this.pos.findInRange(allies, 3).length > 0

  let rangedMassAttackTotalDamage = 0

  const positions = this.pos.getInRange(3)
  const rangedAttackPower = this.rangedAttackPower

  let rangedAttackTarget = undefined

  for (const pos of positions) {
    const priorityTarget = pos.lookFor(LOOK_CREEPS).find(creep => !creep.my && !creep.isAlly())

    if (!priorityTarget) {
      continue
    }

    if (rangedAttackTarget === undefined) {
      rangedAttackTarget = priorityTarget
    } else if (priorityTarget.hits / priorityTarget.hitsMax < rangedAttackTarget.hits / rangedAttackTarget.hitsMax) {
      rangedAttackTarget = priorityTarget
    } else if (priorityTarget.hits / priorityTarget.hitsMax === rangedAttackTarget.hits / rangedAttackTarget.hitsMax && priorityTarget.healPower > rangedAttackTarget.healPower) {
      rangedAttackTarget = priorityTarget
    }

    if (priorityTarget.my === false) {
      const range = this.pos.getRangeTo(pos)

      if (range <= 1 && !isAlly) {
        this.rangedMassAttack()
        return OK
      }

      const rangeConstant = range <= 1 ? 1 : range <= 2 ? 0.4 : 0.1
      const damage = rangedAttackPower * rangeConstant

      rangedMassAttackTotalDamage += damage
      continue
    }
  }

  if (rangedMassAttackTotalDamage >= rangedAttackPower && !isAlly) {
    this.rangedMassAttack()
    return OK
  }

  if (rangedAttackTarget) {
    this.rangedAttack(rangedAttackTarget)
    return OK
  }
  return ERR_NOT_FOUND
}

Creep.prototype.activeHeal = function () {
  const myCreepsInRange = this.pos.findInRange(FIND_MY_CREEPS, 3)

  let adjacentWounded = undefined
  let rangedWounded = undefined

  for (const creep of myCreepsInRange) {
    if (creep.hits === creep.hitsMax) {
      continue
    }

    // find creep with lowest hits ratio
    if (this.pos.getRangeTo(creep.pos) <= 1) {
      if (!adjacentWounded) {
        adjacentWounded = creep
        continue
      }
      const hitsRatioBefore = adjacentWounded.hits / adjacentWounded.hitsMax
      const hitsRatioNow = creep.hits / creep.hitsMax
      if (hitsRatioNow < hitsRatioBefore) {
        adjacentWounded = creep
      }
      continue
    }

    if (adjacentWounded) {
      continue
    }

    // find creep with lowest hits ratio
    if (!rangedWounded) {
      rangedWounded = creep
      continue
    }
    const hitsRatioBefore = rangedWounded.hits / rangedWounded.hitsMax
    const hitsRatioNow = creep.hits / creep.hitsMax
    if (hitsRatioNow < hitsRatioBefore) {
      rangedWounded = creep
    }
  }

  if (adjacentWounded) {
    this.heal(adjacentWounded)
    return
  }

  if (rangedWounded) {
    this.rangedHeal(rangedWounded)
    return
  }

  this.heal(this)
}

Creep.prototype.flee = function (range = 10) {
  const enemyCombatants = this.room.getEnemyCombatants()
  if (enemyCombatants.length === 0) {
    ERR_NOT_FOUND
  }
  const closestEnemyCombatant = this.pos.findClosestByRange(enemyCombatants)
  if (this.pos.getRangeTo(closestEnemyCombatant) < range) {
    this.fleeFrom(enemyCombatants, range)
    return OK
  }
  return ERR_NOT_IN_RANGE
}

Room.prototype.requestBlinky = function (targetRoomName, options) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const defaultOptions = { energyCapacity: this.energyCapacityAvailable, task: undefined, boost: 0, moveFirst: false }
  const mergedOptions = { ...defaultOptions, ...options }
  const { energyCapacity, task, boost, moveFirst } = mergedOptions

  const model = getBlinkyModel(energyCapacity, { boost, moveFirst })

  if (!model) {
    return
  }

  const name = `${targetRoomName} blinky ${Game.time}_${this.spawnQueue.length}`

  const body = model.body

  const memory = {
    role: 'blinky',
    base: this.name,
    targetRoomName
  }

  const spawnOptions = { priority: 4 }

  const boostResources = model.boostResources

  if (boostResources) {
    spawnOptions.boostResources = boostResources
    memory.boosted = false
  }

  if (task) {
    memory.task = { category: task.category, id: task.id }
  }

  const request = new RequestSpawn(body, name, memory, spawnOptions)

  this.spawnQueue.push(request)
}

function getBlinkyModel(energyCapacity, options) {
  const defaultOptions = { boost: 0, moveFirst: false }
  const mergedOptions = { ...defaultOptions, ...options }
  const { boost, moveFirst } = mergedOptions

  if (boost === 0) {
    if (energyCapacity < 550) {
      return { body: blinkyBodyMaker(1, 1, 0, moveFirst), boostResources: undefined }
    }

    if (energyCapacity < 760) {
      return { body: blinkyBodyMaker(0, 1, 1, moveFirst), boostResources: undefined }
    }

    if (energyCapacity < 1300) {
      return { body: blinkyBodyMaker(1, 2, 1, moveFirst), boostResources: undefined }
    }

    if (energyCapacity < 1800) {
      return { body: blinkyBodyMaker(0, 5, 1, moveFirst), boostResources: undefined }
    }

    if (energyCapacity < 2260) {
      return { body: blinkyBodyMaker(5, 6, 1, moveFirst), boostResources: undefined }
    }

    if (energyCapacity < 5600) {
      return { body: blinkyBodyMaker(6, 8, 1, moveFirst), boostResources: undefined }
    }

    return { body: blinkyBodyMaker(0, 19, 6, moveFirst), boostResources: undefined }
  }

  if (boost === 3) {
    if (energyCapacity >= 6800) {
      return { body: parseBody('5t25r10m10h'), boostResources: ['XZHO2', 'XGHO2', 'XLHO2', 'XKHO2',] }
    }

    if (energyCapacity >= 5500) {
      return { body: parseBody('5t17r10h8m'), boostResources: ['XZHO2', 'XGHO2', 'XLHO2', 'XKHO2',] }
    }
  }

}

function blinkyBodyMaker(t, r, h, moveFirst = false) {
  const result = []
  for (let i = 0; i < t; i++) {
    result.push(TOUGH)
  }

  if (moveFirst) {
    for (let i = 0; i < (r + h + t); i++) {
      result.push(MOVE)
    }
  }

  for (let i = 0; i < r; i++) {
    result.push(RANGED_ATTACK)
  }

  if (!moveFirst) {
    for (let i = 0; i < (r + h + t); i++) {
      result.push(MOVE)
    }
  }

  for (let i = 0; i < h; i++) {
    result.push(HEAL)
  }
  return result
}

module.exports = {
  blinkyBodyMaker,
}