const { getCombatInfo } = require("./overlord_tasks_guard")

Creep.prototype.harass = function (roomName) {

}

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
    this.heal(rangedWounded)
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