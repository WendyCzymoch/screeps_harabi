Creep.prototype.harass = function (username) {
  const targetRoomName = this.getHarassTargetRoomName()

  if (!targetRoomName) {
    return ERR_NOT_FOUND
  }

  this.blinkyFight(targetRoomName, { ignoreSourceKeepers: true })

  const intel = Overlord.getIntel(targetRoomName)

  if (this.memory.fleeTime && Game.time > this.memory.fleeTime && this.room.name !== targetRoomName) {
    if (intel) {
      intel[scoutKeys.lastHarassTick] = Game.time
    }

    delete this.memory.harassTargetRoomName
    delete this.memory.harassComplete
    delete this.memory.fleeTime
    return
  }

  if (this.memory.harassComplete) {
    const intel = Overlord.getIntel(targetRoomName)

    if (intel) {
      intel[scoutKeys.lastHarassTick] = Game.time
    }

    delete this.memory.harassTargetRoomName
    delete this.memory.harassComplete
  }
}

Creep.prototype.getHarassTargetRoomName = function () {
  if (this.memory.harassTargetRoomName !== undefined) {
    return this.memory.harassTargetRoomName
  }

  const harassTargetRoomNames = Overlord.getHarassTargetRoomNames().filter((roomName) => {
    return Game.map.getRoomLinearDistance(this.pos.roomName, roomName) <= 3
  })

  const thisPos = this.pos

  const harassTargetRoomName = getMinObject(harassTargetRoomNames, (roomName) => {
    const intel = Overlord.getIntel(roomName)
    if (!intel) {
      return Infinity
    }
    const distance = Game.map.getRoomLinearDistance(thisPos.roomName, roomName)
    const ticksAfterHarss = Math.clamp(Game.time - (intel[scoutKeys.lastHarassTick] || 0), 1, 1000)
    return distance / ticksAfterHarss
  })

  return (this.memory.harassTargetRoomName = harassTargetRoomName)
}
