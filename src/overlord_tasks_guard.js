const { config } = require('./config')

Overlord.manageGuardTasks = function () {
  const tasks = Object.values(this.getTasksWithCategory('guard'))

  for (const request of tasks) {
    const roomInCharge = Game.rooms[request.roomNameInCharge]

    if (request.completed === true) {
      this.deleteTask(request)
      if (request.usernames && request.usernames.length > 0) {
        const usernames = request.usernames.join(', ')
        data.recordLog(
          `GUARD: guard room ${request.roomName} from ${usernames} ended. result ${request.result}`,
          request.roomName
        )
      }
      continue
    }

    if (!roomInCharge) {
      this.deleteTask(request)
      continue
    }

    Game.map.visual.text('guard', new RoomPosition(25, 35, request.roomName), { color: COLOR_NEON_GREEN })
    roomInCharge.guardRoom(request)
  }
}

const GuardRequest = function (room, targetRoomName, enemyInfo, options = {}) {
  this.category = 'guard'
  this.id = targetRoomName
  this.startTime = Game.time
  this.status = 'prepare'

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name

  this.enemyStrength = Math.max(enemyInfo.strength, enemyInfo.hits / 100)
  this.moveFirst = enemyInfo.attack === enemyInfo.rangedAttack

  if (options.ignoreSourceKeepers) {
    this.ignoreSourceKeepers = true
  }
}

Room.prototype.guardRoom = function (request) {
  const roomName = request.roomName

  const guardGroups = this.getGaurdGroups(roomName)

  if (this.memory.militaryThreat) {
    request.completed = true
    request.result = 'threat'
    for (const guard of guardGroups.total) {
      guard.memory.targetRoomName = undefined
    }
    return
  }

  if (Game.time > request.startTime + 1000) {
    request.result = 'expire'
    request.completed = true
    for (const guard of guardGroups.total) {
      guard.memory.targetRoomName = undefined
    }
    return
  }

  const intel = Overlord.getIntel(roomName)

  if (intel && intel[scoutKeys.numTower] > 0) {
    request.result = 'tower'
    request.completed = true
    for (const guard of guardGroups.total) {
      guard.memory.targetRoomName = undefined
    }
    return
  }

  if (config.seasonNumber === 6 && Overlord.getSecondsToClose(roomName) < 600) {
    request.result = 'closed'
    request.completed = true
    for (const guard of guardGroups.total) {
      guard.memory.targetRoomName = undefined
    }
    return
  }

  if (request.strength > this.getInvaderStrengthThreshold()) {
    request.result = 'too strong'
    request.completed = true
    for (const guard of guardGroups.total) {
      guard.memory.targetRoomName = undefined
    }
    return
  }

  if (request.usernames) {
    for (const username of request.usernames) {
      Overlord.addUserHateLevel(username, config.hateLevel.harass)
    }
  }

  const targetRoom = Game.rooms[roomName]

  request.numGuards = guardGroups.total.length

  if (targetRoom) {
    const hostileCreeps = []

    for (const hostileCreep of targetRoom.findHostileCreeps()) {
      const username = hostileCreep.owner.username

      if (username === 'Source Keeper') {
        continue
      }

      hostileCreeps.push(hostileCreep)

      if (username === 'Invader') {
        continue
      }

      if (hostileCreep.attackPower + hostileCreep.healPower === 0) {
        continue
      }

      request.usernames = request.usernames || []

      if (!request.usernames.includes(username)) {
        request.usernames.push(username)
      }
    }

    const enemyInfo = getCombatInfo(hostileCreeps)
    request.try = false
    request.lastUpdateTime = Game.time
    request.enemyStrength = enemyInfo.strength
    request.isEnemy = hostileCreeps.length > 0
    request.moveFirst = enemyInfo.attack === enemyInfo.rangedAttack
  } else if (Game.time > (request.lastUpdateTime || request.startTime) + 100 && request.strength > 0) {
    request.try = true
  }

  if (!request.cleared && !request.isEnemy) {
    request.cleared = true
    request.clearedTick = Game.time
  } else if (request.cleared && request.isEnemy) {
    request.cleared = false
  }

  if (request.cleared && Game.time > request.clearedTick + 10) {
    request.result = 'cleared'
    request.completed = true
    for (const guard of guardGroups.total) {
      guard.memory.targetRoomName = undefined
    }
    return
  }

  if (request.cleared) {
    request.status = 'cleared'
    doCleanUp(guardGroups.active, roomName)
    return
  }

  request.gathered = this.gatherGuards(roomName, request, request.moveFirst)

  if (request.try || (request.gathered && request.rallied)) {
    request.status = 'combat'
    doCombat(guardGroups.active, roomName)
    return
  } else {
    request.rallied = false
  }

  request.status = 'gather'

  request.rallied = this.rallyGuards(guardGroups.active, roomName)
}

