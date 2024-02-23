const {
  SOURCE_KEEPER_RANGE_TO_START_FLEE,
  SOURCE_KEEPER_RANGE_TO_FLEE,
  KEEPER_LAIR_RANGE_TO_START_FLEE,
  KEEPER_LAIR_RANGE_TO_FLEE,
  unpackInfraPos,
} = require('./room_manager_remote')
const { getRoomMemory } = require('./util')

Creep.prototype.readyToWork = function (targetRoomName, options = {}) {
  const { wait } = options

  if (wait) {
    if (this.memory.getRecycled) {
      if (this.room.name === this.memory.base) {
        this.getRecycled()
        this.say('🗑️', true)
      } else {
        this.moveToRoom(this.memory.base)
        this.say('🏠', true)
      }
      return false
    }

    if (!getRoomMemory(targetRoomName).isCombatant && (!this.room.isCombatant() || this.room.isMy)) {
      if (Game.time < this.memory.timeToWait) {
        if (this.pos.getRangeToEdge() < 5) {
          this.moveToRoom(this.memory.base)
        }
        return false
      }

      if (this.avoidSourceKeepers() === OK) {
        return false
      }
      return true
    }

    if (!this.room.isCombatant() && this.pos.getRangeToEdge() >= 5) {
      return false
    }

    this.memory.timeToWait = Game.time + 10

    this.moveToRoom(this.memory.base)
    this.say('🏠', true)
    return false
  }

  if (this.memory.runAway) {
    this.moveToRoom(this.memory.base)
    this.say('🏠', true)
    if (this.room.name === this.memory.base && !isEdgeCoord(this.pos.x, this.pos.y)) {
      delete this.memory.targetRoomName
      delete this.memory.sourceId
      delete this.memory.runAway
    }
    return false
  }

  // check target room
  if (targetRoomName && getRoomMemory(targetRoomName).isCombatant) {
    this.memory.runAway = true
    this.moveToRoom(this.memory.base)
    this.say('🏠', true)
    return false
  }

  if (this.room.isCombatant() && !this.room.isMy) {
    this.memory.runAway = true
    this.moveToRoom(this.memory.base)
    this.say('🏠', true)
    return false
  }

  if (this.avoidSourceKeepers() === OK) {
    return false
  }

  if (this.memory.getRecycled) {
    if (this.room.name === this.memory.base) {
      this.getRecycled()
      this.say('🗑️', true)
    } else {
      this.moveToRoom(this.memory.base)
      this.say('🏠', true)
    }
    return false
  }

  return true
}

Room.prototype.isCombatant = function () {
  if (this.memory.isCombatant) {
    return true
  }

  if (this._isCombatant !== undefined) {
    return this._isCombatant
  }

  const roomType = getRoomType(this.name)

  const combatants = this.getEnemyCombatants()

  if (roomType === 'sourceKeeper') {
    return combatants.some((creep) => creep.owner.username !== 'Source Keeper')
  }

  return (this._isCombatant = combatants.length > 0)
}

Creep.prototype.avoidSourceKeepers = function () {
  const roomType = getRoomType(this.room.name)

  if (roomType !== 'sourceKeeper') {
    return ERR_INVALID_TARGET
  }

  const sourceKeepers = this.room.getEnemyCombatants().filter((creep) => creep.owner.username === 'Source Keeper')

  if (this.pos.findInRange(sourceKeepers, SOURCE_KEEPER_RANGE_TO_START_FLEE).length > 0) {
    this.fleeFrom(sourceKeepers, SOURCE_KEEPER_RANGE_TO_START_FLEE, 1)
    return OK
  }

  const keeperLairs = this.room.find(FIND_HOSTILE_STRUCTURES).filter((structure) => {
    if (structure.structureType !== STRUCTURE_KEEPER_LAIR) {
      return false
    }

    if (!structure.ticksToSpawn) {
      return false
    }

    if (structure.ticksToSpawn > 15) {
      return false
    }

    return true
  })

  if (this.pos.findInRange(keeperLairs, KEEPER_LAIR_RANGE_TO_START_FLEE).length > 0) {
    this.fleeFrom(keeperLairs, KEEPER_LAIR_RANGE_TO_START_FLEE)
    return OK
  }

  return ERR_NOT_FOUND
}

