Creep.prototype.harass = function () {
  const targetRoomName = this.getHarassTargetRoomName()
  if (!targetRoomName) {
    return ERR_NOT_FOUND
  }
  this.harassRoom(targetRoomName)
  return OK
}

Creep.prototype.getHarassTargetRoomName = function () {
  if (this.memory.harassTargetRoomName !== undefined) {
    return this.memory.harassTargetRoomName
  }

  const harassTargetRoomNames = Overlord.getHarassTargetRoomNames().filter(roomName => {
    return Game.map.getRoomLinearDistance(this.pos.roomName, roomName) <= 3
  })

  const harassTargetRoomName = getMinObject(harassTargetRoomNames, roomName => {
    const intel = Overlord.getIntel(roomName)
    if (!intel) {
      return Infinity
    }
    const lastHarassTick = intel.lastHarassTick
    return lastHarassTick || 0
  })
  if (!harassTargetRoomName) {
    return this.memory.harassTargetRoomName = null
  }
  data.recordLog(`HARASS: ${this.name} starts harass ${harassTargetRoomName} from ${this.room}`, this.room.name)
  return this.memory.harassTargetRoomName = harassTargetRoomName
}

Creep.prototype.harassRoom = function (roomName) {
  Game.map.visual.line(this.pos, new RoomPosition(25, 25, roomName), { color: COLOR_NEON_RED, width: 2 })
  Game.map.visual.text('HARASS', new RoomPosition(25, 45, roomName), { color: COLOR_NEON_RED })

  Game.harassing = Game.harassing || {}
  Game.harassing[this.id] = Game.harassing[this.id] || {}
  Game.harassing[this.id] = { current: this.room.name, goal: roomName, ticksToLive: this.ticksToLive }

  this.activeHeal()

  const structuresToWreck = this.room.find(FIND_STRUCTURES).filter(structure => {
    if (!structure.hits) {
      return false
    } else {
      return true
    }
  })
  const hostileCreeps = this.room.findHostileCreeps().filter(creep => creep.owner.username !== 'Source Keeper')

  const structureNear = this.pos.findInRange(structuresToWreck, 3)[0]
  const creepNear = this.pos.findInRange(hostileCreeps, 3)[0]

  const killerCreeps = hostileCreeps.filter(creep => creep.checkBodyParts(['attack', 'ranged_attack', 'heal']))
  if (killerCreeps.length > 0) {
    if (this.pos.findInRange(killerCreeps, 3).length === 0) {
      if (creepNear) {
        this.rangedAttack(creepNear)
      } else if (this.room.name === roomName && structureNear) {
        this.rangedAttack(structureNear)
      }
    }
    if (this.handleCombatants(killerCreeps) !== ERR_NO_PATH) {
      return
    }
  }

  if (hostileCreeps.length > 0) {
    const goals = hostileCreeps.map(creep => {
      return { pos: creep.pos, range: 0 }
    })
    this.moveMy(goals)
    if (creepNear) {
      this.rangedAttack(creepNear)
    } else if (structureNear) {
      this.rangedAttack(structureNear)
    }
    return
  }

  if (Overlord.remotes.includes(roomName)) {
    const intel = Overlord.getIntel(roomName)
    intel.reservationOwner = MY_NAME
    delete this.memory.harassTargetRoomName
  }

  if (this.room.name !== roomName) {
    this.harasserRangedAttack()
    this.moveToRoom(roomName, 2)
    return
  }

  const intel = Overlord.getIntel(roomName)
  if (intel) {
    intel.lastHarassTick = Game.time
  }

  const hostileStructure = this.pos.findClosestByPath(structuresToWreck)

  if (hostileStructure) {
    if (this.pos.getRangeTo(hostileStructure) > 3) {
      this.moveMy({ pos: hostileStructure.pos, range: 3 }, { staySafe: false, ignoreMap: 1 })
      return
    }

    if (this.harasserRangedAttack() === OK) {
      return
    }

    this.rangedAttack(hostileStructure)
    return
  }

  const constructionSites = this.room.find(FIND_CONSTRUCTION_SITES).filter(constructionSite => !constructionSite.my && !constructionSite.pos.isWall && constructionSite.progress > 0)
  const closestConstructionSite = this.pos.findClosestByPath(constructionSites)
  if (closestConstructionSite) {
    this.moveMy(closestConstructionSite)
    return
  }

  delete this.memory.harassTargetRoomName

  return true
}