function doCleanUp(guards, roomName) {
  for (const guard of guards) {
    guard.healWounded()
    if (guard.room.name !== roomName || isEdgeCoord(guard.pos.x, guard.pos.y)) {
      guard.activeHeal()
      guard.activeRangedAttack()
      guard.moveToRoom(roomName, 2)
      continue
    }
  }
}

function doCombat(guards, roomName) {
  const friendlies = guards.map((guard) => guard.name)
  for (const guard of guards) {
    guard.blinkyFight(roomName, { ignoreSourceKeepers: true, friendlies })

    // if (guard.room.name !== roomName || isEdgeCoord(guard.pos.x, guard.pos.y)) {
    //   guard.activeHeal()
    //   guard.activeRangedAttack()
    //   guard.moveToRoom(roomName, 2)
    //   continue
    // }
    // const tagets = guard.room.findHostileCreeps().filter((creep) => creep.owner.username !== 'Source Keeper')
    // if (tagets.length > 0) {
    //   guard.handleCombatants(tagets)
    //   continue
    // }
  }
}

Room.prototype.rallyGuards = function (guards, roomName) {
  let result = true
  const captain = guards[0]
  for (const guard of guards) {
    if (guard.spawning) {
      result = false
      continue
    }

    const targets = guard.room.findHostileCreeps()

    if (targets.length > 0 || guard.hits < guard.hitMax) {
      guard.activeHeal()
    }

    if (targets.length > 0) {
      const isFriendlyRoom = Overlord.getIsFriendlyRoom(guard.room.name)
      guard.activeRangedAttack({ attackNeutralStructures: !isFriendlyRoom })
    }

    if (guard.pos.getRangeTo(captain) > 2) {
      guard.setWorkingInfo(captain.pos, 2)
      guard.moveMy({ pos: captain.pos, range: 1 })
      result = false
      continue
    }

    if (guard.room.name !== this.name || isEdgeCoord(guard.pos.x, guard.pos.y)) {
      guard.moveToRoom(this.name, 2)
      continue
    }
  }
  return result
}

Room.prototype.getGaurdGroups = function (roomName) {
  const guards = Overlord.getCreepsByRole(this.name, 'guard')
  const total = []
  const spawning = []
  const active = []
  for (const guard of guards) {
    if (guard.memory.targetRoomName !== roomName) {
      continue
    }

    total.push(guard)

    if (guard.spawning) {
      spawning.push(guard)
      continue
    }

    active.push(guard)
  }
  return { active, spawning, total }
}

Room.prototype.getEnemyInfo = function () {
  if (this._enemyInfo) {
    return this._enemyInfo
  }
  const hostileCreeps = this.findHostileCreeps()
  return (this._enemyInfo = getCombatInfo(hostileCreeps))
}

Room.prototype.gatherGuards = function (roomName, request, moveFirst) {
  const enemyStrength = request.enemyStrength

  const guardGroups = this.getGaurdGroups(roomName)

  const activeCombatInfo = getCombatInfo(guardGroups.active)

  request.strength = activeCombatInfo.strength

  if (activeCombatInfo.strength > enemyStrength * 1.2) {
    return true
  }

  const idlingGuards = [...this.getIdlingGuards()].sort(
    (a, b) =>
      Game.map.getRoomLinearDistance(b.room.name, roomName) - Game.map.getRoomLinearDistance(a.room.name, roomName)
  )

  while (idlingGuards.length > 0) {
    const idlingGuard = idlingGuards.pop()
    idlingGuard.memory.targetRoomName = roomName
    const combatInfo = idlingGuard.getCombatInfo()
    activeCombatInfo.add(combatInfo)
    if (activeCombatInfo.strength > enemyStrength * 1.2) {
      return true
    }
  }

  const spawiningCombatInfo = getCombatInfo(guardGroups.spawning)

  if (activeCombatInfo.add(spawiningCombatInfo).strength > enemyStrength * 1.2) {
    return false
  }

  this.requestGuard(roomName, { moveFirst, neededStrength: enemyStrength * 1.2 })
  return false
}