Creep.prototype.getResourceFromRemote = function (targetRoomName, resourceId, path, options = {}) {
  const { resourceType } = options
  // path is from source to storage

  const base = Game.rooms[this.memory.base]

  if (!base) {
    return ERR_INVALID_ARGS
  }

  if (!path) {
    return ERR_INVALID_ARGS
  }

  // move to target room when there is no vision
  if (this.room.name !== targetRoomName) {
    this.moveByRemotePath(path, { reverse: true })
    delete this.memory.targetId
    return ERR_NOT_IN_RANGE
  }

  const resource = Game.getObjectById(resourceId)

  if (!resource) {
    return ERR_INVALID_ARGS
  }

  // if there is target in memory, use
  if (this.memory.targetId) {
    const target = Game.getObjectById(this.memory.targetId)
    const result = this.getResourceFrom(target, { resourceType })

    if (result === ERR_NOT_IN_RANGE) {
      return ERR_NOT_IN_RANGE
    }

    delete this.memory.targetId

    if (result === OK) {
      return OK
    }

    delete this.memory.targetId
  }

  // approach to target
  if (this.pos.getRangeTo(resource) > 5) {
    this.moveByRemotePath(path, { reverse: true })
    return ERR_NOT_IN_RANGE
  }

  // find target and grab resource
  const droppedResources = resource.pos.findInRange(FIND_DROPPED_RESOURCES, 5)

  if (droppedResources.length > 0) {
    const target = droppedResources.find((resource) => {
      if (resource.amount < 50) {
        return false
      }
      if (resourceType && resource.resourceType !== resourceType) {
        return false
      }
      return true
    })

    if (target) {
      this.memory.targetId = target.id
      return this.getResourceFrom(target, { resourceType })
    }
  }

  const tombstones = resource.pos.findInRange(FIND_TOMBSTONES, 5)

  if (tombstones.length > 0) {
    const target = tombstones.find((tombstone) => {
      if (resourceType && tombstone.store[resourceType] === 0) {
        return false
      }
      if (tombstone.store.getUsedCapacity() === 0) {
        return false
      }
      return true
    })

    if (target) {
      this.memory.targetId = target.id
      return this.getResourceFrom(target, { resourceType })
    }
  }

  const containers = resource.pos
    .findInRange(FIND_STRUCTURES, 1)
    .filter((structure) => structure.structureType === STRUCTURE_CONTAINER)

  if (containers.length > 0) {
    const threshold = Math.min(this.store.getFreeCapacity(), 500)
    const target = containers.find((container) => container.store.getUsedCapacity(resourceType) >= threshold)
    if (target) {
      this.memory.targetId = target.id
      return this.getResourceFrom(target, { resourceType })
    }
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const remoteMiner = resource.pos
    .findInRange(this.room.creeps.remoteMiner, 1)
    .find((creep) => creep.store && creep.store.getUsedCapacity(resourceType) > 0)

  if (remoteMiner) {
    if (this.pos.getRangeTo(remoteMiner) > 1) {
      this.moveMy({ pos: remoteMiner.pos, range: 1 })
      return ERR_NOT_IN_RANGE
    }

    if (resourceType) {
      remoteMiner.transfer(this, resourceType)
      return OK
    }

    for (const resourceType in remoteMiner.store) {
      remoteMiner.transfer(this, resourceType)
      return OK
    }
  }

  // if no target, idle.
  if (this.pos.getRangeTo(resource) > 2) {
    this.moveMy({ pos: resource.pos, range: 1 })
    return ERR_NOT_IN_RANGE
  }

  this.setWorkingInfo(resource.pos, 2)

  this.idling = true

  this.say('😴', true)
  Game.map.visual.text(`😴`, this.pos, { fontSize: 5 })

  return ERR_NOT_FOUND
}

// default is source to room
Creep.prototype.moveByRemotePath = function (path, options = {}) {
  const { reverse } = options

  const result = reverse ? this.moveByPathMyReverse(path) : this.moveByPathMy(path)

  if (result !== OK) {
    let startPositions = reverse ? path.slice(path.length - 10) : path.slice(0, 10)

    const goals = startPositions.map((pos) => {
      return { pos, range: 0 }
    })
    return this.moveMy(goals)
  }

  return OK
}

Room.prototype.getRemotePath = function (remoteName, sourceId) {
  this.heap.remotePath = this.heap.remotePath || {}
  if (this.heap.remotePath[sourceId]) {
    return this.heap.remotePath[sourceId]
  }
  const blueprints = this.getRemoteBlueprints(remoteName)

  if (!blueprints) {
    return
  }

  const blueprint = blueprints[sourceId]

  if (!blueprint) {
    return
  }

  const structures = blueprint.structures

  if (!structures) {
    return
  }

  const path = []

  for (const packed of structures) {
    const unpacked = unpackInfraPos(packed)
    if (unpacked.structureType !== STRUCTURE_ROAD) {
      continue
    }
    path.push(unpacked.pos)
  }

  return (this.heap.remotePath[sourceId] = path)
}
