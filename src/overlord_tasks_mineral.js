const { config } = require('./config')
const { getCombatInfo, GuardRequest } = require('./overlord_tasks_guard')
const { getInvaderStrengthThreshold, isStronghold } = require('./room_manager_remote')
const { getRoomMemory } = require('./util')

Room.prototype.checkMineral = function (targetRoomName) {
  const remoteNames = this.getRemoteNames()

  const roomType = getRoomType(targetRoomName)

  if (roomType !== 'sourceKeeper') {
    return
  }

  if (!remoteNames.includes(targetRoomName)) {
    return
  }

  if (Game.map.getRoomLinearDistance(this.name, targetRoomName) > 1) {
    return
  }

  if (isStronghold(targetRoomName)) {
    return
  }

  const mineralRequests = Overlord.getTasksWithCategory('mineral')
  if (Object.values(mineralRequests).find((request) => request.roomNameInCharge === this.name)) {
    return
  }

  if (!this.terminal || this.energyCapacityAvailable < 4270) {
    return
  }

  const terminal = this.terminal

  if (terminal.store.getFreeCapacity() < 50000) {
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    return
  }

  const minerals = targetRoom.find(FIND_MINERALS)

  for (const mineral of minerals) {
    if (!mineral.mineralAmount) {
      continue
    }

    if (mineralRequests[mineral.id]) {
      continue
    }

    if (terminal.store[mineral.mineralType] > 50000) {
      continue
    }

    const request = new MineralRequest(this, mineral)
    Overlord.registerTask(request)
    return
  }
}

Overlord.manageMineralTasks = function () {
  const tasks = this.getTasksWithCategory('mineral')

  for (const request of Object.values(tasks)) {
    const targetRoomName = request.roomName
    const roomInCharge = Game.rooms[request.roomNameInCharge]

    if (!roomInCharge) {
      data.recordLog(`MINERAL: stop MINERAL ${targetRoomName}. no room in charge`, targetRoomName)
      this.deleteTask(request)
      return
    }

    if (request.complete === true) {
      data.recordLog(
        `MINERAL: ${roomInCharge.name} complete MINERAL ${targetRoomName}. result:${request.result}`,
        targetRoomName
      )
      this.deleteTask(request)
      return
    }

    roomInCharge.runMineralTask(request)
    const color = resourceColor[request.mineralType]

    Game.map.visual.line(new RoomPosition(25, 25, roomInCharge.name), new RoomPosition(25, 25, request.roomName), {
      color,
      lineStyle: 'dashed',
    })

    Game.map.visual.text(`${request.mineralType}`, new RoomPosition(25, 25, request.roomName), {
      color,
      fontSize: 7,
      opacity: 1,
      backgroundColor: '#000000',
    })
  }
}

Room.prototype.runMineralTask = function (request) {
  const targetRoomName = request.roomName

  // check complete

  if (isStronghold(targetRoomName)) {
    request.complete = true
    request.result = 'stronghold'
    return
  }

  const mineralId = request.mineralId

  const mineral = Game.getObjectById(mineralId)

  if (mineral && mineral.ticksToRegeneration && mineral.ticksToRegeneration > 0) {
    request.complete = true
    request.result = 'depleted'
    return
  }

  if (config.seasonNumber === 6 && Overlord.getSecondsToClose(targetRoomName) < config.secondsToStopTasks) {
    request.result = 'closed'
    request.completed = true
    return
  }

  // check invader

  const memory = getRoomMemory(targetRoomName)

  const targetRoom = Game.rooms[targetRoomName]

  const invaderStrengthThreshold = getInvaderStrengthThreshold(this.controller.level)

  if (!this.getActiveRemoteNames().includes(targetRoomName) && targetRoom) {
    const invaders = [...targetRoom.findHostileCreeps()].filter((creep) => creep.owner.username !== 'Source Keeper')

    const enemyInfo = getCombatInfo(invaders)

    const isEnemy = invaders.some((creep) => creep.checkBodyParts(INVADER_BODY_PARTS))

    if (!memory.invader && isEnemy) {
      if (enemyInfo.strength <= invaderStrengthThreshold) {
        const request = new GuardRequest(this, targetRoomName, enemyInfo)
        Overlord.registerTask(request)
      }
      memory.invader = true
    } else if (memory.invader && !isEnemy) {
      memory.invader = false
    }

    if (!memory.isCombatant && enemyInfo.strength > 0) {
      const maxTicksToLive = Math.max(...invaders.map((creep) => creep.ticksToLive))
      memory.combatantsTicksToLive = Game.time + maxTicksToLive
      memory.isCombatant = true
    } else if (memory.isCombatant && enemyInfo.strength === 0) {
      memory.isCombatant = false
      delete memory.combatantsTicksToLive
    }
  }

  if (memory.isCombatant) {
    const leftTicks = memory.combatantsTicksToLive - Game.time
    Game.map.visual.text(`👿${leftTicks}`, new RoomPosition(49, 5, targetRoomName), {
      fontSize: 5,
      align: 'right',
    })
    if (leftTicks <= 0) {
      delete memory.isCombatant
      delete memory.invader
      delete memory.combatantsTicksToLive
    }
    return
  }

  // check creeps and spawn

  if (!isSourceKeeperHandler(request)) {
    const activeRemotes = this.getActiveRemotes()
    if (activeRemotes.find((info) => info.remoteName === targetRoomName)) {
      return
    }
    const resourceIds = [mineralId]

    this.requestSourceKeeperHandler(targetRoomName, resourceIds)
    return
  }

  if (!isEnoughHaulers(request)) {
    const pathLength = request.distance
    this.requestMineralHauler(targetRoomName, mineralId, { maxCarry: request.haulerSize, pathLength })
    return
  }

  if (!isMineralMiner(request)) {
    this.requestRemoteMiner(targetRoomName, mineralId, { maxWork: 32 })
    return
  }
}