Room.prototype.getIdlingGuards = function () {
  const guards = Overlord.getCreepsByRole(this.name, 'guard')
  return guards.filter((creep) => !creep.memory.targetRoomName && !creep.memory.harass)
}

Room.prototype.requestGuard = function (targetRoomName, options) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const moveFirst = options.moveFirst
  const neededStrength = options.neededStrength
  const costMax = this.energyCapacityAvailable

  let body = undefined

  const costs = Object.keys(harasserBody).map((cost) => Number(cost))

  for (const currentCost of costs) {
    if (currentCost > costMax) {
      break
    }

    body = moveFirst ? harasserBodyMoveFirst[currentCost] : harasserBody[currentCost]

    if (getStrength(body) >= neededStrength) {
      break
    }
  }

  if (!body) {
    return
  }

  const name = `${this.name} guard ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'guard',
    base: this.name,
    targetRoomName,
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['guard'] })
  this.spawnQueue.push(request)
}

global.getStrength = function (body) {
  let result = 0
  for (const part of body) {
    if ([RANGED_ATTACK, ATTACK].includes(part)) {
      result += 10
      continue
    }

    if (part === HEAL) {
      result += 12
    }
  }

  return result
}

function getCombatInfo(array) {
  let attackTotal = 0
  let rangedAttackTotal = 0
  let healTotal = 0
  let hitsTotal = 0
  for (const creep of array) {
    const attack = creep.attackPower
    const heal = creep.healPower
    if (attack + heal === 0) {
      continue
    }
    attackTotal += attack
    rangedAttackTotal += creep.rangedAttackPower
    healTotal += heal
    hitsTotal += creep.hits
  }
  return new CombatInfo(attackTotal, rangedAttackTotal, healTotal, hitsTotal)
}

Creep.prototype.getCombatInfo = function () {
  const attack = this.attackPower
  const rangedAttack = this.rangedAttackPower
  const heal = this.healPower
  const hits = this.hits

  return new CombatInfo(attack, rangedAttack, heal, hits)
}

// strength considers melee as 10 / rangedAttack as 10 / heal as 12
class CombatInfo {
  constructor(attack, rangedAttack, heal, hits) {
    this.time = Game.time
    this.attack = attack || 0
    this.rangedAttack = rangedAttack || 0
    this.heal = heal || 0
    this.hits = hits || 0
    this.strength = attack / 3 + (rangedAttack * 2) / 3 + heal
  }

  canWinWithKiting(combatInfo) {
    return canWin(this.rangedAttack, this.heal, this.hits, combatInfo.rangedAttack, combatInfo.heal, combatInfo.hits)
  }

  canWin(combatInfo) {
    return canWin(this.attack, this.heal, this.hits, combatInfo.attack, combatInfo.heal, combatInfo.hits)
  }

  add(combatInfo) {
    this.attack += combatInfo.attack
    this.rangedAttack += combatInfo.rangedAttack
    this.heal += combatInfo.heal
    this.hits += combatInfo.hits
    this.strength += combatInfo.strength
    return this
  }
}

function canWin(attack1, heal1, hits1, attack2, heal2, hits2) {
  const myAttack = Math.max(0, attack1 - heal2)
  const enemyAttack = Math.max(0, attack2 - heal1)
  if (enemyAttack === 0) {
    return true
  }
  if (myAttack === 0) {
    return false
  }
  return hits1 / enemyAttack > hits2 / myAttack
}

module.exports = {
  getCombatInfo,
  GuardRequest,
  CombatInfo,
}
