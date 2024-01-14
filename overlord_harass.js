Overlord.manageHarassTasks = function () {
  const tasks = Object.values(this.getTasksWithCategory('harass'))

  for (const request of tasks) {
    const roomInCharge = Game.rooms[request.roomNameInCharge]

    if (request.completed === true) {
      this.deleteTask(request)
      continue
    }

    if (!roomInCharge) {
      this.deleteTask(request)
      continue
    }
    roomInCharge.guardRoom(request)
  }
}

const HarassRequest = function (room, targetRoomName) {
  this.category = 'harass'
  this.id = `${room.name} ${targetRoomName}`

  this.status = 'move'

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name

  this.enemyInfo = enemyInfo
}

Overlord.getHarassTargetRoomNames = function () {
  if (Math.random() < 0.01) {
    delete this.heap._harassTargets
  }

  if (this.heap._harassTargets) {
    return this.heap._harassTargets
  }

  const roomNamesFiltered = []

  for (const roomName in Memory.rooms) {
    const intel = Overlord.getIntel(roomName)
    if (!intel.reservationOwner) {
      continue
    }
    if (allies.includes(intel.reservationOwner)) {
      continue
    }
    if (Overlord.remotes.includes(roomName)) {
      continue
    }
    if (Game.time < intel.lastHarassTick + 1000) {
      continue
    }
    roomNamesFiltered.push(roomName)
  }

  return this.heap._harassTargets = roomNamesFiltered
}