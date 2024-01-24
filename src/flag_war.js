const IMPORTANT_STRUCTURE_TYPES = ['spawn', 'tower']

Flag.prototype.nukeRoom = function () {
  const pos = this.pos
  const roomName = pos.roomName
  const myRooms = Overlord.myRooms
  const candidateRoom = myRooms.find(room => {
    if (room.controller.level < 8) {
      return false
    }
    const nuker = room.structures.nuker[0]
    if (!nuker) {
      return false
    }
    if (nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return false
    }
    if (nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0) {
      return false
    }
    if (nuker.cooldown && nuker.cooldown > 0) {
      return false
    }
    if (Game.map.getRoomLinearDistance(room.name, roomName) > 10) {
      return false
    }
    return true
  })
  if (candidateRoom) {
    candidateRoom.structures.nuker[0].launchNuke(pos)
  }
  this.remove()
}

Flag.prototype.conductWar = function () {
  Overlord.observeRoom(this.pos.roomName)

  const room = this.room
  if (!room) {
    return
  }

  const power = 2000

  if (power === 0) {
    return
  }

  const costArray = this.room.getCostArrayForBulldoze(power)

  const damageArray = this.room.getDamageArray()

  for (let i = 0; i < damageArray.length; i++) {
    const netHeal = 2500 - damageArray[i]
    if (netHeal < 0) {
      const pos = parseCoord(i)
      room.visual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, { fill: 'red', opacity: 0.15 })
      costArray[i] = 0
    }
  }

  const quadCostArray = transformCostArrayForQuad(costArray, this.roomName)

  const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES)
  const importantStructures = hostileStructures.filter(structure => IMPORTANT_STRUCTURE_TYPES.includes(structure.structureType))

  const goals = importantStructures.map(structure => {
    return { pos: structure.pos, range: 0 }
  })

  const dijkstra = this.room.dijkstra(this.pos, goals, quadCostArray)

  this.room.visual.poly(dijkstra)
}