const { config } = require('./config')
const { BlinkyRequest } = require('./overlord_tasks_blinky')

global.occupy = function (targetRoomName, duration) {
  targetRoomName = targetRoomName.toUpperCase()

  const base = Overlord.findClosestMyRoom(targetRoomName, 6)

  if (!base) {
    return `there is no adequate base`
  }

  const options = {}

  if (duration) {
    options.duration = duration
  }

  const request = new OccupyRequest(base, targetRoomName, options)

  Overlord.registerTask(request)

  return `${base} start to occupy ${targetRoomName}`
}

global.stopOccupy = function (targetRoomName) {
  targetRoomName = targetRoomName.toUpperCase()
  const tasks = Overlord.getTasksWithCategory('occupy')
  for (const request of Object.values(tasks)) {
    if (request.roomName === targetRoomName) {
      request.result = `ordered to stop occupy ${targetRoomName}`
      request.complete = true
    }
  }
}

Overlord.manageOccupyTasks = function () {
  const tasks = this.getTasksWithCategory('occupy')

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
    roomInCharge.runOccupyTask(request)
  }
}

Room.prototype.runOccupyTask = function (request) {
  const targetRoomName = request.roomName

  if (Game.time > request.endTime) {
    request.result = `Time to stop. stop to occupy ${targetRoomName}`
    request.complete = true
    return
  }

  if (this.memory.militaryThreat) {
    request.result = `${this.name} got military attack. stop to occupy ${targetRoomName}`
    request.complete = true
    return
  }

  if (this.energyLevel < config.energyLevel.STOP_SIEGE) {
    request.result = `${this.name} energyLevel is too low. stop to occupy ${targetRoomName}`
    request.complete = true
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (targetRoom) {
    if (targetRoom.controller.safeMode) {
      request.result = `${targetRoomName} popped safeMode. stop to occupy ${targetRoomName}`
      request.complete = true
      return
    }

    if (!targetRoom.controller.owner) {
      // controller unowned
      // claim(targetRoomName)
      // request.result = `claim ${targetRoomName} start. stop to occupy ${targetRoomName}`
      request.complete = true
    } else if (targetRoom.controller.owner.username !== MY_NAME) {
      // controller owned by other -> attack!
      const upgradeBlocked = targetRoom.controller.upgradeBlocked || 0
      const disclaimers = Overlord.getCreepsByRole(targetRoomName, 'claimer')

      if (upgradeBlocked <= 500 && disclaimers.length === 0) {
        this.requestClaimer(targetRoomName, true)
      }
    }
  }

  const tasks = Overlord.getTasksByRoomInCharge(this.name)
  const blinkyTasks = Object.values(tasks['blinky']).filter((task) => task.roomName === targetRoomName)

  if (!blinkyTasks.some((request) => request.ticksToLive > 600)) {
    const request = new BlinkyRequest(this, targetRoomName, { number: 1, boost: 3 })
    Overlord.registerTask(request)
  }
}

const OccupyRequest = function (room, targetRoomName, options) {
  const defaultOptions = { duration: 10000 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { duration } = mergedOptions

  this.category = 'occupy'
  this.id = targetRoomName + Game.time

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name
  this.endTime = Game.time + duration
}
