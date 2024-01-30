const { Quad } = require("./quad_prototype")

global.sendQuad = function (targetRoomName, modelNumber) {
  const level = Math.floor(modelNumber / 10) || 7

  targetRoomName = targetRoomName.toUpperCase()
  const base = Overlord.findClosestMyRoom(targetRoomName, level, 2)

  if (!base) {
    return `there is no adequate base`
  }

  if (!base.canProduceSquad()) {
    return `base ${base.name} is producing some squad`
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

  const request = new QuadRequest(base, targetRoomName, options)

  Overlord.registerTask(request)
  return `${base} send quad to ${targetRoomName} with model ${modelNumber}`
}

global.redirectQuad = function (fromRoomName, toRoomName) {
  fromRoomName = fromRoomName.toUpperCase()
  toRoomName = toRoomName.toUpperCase()
  const tasks = Overlord.getTasksWithCategory('quad')
  for (const request of Object.values(tasks)) {
    if (request.roomName === fromRoomName) {
      request.roomName = toRoomName
      if (request.status === 'attack') {
        request.status = 'travel'
      }
    }
  }
  return `redirected quads from ${fromRoomName} to ${toRoomName}`
}

Overlord.manageQuadTasks = function () {
  const tasks = this.getTasksWithCategory('quad')

  for (const request of Object.values(tasks)) {
    const roomNameInCharge = request.roomNameInCharge
    const roomInCharge = Game.rooms[roomNameInCharge]
    if (!roomInCharge) {
      this.deleteTask(request)
      continue
    }
    if (request.complete) {
      this.deleteTask(request)
      continue
    }
    roomInCharge.runQuadTask(request)
  }
}

Room.prototype.runQuadTask = function (request) {

  const isDismantle = request.species === 'dismantle'

  const quad = new Quad(request.quadName)
  const modelNumber = request.modelNumber

  request.currentRoom = quad.roomName || this.name

  const targetRoomName = request.roomName
  // if every member dies, end protocol
  if (request.quadSpawned && quad.creeps.length === 0) {
    request.complete = true
    return
  }

  // check ticksToLive
  if (quad.creeps.length > 0) {
    request.ticksToLive = quad.ticksToLive
  } else {
    request.ticksToLive = 1500
  }

  // heal all the time
  quad.quadHeal()

  request.status = request.status || 'produce'
  if (request.status === 'produce') {
    // check creeps
    if (!request.quadSpawned && quad.creeps.length === 4) {
      for (const creep of quad.creeps) {
        delete creep.memory.wait
      }
      request.quadSpawned = true
    }

    // spawn creeps
    if (!request.quadSpawned) {
      const creepCount = quad.creeps.length
      const lastMemberName = quad.names[3]
      const lastMember = Game.creeps[lastMemberName]
      if (lastMember && lastMember.spawning) {
        this.needNotSpawningSpawn = true
      }
      const names = quad.names
      for (let i = creepCount; i < 4; i++) {
        const name = names[i]
        const creep = Game.creeps[name]

        if (!creep) {
          if (isDismantle) {
            if (i < 2) {
              this.requestQuadMemberHealer(name)
              continue
            }
            this.requestQuadMemberDismantler(name)
            continue
          }
          this.requestQuadMemberBlinky(name, modelNumber)
        }
      }
      return
    }

    // check boost
    if (!request.quadBoosted) {
      for (const creep of quad.creeps) {
        if (creep.memory.boosted === false) {
          return
        }
      }
      request.quadBoosted = true
      request.status = 'travel'
    }
  }

  // move to target room
  if (request.status === 'travel') {
    // const enemyCombatants = quad.room.getEnemyCombatants().filter(creep => creep.owner.username !== 'Source Keeper')

    // if (enemyCombatants.length && quad.room.hostile && (!quad.room.controller || !quad.room.controller.safeMode)) {
    //   for (const creep of quad.creeps) {
    //     if (creep.pos.roomName === quad.roomName || isEdgeCoord(creep.pos.x, creep.pos.y)) {
    //       creep.moveToRoom(quad.roomName, 2)
    //     }
    //   }
    //   quad.attackRoom(quad.room.name)
    //   return
    // }

    const rallyExit = quad.getRallyExit(targetRoomName)

    quad.leader.say('🐍', true)

    quad.rangedMassAttack()
    const rallyRoomCenterPos = new RoomPosition(25, 25, rallyExit.roomName)

    if (quad.roomName !== rallyExit.roomName) {
      quad.snakeTravel({ pos: rallyRoomCenterPos, range: 20 })
      return
    }

    const exitPositions = quad.room.find(rallyExit.exit)
    const goals = exitPositions.map(pos => { return { pos, range: 4 } })

    if (quad.snakeTravel(goals) !== 'finished') {
      return
    }

    request.status = 'engage'
    return
  }

  if (request.status === 'engage') {
    if (quad.pos.roomName !== targetRoomName) {
      quad.leader.say('🎺', true)
      const targetRoomCenterPos = new RoomPosition(24, 24, targetRoomName)
      quad.moveInFormation({ pos: targetRoomCenterPos, range: 24 })

      quad.rangedMassAttack()
      return
    }
    request.status = 'attack'
    data.recordLog(`ATTACK: Quad start attack ${request.roomName}`, request.roomName)
  }

  if (request.status === 'attack') {
    const flag = quad.room.find(FIND_FLAGS)[0]
    if (flag) {
      quad.moveInFormation({ pos: flag.pos, range: 3 })
      return
    }
    if (quad.pos.roomName !== targetRoomName) {
      quad.leader.say('🎺', true)
      const targetRoomCenterPos = new RoomPosition(24, 24, targetRoomName)
      quad.moveInFormation({ pos: targetRoomCenterPos, range: 24 })
      return
    }
    quad.attackRoom(targetRoomName)
    return
  }
}

Room.prototype.getAvailableBlinkyModel = function () {
  const result = []
  const resources = Memory.stats ? Memory.stats.resources : undefined

  if (!resources) {
    return result
  }

  if (this.controller.level < 7) {
    return result
  }

  result.push(70)

  if (this.controller.level >= 8) {
    result.push(80)
  }

  const numAvailableBlinkyQuad = Overlord.getNumAvailableBlinkyQuad()

  for (const modelNumber in numAvailableBlinkyQuad) {
    const level = Number(modelNumber.charAt(0))

    if (this.controller.level < level) {
      continue
    }

    if (numAvailableBlinkyQuad[modelNumber] > 0) {
      result.push(Number(modelNumber))
    }
  }

  return result
}

const QuadRequest = function (room, targetRoomName, options) {
  const defaultOptions = { modelNumber: undefined, species: 'blinky' }
  const mergedOptions = { ...defaultOptions, ...options }

  const { modelNumber, species } = mergedOptions

  this.category = 'quad'
  this.id = targetRoomName + Game.time

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name
  this.status = 'produce'

  this.quadName = `${targetRoomName} Quad ${Game.time}`
  this.species = species
  this.modelNumber = modelNumber
  this.ticksToLive = 1500
}

Overlord.manageClearAreaTasks = function () {
  const tasks = this.getTasksWithCategory('clearArea')

  for (const clearAreaRequest of Object.values(tasks)) {
    const targetRoomName = clearAreaRequest.targetRoomName
    const roomNamesInCharge = clearAreaRequest.roomNamesInCharge
    if (roomNamesInCharge.length === 0) {
      this.deleteTask(clearAreaRequest)
    }
  }
}

module.exports = {
  QuadRequest
}