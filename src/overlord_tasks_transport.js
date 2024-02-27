const { config } = require('./config')

global.transport = function (roomName, targetRoomName, resourceType = RESOURCE_ENERGY) {
  roomName = roomName.toUpperCase()

  targetRoomName = targetRoomName.toUpperCase()

  const room = Game.rooms[roomName]

  const request = new TransportRequest(room, targetRoomName, { resourceType })

  Overlord.registerTask(request)
}

Overlord.manageTransportTasks = function () {
  const tasks = this.getTasksWithCategory('transport')

  for (const request of Object.values(tasks)) {
    const roomNameInCharge = request.roomNameInCharge
    const roomInCharge = Game.rooms[roomNameInCharge]

    if (!roomInCharge) {
      this.deleteTask(request)
      return 'no room in charge'
    }

    if (request.complete) {
      data.recordLog(
        `TRANSPORT: ${roomNameInCharge} transport ${request.roomName} completed. result ${request.result}`,
        request.roomName
      )
      this.deleteTask(request)
      continue
    }

    roomInCharge.runTransportTask(request)
  }
}

Room.prototype.runTransportTask = function (request) {
  if (!this.storage) {
    request.complete = true
    request.result = 'No storage'
  }

  const targetRoom = Game.rooms[request.roomName]

  if (!targetRoom || !targetRoom.isMy) {
    request.complete = true
    request.result = 'No target room'
  }

  const targetStorage = targetRoom.storage
  if (!targetStorage) {
    request.complete = true
    request.result = 'Target room has no storage'
    return
  }

  if (targetRoom.terminal) {
    request.complete = true
    request.result = 'Target room has terminal now'
    return
  }

  if (this.energyLevel < config.energyLevel.FUNNEL) {
    return
  }

  if (targetRoom.energyLevel > config.energyLevel.STOP_FUNNEL) {
    return
  }

  if (!request.pathLength) {
    const path = Overlord.findPath(this.storage.pos, [{ pos: targetStorage.pos, range: 1 }], { moveCost: 1 })
    if (path === ERR_NO_PATH) {
      request.complete = true
      request.result = 'No path'
      return
    }
    request.pathLength = path.length
  }

  const transporters = Overlord.getCreepsByRole(this.name, 'transporter').filter(
    (creep) => (creep.ticksToLive || 1500) > creep.body.length * CREEP_SPAWN_TIME
  )

  if (transporters.length < 5) {
    this.requestTransporter(targetRoom.name, request.resourceType, request.pathLength)
  }
}

Room.prototype.requestTransporter = function (targetRoomName, resourceType, pathLength) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const name = `${this.name} transporter ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'transporter',
    base: this.name,
    targetRoomName,
    resourceType,
    pathLength,
  }

  const body = []

  const energyCapacity = this.energyCapacityAvailable

  let cost = 0
  for (let i = 0; i < 25; i++) {
    if (energyCapacity < cost + 100) {
      break
    }
    body.push(CARRY, MOVE)
    cost += 100
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['transporter'] })
  this.spawnQueue.push(request)
}

const TransportRequest = function (room, targetRoomName, options) {
  const defaultOptions = { resourceType: RESOURCE_ENERGY }
  const mergedOptions = { ...defaultOptions, ...options }
  const { resourceType, amount, duration } = mergedOptions

  this.category = 'transport'
  this.id = targetRoomName
  this.startTime = Game.time

  this.resourceType = resourceType
  this.amount = amount
  this.duration = duration

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name
}

module.exports = {
  TransportRequest,
}
