const { config } = require('./config')
const { getCombatInfo } = require('./overlord_tasks_guard')

Overlord.manageHarassTasks = function () {
  const tasks = Object.values(this.getTasksWithCategory('harass'))

  for (const request of tasks) {
    const roomInCharge = Game.rooms[request.roomNameInCharge]

    if (request.complete) {
      this.deleteTask(request)
      continue
    }

    if (!roomInCharge) {
      this.deleteTask(request)
      continue
    }

    roomInCharge.harassRoom(request)

    if (request.current) {
      const color = COLOR_NEON_RED
      Game.map.visual.text('harass', new RoomPosition(25, 35, request.roomName), { color })
      Game.map.visual.line(new RoomPosition(25, 25, roomInCharge.name), new RoomPosition(25, 35, request.current), {
        color,
        width: 2,
      })
    }
  }
}

const HarassRequest = function (room, username, targetRoomName, options) {
  this.category = 'harass'
  this.id = targetRoomName

  this.status = 'prepare'

  this.username = username
  this.roomName = targetRoomName
  this.roomNameInCharge = room.name
  this.spawned = false
}

Room.prototype.harassRoom = function (request) {
  const harasserBlinkies = Overlord.getCreepsByRole(request.roomName, 'harasser')
  const leader = getMinObject(harasserBlinkies, (creep) => creep.ticksToLive || 1500)

  request.members = harasserBlinkies.map((creep) => creep.name)

  for (const harasser of harasserBlinkies) {
    harasser.memory.leader = leader.name
  }

  const friendlyInfo = getCombatInfo(harasserBlinkies)

  const currentTargetRoom = Game.rooms[request.current]

  check: if (currentTargetRoom) {
    const hostileCreeps = []

    const currentTargetRoomIntel = Overlord.getIntel(request.current)

    for (const hostileCreep of currentTargetRoom.findHostileCreeps()) {
      const username = hostileCreep.owner.username

      if (username === 'Source Keeper') {
        continue
      }

      if (username === 'Invader') {
        continue
      }

      if (hostileCreep.attackPower + hostileCreep.healPower === 0) {
        continue
      }

      hostileCreeps.push(hostileCreep)
    }

    const enemyInfo = getCombatInfo(hostileCreeps)
    if (hostileCreeps.strength > 0) {
      currentTargetRoomIntel[scoutKeys.enemyStrength] = enemyInfo.strength
      currentTargetRoomIntel[scoutKeys.enemyStrengthEffectiveTime] =
        Game.time + Math.max(...hostileCreeps.map((creep) => creep.ticksToLive))
    }

    if (friendlyInfo.strength < 1.1 * enemyInfo.strength) {
      data.recordLog(`enemies in ${request.current} is too strong. go to next room`, request.current)
      delete request.current
      currentTargetRoomIntel[scoutKeys.lastHarassTick] = Game.time
      break check
    }

    const isStructure = currentTargetRoom.find(FIND_STRUCTURES).some((structure) => structure.hits)
    if (!isStructure) {
      data.recordLog(`harass in ${request.current} completed. go to next room`, request.current)
      delete request.current
      currentTargetRoomIntel[scoutKeys.lastHarassTick] = Game.time
      break check
    }
  }

  if (!request.current) {
    const adjacents = Object.values(Game.map.describeExits(request.roomName)).sort((a, b) => Math.random() - 0.5)

    const currentRoomName = leader && leader.room ? leader.room.name : this.name

    const next = adjacents.find((roomName) => {
      const intel = Overlord.getIntel(roomName)

      const reservationOwner = intel[scoutKeys.reservationOwner]

      if (!reservationOwner || reservationOwner !== request.username) {
        return false
      }

      const ticksAfterHarass = Math.clamp(Game.time - (intel[scoutKeys.lastHarassTick] || 0), 1, 3000)

      if (ticksAfterHarass < CREEP_LIFE_TIME / 3) {
        return false
      }

      const route = Overlord.findRoutesWithPortal(currentRoomName, roomName)

      const routeLength = Overlord.findRouteLength(route)

      if (routeLength > 10) {
        return false
      }

      return true
    })

    request.current = next
    request.gathered = false
    request.engage = false
    for (const creep of harasserBlinkies) {
      creep.memory.gathered = false
    }
  }

  if (!request.current) {
    request.complete = true
    request.result = 'cannot find next room to harass'
    return
  }

  const currentIntel = Overlord.getIntel(request.current)

  if (!request.spawned) {
    const strengthTarget = 1.1 * (currentIntel[scoutKeys.enemyStrength] || 0)

    if (friendlyInfo.strength <= strengthTarget) {
      this.requestHarasser(request.roomName, { neededStrength: strengthTarget, task: request })
      return
    }
    if (harasserBlinkies.some((creep) => creep.spawning)) {
      return
    }
    request.spawned = true
  }

  if (harasserBlinkies.length === 0) {
    request.complete = true
    request.result = 'harassers all dead'
    return
  }

  if (!request.gathered) {
    if (harasserBlinkies.some((creep) => !creep.memory.gathered)) {
      return
    }
    request.gathered = true
  }

  request.engage = true
}

Room.prototype.requestHarasser = function (targetRoomName, options) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const defaultOptions = {
    neededStrength: Infinity,
    task: undefined,
    moveFirst: false,
  }

  const mergedOptions = { ...defaultOptions, ...options }
  const { neededStrength, task, moveFirst } = mergedOptions

  const costMax = this.energyCapacityAvailable

  let body = undefined

  const costs = Object.keys(harasserBody).map((cost) => Number(cost))

  for (const currentCost of costs) {
    if (currentCost > costMax) {
      break
    }

    body = moveFirst ? harasserBodyMoveFirst[currentCost] : harasserBody[currentCost]

    if (getStrength(body) > neededStrength) {
      break
    }
  }

  if (!body) {
    return
  }

  const name = `${targetRoomName} harasser ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'harasser',
    base: this.name,
    targetRoomName,
  }

  if (task) {
    memory.task = { category: task.category, id: task.id }
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['harasser'] })
  this.spawnQueue.push(request)
}

Overlord.getHarassTargetRoomNames = function () {
  if (Game._harassTargets) {
    return Game._harassTargets
  }

  if (Math.random() < 0.01) {
    delete this.heap._harassTargets
  }

  if (this.heap._harassTargets) {
    return (Game._harassTargets = this.heap._harassTargets)
  }

  const roomNamesFiltered = []

  for (const roomName in Memory.rooms) {
    const intel = Overlord.getIntel(roomName)
    const reservationOwner = intel[scoutKeys.reservationOwner]
    if (!reservationOwner || reservationOwner === 'Invader') {
      continue
    }

    const hateLevel = Overlord.getUserIntel(reservationOwner).hateLevel

    if (hateLevel < config.hateLevel.toHarass) {
      continue
    }

    if (allies.includes(intel[scoutKeys.reservationOwner])) {
      continue
    }
    if (Overlord.getAllRemoteNames().includes(roomName)) {
      continue
    }
    roomNamesFiltered.push(roomName)
  }

  return (Game._harassTargets = this.heap._harassTargets = roomNamesFiltered)
}

Overlord.resetHarassTargetRooms = function () {
  delete this.heap._harassTargets
}

module.exports = {
  HarassRequest,
}