function isEnoughHaulers(request) {
  const targetRoomName = request.roomName
  const mineralId = request.mineralId

  const mineralHaulers = Overlord.getCreepsByRole(targetRoomName, 'mineralHauler').filter(
    (creep) =>
      creep.memory.sourceId === mineralId &&
      (creep.spawning || creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME + 2 * request.distance)
  )

  return mineralHaulers.length >= request.haulerNumber
}

function isMineralMiner(request) {
  const targetRoomName = request.roomName
  const mineralId = request.mineralId
  const mineralMiners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner').filter(
    (creep) => creep.memory.sourceId === mineralId
  )

  for (const mineralMiner of mineralMiners) {
    if (
      mineralMiner.spawning ||
      mineralMiner.ticksToLive > mineralMiner.body.length * CREEP_SPAWN_TIME + request.distance
    ) {
      return true
    }
  }

  return false
}

function isSourceKeeperHandler(request) {
  const targetRoomName = request.roomName
  const mineralId = request.mineralId
  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler')

  for (const sourceKeeperHandler of sourceKeeperHandlers) {
    if ((sourceKeeperHandler.ticksToLive || 1500) < sourceKeeperHandler.body.length * CREEP_SPAWN_TIME) {
      continue
    }
    if (sourceKeeperHandler.memory.resourceIds.includes(mineralId)) {
      return true
    }
    sourceKeeperHandler.memory.resourceIds.push(mineralId)
    return true
  }

  return false
}

const MineralRequest = function (room, mineral) {
  const terminal = room.terminal

  if (!terminal) {
    return
  }

  const path = Overlord.findPath(mineral.pos, [{ pos: terminal.pos, range: 1 }])

  if (path === ERR_NO_PATH) {
    return
  }

  const distance = path.length

  const haulerMagnitude = getMineralHaulerMagnitude(room, distance)

  this.haulerSize = haulerMagnitude.size
  this.haulerNumber = haulerMagnitude.number

  this.category = 'mineral'
  this.id = mineral.id

  this.roomName = mineral.room.name

  this.mineralType = mineral.mineralType

  this.mineralId = mineral.id
  this.mineralAmount = mineral.mineralAmount
  this.distance = distance

  this.roomNameInCharge = room.name
  this.terminalId = terminal.id
}

function getMineralHaulerMagnitude(room, distance) {
  const energyCapacity = room.energyCapacityAvailable
  const maxSize = Math.min(25, Math.floor(energyCapacity / 100))
  const number = Math.ceil((0.32 * distance) / maxSize) + 1
  const size = Math.min(maxSize, Math.ceil((0.32 * distance) / (number - 1)))
  return { size, number }
}

Room.prototype.requestMineralHauler = function (targetRoomName, sourceId, options = {}) {
  let { pathLength, maxCarry } = options

  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = []
  const name = `${targetRoomName} mineralHauler ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'mineralHauler',
    base: this.name,
    targetRoomName,
    sourceId,
  }

  const energyCapacity = this.energyCapacityAvailable

  maxCarry = maxCarry || 25

  let cost = 0
  for (let i = 0; i < Math.min(maxCarry, 25); i++) {
    if (energyCapacity < cost + 100) {
      break
    }
    body.push(CARRY, MOVE)
    cost += 100
  }

  const spawnOptions = {}
  spawnOptions.priority = SPAWN_PRIORITY['mineralHauler']

  if (pathLength) {
    memory.pathLength = pathLength
  }

  const request = new RequestSpawn(body, name, memory, spawnOptions)
  this.spawnQueue.push(request)
}
