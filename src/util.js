Math.clamp = function (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getRoomMemory(roomName) {
  Memory.rooms[roomName] = Memory.rooms[roomName] || {}
  return Memory.rooms[roomName]
}

Overlord.getResourceAmountsTotal = function () {
  if (this.heap.resourceAmountsTotal && this.heap.resourceAmountsTotalTime === Game.time) {
    return this.heap.resourceAmountsTotal
  }

  if (!Memory.stats || !Memory.stats.resources) {
    return undefined
  }

  const result = _.cloneDeep(Memory.stats.resources)

  for (const room of Overlord.myRooms) {
    const boostRequests = Object.values(room.boostQueue)
    for (const request of boostRequests) {
      const requiredResources = request.requiredResources
      for (const resourceType in requiredResources) {
        result[resourceType] -= requiredResources[resourceType].mineralAmount
      }
    }
  }

  this.heap.resourceAmountsTotalTime = Game.time
  return this.heap.resourceAmountsTotal = result
}

module.exports = {
  getRoomMemory,
}