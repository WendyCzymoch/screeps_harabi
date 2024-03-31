const { config } = require('./config')
const { DuoRequest } = require('./overlord_tasks_duo')

global.siegeDuo = function (targetRoomName, boost, duration) {
  targetRoomName = targetRoomName.toUpperCase()

  const base = Overlord.findClosestMyRoom(targetRoomName, 7)

  if (!base) {
    return `there is no adequate base`
  }

  const availableBoost = base.getAvailableDuoBoost('ant')

  if (boost !== undefined && !availableBoost.includes(boost)) {
    return `base ${base.name} cannot boost T${boost}`
  }

  const options = {}

  options.boost = boost

  if (duration) {
    options.duration = duration
  }

  const request = new SiegeDuoRequest(base, targetRoomName, options)

  Overlord.registerTask(request)

  return `${base} start siege to ${targetRoomName} with T${boost} ants`
}

global.stopSiegeDuo = function (targetRoomName) {
  targetRoomName = targetRoomName.toUpperCase()
  const tasks = Overlord.getTasksWithCategory('siegeDuo')
  for (const request of Object.values(tasks)) {
    if (request.roomName === targetRoomName) {
      request.result = `ordered to stop siegeDuo ${targetRoomName}`
      request.complete = true
    }
  }
}

Overlord.manageSiegeDuoTasks = function () {
  const tasks = this.getTasksWithCategory('siegeDuo')

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
    roomInCharge.runSiegeDuoTask(request)
  }
}

Room.prototype.runSiegeDuoTask = function (request) {
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

  if (!this.getAvailableDuoBoost(request.species).includes(request.boost)) {
    request.result = `${this.name} cannot produce model ${request.modelNumber}. stop to seige ${targetRoomName}`
    request.complete = true
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (targetRoom) {
    const spawns = targetRoom.structures.spawn
    if (spawns.length === 0 && targetRoom.structures.tower.length === 0) {
      request.result = `${targetRoomName} has no spawn and tower. stop to seige ${targetRoomName}`
      request.complete = true
      if (targetRoom.controller.level) {
        occupy(targetRoomName)
      }
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

  const duoTasks = Overlord.getTasksWithCategory('duo')
  const activeDuoTasks = Object.values(duoTasks).filter(
    (task) => task.roomName === targetRoomName && task.ticksToLive > 1000
  )

  if (activeDuoTasks.length < 1 && this.canProduceSquad()) {
    const duoRequest = new DuoRequest(this, targetRoomName, { boost: request.boost, species: request.species })
    Overlord.registerTask(duoRequest)
    console.log(`${this.name} send duo T${request.boost} ${request.species} to ${targetRoomName}`)
  }
}

const SiegeDuoRequest = function (room, targetRoomName, options) {
  const defaultOptions = { species: 'ant', boost: 0, duration: 100000 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { boost, species, duration } = mergedOptions

  this.category = 'siegeDuo'
  this.id = targetRoomName + Game.time

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name

  this.species = species
  this.boost = boost

  this.endTime = Game.time + duration
}
