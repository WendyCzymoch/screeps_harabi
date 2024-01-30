const { config } = require("./config")
const { QuadRequest } = require("./overlord_tasks_quad")

const squadTaskNames = [
  'duo',
  'quad'
]

global.siege = function (targetRoomName, modelNumber, duration) {
  const level = Math.floor(modelNumber / 10) || 7

  targetRoomName = targetRoomName.toUpperCase()

  const base = Overlord.findClosestMyRoom(targetRoomName, level, 2)

  if (!base) {
    return `there is no adequate base`
  }

  const availableModel = base.getAvailableBlinkyModel()

  if (modelNumber === undefined) {
    modelNumber = Math.max(...availableModel)
  }

  if (modelNumber !== undefined && !availableModel.includes(modelNumber)) {
    return `base ${base.name} cannot produce ${modelNumber} Quad`
  }

  const options = {}

  options.modelNumber = modelNumber

  if (duration) {
    options.duration = duration
  }

  const request = new SiegeRequest(base, targetRoomName, options)

  Overlord.registerTask(request)

  return `${base} start siege to ${targetRoomName} with model ${modelNumber}`
}

global.stopSiege = function (targetRoomName) {
  targetRoomName = targetRoomName.toUpperCase()
  const tasks = Overlord.getTasksWithCategory('siege')
  for (const request of Object.values(tasks)) {
    if (request.roomName === targetRoomName) {
      request.result = `ordered to stop siege ${targetRoomName}`
      request.complete = true
    }
  }
}

Overlord.manageSiegeTasks = function () {
  const tasks = this.getTasksWithCategory('siege')

  for (const request of Object.values(tasks)) {
    const roomNameInCharge = request.roomNameInCharge
    const roomInCharge = Game.rooms[roomNameInCharge]
    if (!roomInCharge) {
      this.deleteTask(request)
      return 'no room in charge'
    }
    if (request.complete) {
      console.log(request.result)
      this.deleteTask(request)
      continue
    }
    roomInCharge.runSiegeTask(request)
  }
}

Room.prototype.runSiegeTask = function (request) {
  const targetRoomName = request.roomName

  if (Game.time > request.endTime) {
    request.result = `Time to stop. stop to seige ${targetRoomName}`
    request.complete = true
    return
  }

  if (this.memory.militaryThreat) {
    request.result = `${this.name} got military attack. stop to seige ${targetRoomName}`
    request.complete = true
    return
  }

  if (this.energyLevel < config.energyLevel.STOP_SIEGE) {
    request.result = `${this.name} energyLevel is too low. stop to seige ${targetRoomName}`
    request.complete = true
    return
  }

  if (!this.getAvailableBlinkyModel().includes(request.modelNumber)) {
    request.result = `${this.name} cannot produce model ${request.modelNumber}. stop to seige ${targetRoomName}`
    request.complete = true
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (targetRoom) {
    const spawns = targetRoom.structures.spawn
    if (spawns.length === 0) {
      request.result = `${targetRoomName} has no spawn. stop to seige ${targetRoomName}`
      request.complete = true
      return
    }
    if (targetRoom.controller.safeMode) {
      request.result = `${targetRoomName} popped safeMode. stop to seige ${targetRoomName}`
      request.complete = true
      return
    }
    if (!targetRoom.controller.level) {
      request.result = `${targetRoomName} is gone. stop to seige ${targetRoomName}`
      request.complete = true
      return
    }
  }

  const quadTasks = Overlord.getTasksWithCategory('quad')
  const activeQuadTask = Object.values(quadTasks).find(task => task.roomName === targetRoomName && task.ticksToLive > 1000)

  if (!activeQuadTask && this.canProduceSquad()) {
    const quadRequest = new QuadRequest(this, targetRoomName, { modelNumber: request.modelNumber })
    Overlord.registerTask(quadRequest)
    console.log(`${this.name} send quad ${request.modelNumber} to ${targetRoomName}`)
  }
}

const SiegeRequest = function (room, targetRoomName, options) {
  const defaultOptions = { type: 'quad', species: 'blinky', modelNumber: undefined, duration: 20000 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { type, species, duration, modelNumber } = mergedOptions

  this.category = 'siege'
  this.id = targetRoomName + Game.time

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name

  this.type = type
  this.species = species
  this.modelNumber = modelNumber || Math.max(...room.getAvailableBlinkyModel())

  this.endTime = Game.time + duration
}

Room.prototype.canProduceSquad = function () {
  const tasks = Overlord.getTasksByRoomInCharge(this.name)
  for (const taskName of squadTaskNames) {
    const squadTasks = tasks[taskName]
    if (!squadTasks) {
      continue
    }
    const squadTasksArray = Object.values(squadTasks)
    if (squadTasksArray.some(task => task.status === 'produce')) {
      return false
    }
  }
  return true
}
