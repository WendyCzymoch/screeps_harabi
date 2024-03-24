Overlord.manageBlinkyTasks = function () {
  const tasks = Object.values(this.getTasksWithCategory('blinky'))

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

    Game.map.visual.text('blinky', new RoomPosition(25, 35, request.roomName), {
      color: COLOR_NEON_BLUE,
    })
    roomInCharge.sendBlinkies(request)
  }
}

const BlinkyRequest = function (room, targetRoomName, options) {
  const defaultOptions = { number: 2, boost: 0 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { number, boost } = mergedOptions

  this.category = 'blinky'
  this.id = `${this.category} ${targetRoomName} ${Game.time}`

  this.startTime = Game.time
  this.status = 'produce'
  this.ticksToLive = 1500

  this.number = number
  this.boost = boost

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name
}

Room.prototype.sendBlinkies = function (request) {
  const roomName = request.roomName

  const number = request.number
  const boost = request.boost

  const blinkies = Overlord.getCreepsByRole(roomName, 'blinky').filter(
    (creep) => creep.memory.task && creep.memory.task.id === request.id
  )

  const ticksToLiveMin = Math.min(Math.min(...blinkies.map((creep) => creep.ticksToLive || 1500)), 1500)

  request.ticksToLive = ticksToLiveMin

  if (request.status === 'produce') {
    if (blinkies.length < number) {
      this.requestBlinky(roomName, { task: request, boost })
      return
    }

    if (blinkies.some((creep) => creep.spawning || creep.memory.boosted === false)) {
      return
    }
    request.status = 'engage'
    return
  }

  if (request.status === 'engage') {
    if (blinkies.length === 0) {
      request.completed = true
      return
    }

    for (const blinky of blinkies) {
      runBlinky(blinky, roomName)
    }
  }
}

function runBlinky(creep, targetRoomName) {
  if (!creep.memory.flee && creep.hits / creep.hitsMax <= 0.7) {
    creep.memory.flee = true
  } else if (creep.memory.flee && creep.hits / creep.hitsMax === 1) {
    creep.memory.flee = false
  }

  const enemyCombatants = creep.room
    .getEnemyCombatants()
    .filter((creep) => !creep.pos.isRampart && creep.owner.username !== 'Source Keeper')

  creep.activeHeal()

  if (enemyCombatants.length > 0) {
    creep.activeRangedAttack()
  }

  if (creep.memory.flee) {
    for (const enemy of enemyCombatants) {
      if (creep.pos.getRangeTo(enemy.pos) < 10) {
        creep.say('😨', true)
        creep.fleeFrom(enemy, 15, 2)
        return
      }
    }
    const center = new RoomPosition(25, 25, creep.room.name)
    if (creep.pos.getRangeTo(center) > 20) {
      creep.moveMy({ pos: center, range: 20 })
    }
    return
  }

  if (enemyCombatants.length > 0) {
    // remember when was the last time that enemy combatant detected
    creep.heap.enemyLastDetectionTick = Game.time

    if (creep.handleCombatants(enemyCombatants) !== ERR_NO_PATH) {
      return
    }
  }

  if (creep.heap.enemyLastDetectionTick !== undefined && Game.time < creep.heap.enemyLastDetectionTick + 2) {
    return
  }

  if (creep.room.name !== targetRoomName || isEdgeCoord(creep.pos.x, creep.pos.y)) {
    creep.moveToRoom(targetRoomName, 2)
    return
  }

  const hostileCreeps = creep.room.findHostileCreeps().filter((creep) => !creep.pos.isRampart)

  if (hostileCreeps.length > 0) {
    const goals = hostileCreeps.map((creep) => {
      return { pos: creep.pos, range: 2 }
    })
    if (creep.moveMy(goals, { staySafe: false }) === OK) {
      creep.heap.enemyLastDetectionTick = Game.time
      // staySafe should be false for my own room defense
      return
    }
  }

  if (creep.heap.enemyLastDetectionTick !== undefined && Game.time < creep.heap.enemyLastDetectionTick + 5) {
    return
  }

  const wounded = creep.room.creeps.wounded
  if (wounded.length) {
    const goals = wounded.map((creep) => {
      return { pos: creep.pos, range: 1 }
    })
    creep.moveMy(goals, { staySafe: false })
    return
  }

  if (creep.room.isMy) {
    if (creep.pos.getRangeTo(creep.room.controller.pos) > 5) {
      creep.moveMy({ pos: creep.room.controller.pos, range: 5 }, { staySafe: false })
    }
    creep.setWorkingInfo(creep.room.controller.pos, 5)
    return
  }

  const hostileStructures = creep.room.find(FIND_HOSTILE_STRUCTURES).filter((structure) => {
    const structureType = structure.structureType
    if (structureType === 'controller') {
      return false
    }
    if (structureType === 'powerBank') {
      return false
    }
    return true
  })

  const hostileStructuresInRange = creep.pos.findInRange(hostileStructures, 3)

  if (hostileStructuresInRange.length > 0) {
    creep.rangedAttack(hostileStructuresInRange[0])
  } else {
    const goals = hostileStructures.map((structure) => {
      return { pos: structure.pos, range: 3 }
    })
    creep.moveMy(goals)
  }
}

module.exports = {
  BlinkyRequest,
}
